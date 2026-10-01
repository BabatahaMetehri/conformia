/**
 * RESTAURATION — reconstitue un environnement Supabase depuis une archive
 * logique Conformia de format 2.
 *
 * La cible doit déjà être initialisée par les migrations Supabase du projet.
 * On ne tente PAS de recréer les schémas gérés `auth` / `storage` depuis
 * l'archive : ils appartiennent à l'infrastructure Supabase.
 *
 * L'ordre de restauration est :
 *   1. données Auth ;
 *   2. métadonnées Storage ;
 *   3. données applicatives public.
 *
 * Les trois jeux de données sont chargés dans une transaction avec
 * `session_replication_role = replica` afin de ne pas déclencher les triggers
 * applicatifs pendant la reconstruction.
 *
 * Exécution :
 *   npm run restore -- \
 *     --archive=/srv/backups/conformia-20260930.tar.enc \
 *     --target=postgresql://…/restore_db \
 *     --storage=/srv/restore/storage \
 *     [--report=/srv/restore/report.json] \
 *     [--verify-only]
 *
 * IMPORTANT :
 *   `--verify-only` déchiffre, extrait et valide tous les artefacts sans écrire
 *   dans la base cible.
 *
 * REFUSE les cibles qui ne ressemblent pas à un environnement de restauration.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { Pool } from "pg";

import { decryptFile, MIN_KEY_LENGTH } from "./lib/archive-crypto.ts";

// ─── Environnement ───────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  let raw: string;

  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    process.env[key] ??= value;
  }
}

loadEnvLocal();

function argOf(name: string): string | null {
  const found = process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`));
  return found === undefined ? null : found.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

const ARCHIVE = argOf("archive") ?? "";
const TARGET = argOf("target") ?? "";
const STORAGE_TARGET = argOf("storage") ?? "";
const REPORT = argOf("report") ?? "";
const VERIFY_ONLY = hasFlag("verify-only");
const ENCRYPTION_KEY = process.env["BACKUP_ENCRYPTION_KEY"] ?? "";
const WORK_DIR = process.env["RESTORE_WORK_DIR"] ?? join(process.cwd(), ".restore-work");

const FORMAT_VERSION = 2;

// ─── Types ───────────────────────────────────────────────────────────────────

export type RestoreCounts = {
  auth_users: number;
  identities: number;
  mfa_factors: number;
  entities: number;
  profiles: number;
  user_roles: number;
  obligation_types: number;
  obligation_occurrences: number;
  documents: number;
  audit_log: number;
  backup_runs: number;
  commercial_registers: number;
  storage_buckets: number;
  storage_objects: number;
};

export type BackupManifest = {
  format_version: number;
  created_at: string;
  database: string;
  server_version: string;
  sql_files: string[];
  counts: RestoreCounts;
  restore_order: string[];
};

export type RestoreReport = {
  format_version: number;
  archive_sha256: string;
  manifest: BackupManifest;
  counts: RestoreCounts;
  profiles_without_auth: number;
  sampled_documents: number;
  verified_documents: number;
  storage_target: string | null;
};

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function fail(message: string): never {
  throw new Error(message);
}

function toTarPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);

  if (match === null) {
    return normalized;
  }

  const driveLetter = match[1];
  const drivePath = match[2];

  if (driveLetter === undefined || drivePath === undefined) {
    return normalized;
  }

  return `/${driveLetter.toLowerCase()}/${drivePath}`;
}
function run(
  command: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { shell: false });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        code: 127,
        stdout,
        stderr: error.message,
      });
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(path, "r");

  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await handle.close();
  }

  return hash.digest("hex");
}

async function gunzipFile(input: string, output: string): Promise<void> {
  await pipeline(createReadStream(input), createGunzip(), createWriteStream(output));
}

function buildPartitionBootstrap(schemaSqlPath: string, outputPath: string): number {
  const schema = readFileSync(schemaSqlPath, "utf8");

  const pattern =
    /^ALTER TABLE ONLY public\.(audit_log|document_access_log) ATTACH PARTITION public\.(audit_log_\d{4}m\d{2}|document_access_log_\d{4}m\d{2}) FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\);$/gm;

  const statements: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(schema)) !== null) {
    const baseTable = match[1];
    const partitionName = match[2];
    const rangeStart = match[3];

    if (baseTable === undefined || partitionName === undefined || rangeStart === undefined) {
      continue;
    }

    const monthStart = rangeStart.slice(0, 10);

    const sqlBaseTable = `'${baseTable.replaceAll("'", "''")}'`;
    const sqlMonthStart = `'${monthStart.replaceAll("'", "''")}'`;

    statements.push(
      `-- ${partitionName}\n` +
        `select public.ensure_month_partition(${sqlBaseTable}, ${sqlMonthStart}::date);`,
    );
  }

  if (statements.length === 0) {
    throw new Error(
      "Aucune partition audit_log/document_access_log trouvée dans schema-public.sql.",
    );
  }

  writeFileSync(outputPath, `${statements.join("\n\n")}\n`, "utf8");

  return statements.length;
}

function findFile(root: string, needle: string): string | null {
  if (!existsSync(root)) return null;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, entry.name);

    if (entry.isDirectory()) {
      const found = findFile(child, needle);
      if (found !== null) return found;
    } else if (child.replaceAll("\\", "/").endsWith(needle)) {
      return child;
    }
  }

  return null;
}

function assertSafeEntryName(name: string): void {
  if (name.length === 0) {
    fail("Nom d'artefact vide dans le manifeste.");
  }

  if (basename(name) !== name) {
    fail(`Nom d'artefact non sûr : ${name}`);
  }

  if (name.includes("..")) {
    fail(`Nom d'artefact non sûr : ${name}`);
  }
}

function parseManifest(path: string): BackupManifest {
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (cause) {
    fail(`manifest.json illisible : ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  if (typeof raw !== "object" || raw === null) {
    fail("Manifest invalide.");
  }

  const value = raw as Record<string, unknown>;

  if (value.format_version !== FORMAT_VERSION) {
    fail(
      `Format d'archive non supporté : ${String(
        value.format_version,
      )}. Format attendu : ${String(FORMAT_VERSION)}.`,
    );
  }

  if (
    typeof value.created_at !== "string" ||
    typeof value.database !== "string" ||
    typeof value.server_version !== "string" ||
    !Array.isArray(value.sql_files) ||
    !Array.isArray(value.restore_order) ||
    typeof value.counts !== "object" ||
    value.counts === null
  ) {
    fail("Structure du manifeste invalide.");
  }

  for (const entry of value.sql_files) {
    if (typeof entry !== "string") {
      fail("Le manifeste contient un nom de fichier SQL invalide.");
    }

    assertSafeEntryName(entry);

    if (!entry.endsWith(".sql.gz")) {
      fail(`Artefact SQL inattendu dans le manifeste : ${entry}`);
    }
  }

  const counts = value.counts as Partial<RestoreCounts>;
  const requiredCountKeys: (keyof RestoreCounts)[] = [
    "auth_users",
    "identities",
    "mfa_factors",
    "entities",
    "profiles",
    "user_roles",
    "obligation_types",
    "obligation_occurrences",
    "documents",
    "audit_log",
    "backup_runs",
    "commercial_registers",
    "storage_buckets",
    "storage_objects",
  ];

  for (const key of requiredCountKeys) {
    if (typeof counts[key] !== "number" || !Number.isFinite(counts[key])) {
      fail(`Compteur manquant ou invalide dans le manifeste : ${key}`);
    }
  }

  return value as BackupManifest;
}

function expectedSql(manifest: BackupManifest, prefix: string): string {
  const match = manifest.sql_files.find((entry) => entry.startsWith(prefix));

  if (match === undefined) {
    fail(`Artefact SQL manquant dans le manifeste : ${prefix}*.sql.gz`);
  }

  return match;
}

async function preflightTarget(target: string): Promise<void> {
  const pool = new Pool({
    connectionString: target,
    max: 1,
  });

  try {
    const { rows } = await pool.query<{
      database: string;
      auth_users: string | null;
      storage_objects: string | null;
      profiles: string | null;
    }>(`
      select
        current_database() as database,
        to_regclass('auth.users')::text as auth_users,
        to_regclass('storage.objects')::text as storage_objects,
        to_regclass('public.profiles')::text as profiles
    `);

    const row = rows[0];

    if (row === undefined) {
      fail("Impossible de lire l'état de la base cible.");
    }

    if (row.auth_users === null || row.storage_objects === null || row.profiles === null) {
      fail(
        "La cible n'est pas un environnement Supabase initialisé.\n" +
          "Les schémas auth/storage ou les tables applicatives sont absents.\n" +
          "Exécuter d'abord `supabase db reset --yes` ou initialiser la cible " +
          "avec les migrations du projet.",
      );
    }

    console.log(`    cible : ${row.database}`);
  } finally {
    await pool.end();
  }
}

async function readCounts(pool: Pool): Promise<{
  counts: RestoreCounts;
  profilesWithoutAuth: number;
}> {
  const { rows } = await pool.query<{
    auth_users: string;
    identities: string;
    mfa_factors: string;
    entities: string;
    profiles: string;
    user_roles: string;
    obligation_types: string;
    obligation_occurrences: string;
    documents: string;
    audit_log: string;
    backup_runs: string;
    commercial_registers: string;
    storage_buckets: string;
    storage_objects: string;
    profiles_without_auth: string;
  }>(`
    select
      (select count(*)::text from auth.users) as auth_users,
      (select count(*)::text from auth.identities) as identities,
      (select count(*)::text from auth.mfa_factors) as mfa_factors,
      (select count(*)::text from public.entities) as entities,
      (select count(*)::text from public.profiles) as profiles,
      (select count(*)::text from public.user_roles) as user_roles,
      (select count(*)::text from public.obligation_types) as obligation_types,
      (select count(*)::text from public.obligation_occurrences) as obligation_occurrences,
      (select count(*)::text from public.documents) as documents,
      (select count(*)::text from public.audit_log) as audit_log,
      (select count(*)::text from public.backup_runs) as backup_runs,
      (select count(*)::text from public.commercial_registers) as commercial_registers,
      (select count(*)::text from storage.buckets) as storage_buckets,
      (select count(*)::text from storage.objects) as storage_objects,
      (
        select count(*)::text
        from public.profiles p
        left join auth.users u on u.id = p.id
        where u.id is null
      ) as profiles_without_auth
  `);

  const row = rows[0];

  if (row === undefined) {
    fail("Impossible de lire les compteurs après restauration.");
  }

  return {
    counts: {
      auth_users: Number(row.auth_users),
      identities: Number(row.identities),
      mfa_factors: Number(row.mfa_factors),
      entities: Number(row.entities),
      profiles: Number(row.profiles),
      user_roles: Number(row.user_roles),
      obligation_types: Number(row.obligation_types),
      obligation_occurrences: Number(row.obligation_occurrences),
      documents: Number(row.documents),
      audit_log: Number(row.audit_log),
      backup_runs: Number(row.backup_runs),
      commercial_registers: Number(row.commercial_registers),
      storage_buckets: Number(row.storage_buckets),
      storage_objects: Number(row.storage_objects),
    },
    profilesWithoutAuth: Number(row.profiles_without_auth),
  };
}

function compareCounts(expected: RestoreCounts, actual: RestoreCounts): string[] {
  const failures: string[] = [];

  for (const key of Object.keys(expected) as (keyof RestoreCounts)[]) {
    if (expected[key] !== actual[key]) {
      failures.push(`${key}: attendu=${String(expected[key])}, obtenu=${String(actual[key])}`);
    }
  }

  return failures;
}

async function verifyDocumentSample(
  pool: Pool,
  storageTarget: string,
): Promise<{ sampled: number; verified: number }> {
  const sample = await pool.query<{
    storage_path: string;
    sha256: string;
  }>(
    `select storage_path, sha256
       from public.documents
      where deleted_at is null
      order by storage_path
      limit 20`,
  );

  let verified = 0;

  for (const document of sample.rows) {
    const file = findFile(storageTarget, document.storage_path);

    if (file === null) {
      fail(`document absent du stockage restauré : ${document.storage_path}`);
    }

    const actual = await sha256Of(file);

    if (actual !== document.sha256) {
      fail(`empreinte divergente pour le document : ${document.storage_path}`);
    }

    verified += 1;
  }

  return {
    sampled: sample.rows.length,
    verified,
  };
}

async function main(): Promise<void> {
  if (ARCHIVE.length === 0) {
    fail("--archive= requis.");
  }

  if (!existsSync(ARCHIVE)) {
    fail(`archive introuvable : ${ARCHIVE}`);
  }

  if (ENCRYPTION_KEY.length < MIN_KEY_LENGTH) {
    fail("BACKUP_ENCRYPTION_KEY absente ou trop courte.");
  }

  if (!VERIFY_ONLY && TARGET.length === 0) {
    fail("--target= requis : la base de destination doit être NOMMÉE, jamais devinée.");
  }

  if (!VERIFY_ONLY && !/restore|test|staging|127\.0\.0\.1|localhost/i.test(TARGET)) {
    fail(
      "REFUS : la cible ne ressemble pas à un environnement de restauration.\n" +
        "Le nom doit contenir « restore », « test » ou « staging », ou viser une base locale.",
    );
  }

  mkdirSync(WORK_DIR, { recursive: true });

  const started = Date.now();
  const tarPath = join(WORK_DIR, "archive.tar");
  const extractDir = join(WORK_DIR, "extract");

  try {
    console.log("1/6 empreinte de l'archive…");
    const archiveHash = await sha256Of(ARCHIVE);
    console.log(`    ${archiveHash}`);

    console.log("2/6 déchiffrement…");

    try {
      await decryptFile(ARCHIVE, tarPath, ENCRYPTION_KEY);
    } catch (cause) {
      fail(
        "déchiffrement impossible. Soit la clé n'est pas celle qui a servi " +
          "à chiffrer, soit l'archive est corrompue.\n" +
          `Détail : ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if ((await stat(tarPath)).size === 0) {
      fail("L'archive déchiffrée est vide.");
    }

    console.log("3/6 extraction…");

    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });

    const untar = await run("tar", ["-xf", toTarPath(tarPath), "-C", toTarPath(extractDir)]);

    if (untar.code !== 0) {
      fail(`extraction échouée : ${untar.stderr.slice(0, 600)}`);
    }

    const entries = readdirSync(extractDir);

    const manifestEntry = entries.find(
      (name) => name.startsWith("manifest-") && name.endsWith(".json"),
    );

    if (manifestEntry === undefined) {
      fail("manifest.json absent de l'archive.");
    }

    const manifestPath = join(extractDir, manifestEntry);
    const manifest = parseManifest(manifestPath);

    const schemaEntry = expectedSql(manifest, "schema-public-");
    const authEntry = expectedSql(manifest, "data-auth-");
    const storageEntry = expectedSql(manifest, "data-storage-");
    const publicEntry = expectedSql(manifest, "data-public-");

    for (const entry of [schemaEntry, authEntry, storageEntry, publicEntry]) {
      if (!existsSync(join(extractDir, entry))) {
        fail(`Artefact absent de l'archive : ${entry}`);
      }
    }

    const storageEntryDirectory = entries.find((name) => name.startsWith("storage-"));

    if (manifest.counts.storage_objects > 0 && STORAGE_TARGET.length === 0) {
      fail(
        "La sauvegarde contient des objets Storage, mais aucun --storage= " +
          "n'a été fourni pour la restauration.",
      );
    }

    console.log("4/6 validation des artefacts SQL…");

    const schemaSql = join(extractDir, "schema-public.sql");
    const authSql = join(extractDir, "data-auth.sql");
    const storageSql = join(extractDir, "data-storage.sql");
    const publicSql = join(extractDir, "data-public.sql");
    const partitionSql = join(extractDir, "restore-partitions.sql");

    await gunzipFile(join(extractDir, schemaEntry), schemaSql);
    await gunzipFile(join(extractDir, authEntry), authSql);
    await gunzipFile(join(extractDir, storageEntry), storageSql);
    await gunzipFile(join(extractDir, publicEntry), publicSql);

    const partitionCount = buildPartitionBootstrap(schemaSql, partitionSql);

    console.log(`    partitions archivées : ${String(partitionCount)}`);

    for (const path of [schemaSql, authSql, storageSql, publicSql, partitionSql]) {
      const bytes = (await stat(path)).size;

      if (bytes === 0) {
        fail(`Artefact SQL vide : ${path}`);
      }
    }

    if (VERIFY_ONLY) {
      console.log("\nARCHIVE VALIDE");
      console.log(`  format     : ${String(manifest.format_version)}`);
      console.log(`  base       : ${manifest.database}`);
      console.log(`  PostgreSQL : ${manifest.server_version}`);
      console.log(`  durée      : ${String(Math.round((Date.now() - started) / 1000))} s`);
      console.log("  aucune écriture effectuée (--verify-only).");

      if (REPORT.length > 0) {
        const report: RestoreReport = {
          format_version: FORMAT_VERSION,
          archive_sha256: archiveHash,
          manifest,
          counts: manifest.counts,
          profiles_without_auth: 0,
          sampled_documents: 0,
          verified_documents: 0,
          storage_target: null,
        };

        writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }

      return;
    }

    console.log("5/6 restauration de la base…");

    await preflightTarget(TARGET);

    const psql = await run("psql", [
      TARGET,
      "--quiet",
      "--single-transaction",
      "--set=ON_ERROR_STOP=1",
      "-c",
      "set session_replication_role = replica;",
      "-f",
      authSql,
      "-f",
      storageSql,
      "-f",
      partitionSql,
      "-f",
      publicSql,
      "-c",
      "reset session_replication_role;",
    ]);

    if (psql.code !== 0) {
      fail(
        psql.code === 127
          ? "psql introuvable. Installer les outils clients PostgreSQL."
          : `restauration SQL échouée : ${psql.stderr.slice(-1200)}`,
      );
    }

    if (STORAGE_TARGET.length > 0 && storageEntryDirectory !== undefined) {
      rmSync(STORAGE_TARGET, { recursive: true, force: true });
      mkdirSync(STORAGE_TARGET, { recursive: true });

      const copy = await run("cp", [
        "-r",
        `${join(extractDir, storageEntryDirectory)}/.`,
        STORAGE_TARGET,
      ]);

      if (copy.code !== 0) {
        fail(`copie du stockage échouée : ${copy.stderr.slice(0, 600)}`);
      }
    }

    console.log("6/6 contrôles…");

    const pool = new Pool({
      connectionString: TARGET,
      max: 1,
    });

    let counts: RestoreCounts;
    let profilesWithoutAuth: number;
    let sampledDocuments = 0;
    let verifiedDocuments = 0;

    try {
      const result = await readCounts(pool);
      counts = result.counts;
      profilesWithoutAuth = result.profilesWithoutAuth;

      if (profilesWithoutAuth !== 0) {
        fail(`profils sans utilisateur Auth correspondant : ${String(profilesWithoutAuth)}`);
      }

      const countFailures = compareCounts(manifest.counts, counts);

      if (countFailures.length > 0) {
        fail(
          "Les compteurs restaurés ne correspondent pas au manifeste :\n" +
            countFailures.map((failure) => `  - ${failure}`).join("\n"),
        );
      }

      if (counts.documents > 0 && STORAGE_TARGET.length > 0) {
        const sample = await verifyDocumentSample(pool, STORAGE_TARGET);
        sampledDocuments = sample.sampled;
        verifiedDocuments = sample.verified;
      }
    } finally {
      await pool.end();
    }

    const report: RestoreReport = {
      format_version: FORMAT_VERSION,
      archive_sha256: archiveHash,
      manifest,
      counts,
      profiles_without_auth: profilesWithoutAuth,
      sampled_documents: sampledDocuments,
      verified_documents: verifiedDocuments,
      storage_target: STORAGE_TARGET.length > 0 ? STORAGE_TARGET : null,
    };

    if (REPORT.length > 0) {
      writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    console.log("\nRESTAURATION TERMINÉE");
    console.log(`  durée : ${String(Math.round((Date.now() - started) / 1000))} s`);
    console.log(`  format : ${String(manifest.format_version)}`);
    console.log(`  base : ${manifest.database}`);
    console.log(`  PostgreSQL : ${manifest.server_version}`);

    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(26)} ${String(count).padStart(8)}`);
    }

    console.log(`  profiles sans Auth        ${String(profilesWithoutAuth).padStart(8)}`);

    console.log(
      `  documents vérifiés        ${String(verifiedDocuments).padStart(8)} / ${String(sampledDocuments)}`,
    );
  } finally {
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (cause) {
  console.error(
    `\nRESTAURATION EN ÉCHEC : ${cause instanceof Error ? cause.message : String(cause)}`,
  );

  process.exitCode = 1;
}

/** Taille d'un répertoire, exportée pour les tests. */
export function directorySize(path: string): number {
  if (!existsSync(path)) return 0;

  let total = 0;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directorySize(child) : statSync(child).size;
  }

  return total;
}
