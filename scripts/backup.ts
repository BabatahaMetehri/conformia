/**
 * SAUVEGARDE — archive logique Conformia.
 *
 * Produit une archive chiffrée contenant :
 *   - le schéma public de l'application ;
 *   - les données Auth nécessaires à la reprise des comptes ;
 *   - les métadonnées Storage ;
 *   - les données public de l'application ;
 *   - les fichiers Storage eux-mêmes.
 *
 * Le schéma public est un artefact de récupération. La restauration normale
 * s'effectue dans un environnement Supabase déjà initialisé par les migrations
 * du projet, car auth/storage sont des schémas gérés par Supabase.
 *
 * IMPORTANT :
 *   BACKUP_DATABASE_URL est obligatoire.
 *   DATABASE_URL n'est volontairement PAS utilisé.
 *
 * Exécution :
 *   BACKUP_DATABASE_URL="..." \
 *   npm run backup -- --kind=MANUAL
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { Pool } from "pg";

import { encryptFile, MIN_KEY_LENGTH } from "./lib/archive-crypto.ts";

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

type BackupKind = "DAILY" | "WEEKLY" | "MONTHLY" | "MANUAL";

const KINDS: readonly BackupKind[] = ["DAILY", "WEEKLY", "MONTHLY", "MANUAL"];

function argOf(name: string): string | null {
  const found = process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`));

  return found === undefined ? null : found.slice(name.length + 3);
}

const kindArgument = argOf("kind") ?? "DAILY";
const kind: BackupKind = KINDS.includes(kindArgument as BackupKind)
  ? (kindArgument as BackupKind)
  : "DAILY";

/**
 * Intentionally distinct from DATABASE_URL.
 *
 * DATABASE_URL in the developer environment points to local Supabase.
 * A backup must name its source explicitly.
 */
const BACKUP_DATABASE_URL = process.env["BACKUP_DATABASE_URL"] ?? "";
const ENCRYPTION_KEY = process.env["BACKUP_ENCRYPTION_KEY"] ?? "";
const DESTINATION = process.env["BACKUP_DESTINATION"] ?? "";
const RCLONE_REMOTE = process.env["BACKUP_RCLONE_REMOTE"] ?? "";
const STORAGE_SOURCE = process.env["BACKUP_STORAGE_SOURCE"] ?? "";
const ALLOW_DB_ONLY = process.env["BACKUP_ALLOW_DB_ONLY"] === "true";
const ALLOW_LOCAL = process.env["BACKUP_ALLOW_LOCAL"] === "true";

const WORK_DIR = process.env["BACKUP_WORK_DIR"] ?? join(process.cwd(), ".backup-work");

const FORMAT_VERSION = 2;

const AUTH_TABLES = [
  "auth.users",
  "auth.identities",
  "auth.mfa_factors",
  "auth.mfa_recovery_code_sets",
  "auth.mfa_recovery_codes",
] as const;

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`ÉCHEC : ${message}`);
  process.exit(1);
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
function run(command: string, args: readonly string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { shell: false });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ code: 127, stderr: error.message });
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
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

function directorySize(path: string): number {
  if (!existsSync(path)) return 0;

  let total = 0;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directorySize(child) : statSync(child).size;
  }

  return total;
}

async function gzipFile(input: string, output: string): Promise<void> {
  await pipeline(createReadStream(input), createGzip({ level: 9 }), createWriteStream(output));
}

function assertSafeDatabaseSource(connectionString: string): void {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    fail("BACKUP_DATABASE_URL n'est pas une URL PostgreSQL valide.");
  }

  const hostname = url.hostname.toLowerCase();

  const isLoopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.") ||
    hostname === "0.0.0.0";

  if (isLoopback && !ALLOW_LOCAL) {
    fail(
      "REFUS : BACKUP_DATABASE_URL pointe vers la machine locale.\n" +
        "Pour une sauvegarde réelle, utilisez la connexion PostgreSQL de production.\n" +
        "BACKUP_ALLOW_LOCAL=true est réservé aux essais locaux explicites.",
    );
  }
}

type SourceCounts = {
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

async function readSourceState(pool: Pool): Promise<{
  database: string;
  serverVersion: string;
  counts: SourceCounts;
}> {
  const meta = await pool.query<{
    database: string;
    server_version: string;
  }>(`
    select
      current_database() as database,
      current_setting('server_version') as server_version
  `);

  const counts = await pool.query<{
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
      (select count(*)::text from storage.objects) as storage_objects
  `);

  const row = counts.rows[0];
  const source = meta.rows[0];

  if (!source) {
    throw new Error("Could not read backup source metadata from database.");
  }

  return {
    database: source.database,
    serverVersion: source.server_version,
    counts: {
      auth_users: Number(row?.auth_users ?? "0"),
      identities: Number(row?.identities ?? "0"),
      mfa_factors: Number(row?.mfa_factors ?? "0"),
      entities: Number(row?.entities ?? "0"),
      profiles: Number(row?.profiles ?? "0"),
      user_roles: Number(row?.user_roles ?? "0"),
      obligation_types: Number(row?.obligation_types ?? "0"),
      obligation_occurrences: Number(row?.obligation_occurrences ?? "0"),
      documents: Number(row?.documents ?? "0"),
      audit_log: Number(row?.audit_log ?? "0"),
      backup_runs: Number(row?.backup_runs ?? "0"),
      commercial_registers: Number(row?.commercial_registers ?? "0"),
      storage_buckets: Number(row?.storage_buckets ?? "0"),
      storage_objects: Number(row?.storage_objects ?? "0"),
    },
  };
}

async function dump(label: string, arguments_: readonly string[], output: string): Promise<void> {
  console.log(`    ${label}…`);

  const result = await run("pg_dump", [
    BACKUP_DATABASE_URL,
    ...arguments_,
    "--no-owner",
    "--no-privileges",
    `--file=${output}`,
  ]);

  if (result.code !== 0) {
    throw new Error(
      result.code === 127
        ? "pg_dump introuvable. Installer les outils clients PostgreSQL."
        : `pg_dump (${label}) a échoué : ${result.stderr.slice(0, 600)}`,
    );
  }
}

// ─── Programme ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (BACKUP_DATABASE_URL.length === 0) {
    fail(
      "BACKUP_DATABASE_URL est obligatoire.\n" +
        "DATABASE_URL n'est volontairement pas utilisé par le système de sauvegarde.",
    );
  }

  assertSafeDatabaseSource(BACKUP_DATABASE_URL);

  if (ENCRYPTION_KEY.length < MIN_KEY_LENGTH) {
    fail("BACKUP_ENCRYPTION_KEY absente ou trop courte (32 caractères minimum).");
  }

  if (DESTINATION.length === 0 && RCLONE_REMOTE.length === 0) {
    fail(
      "BACKUP_DESTINATION ou BACKUP_RCLONE_REMOTE requis : " +
        "une sauvegarde qui reste sur la machine sauvegardée n'en est pas une.",
    );
  }

  if (STORAGE_SOURCE.length === 0 && !ALLOW_DB_ONLY) {
    fail(
      "BACKUP_STORAGE_SOURCE absente. Sans copie du stockage, la restauration " +
        "rendrait une base qui référence des documents disparus.\n" +
        "Poser BACKUP_ALLOW_DB_ONLY=true pour l'accepter sciemment — développement uniquement.",
    );
  }

  const pool = new Pool({
    connectionString: BACKUP_DATABASE_URL,
    max: 1,
  });

  const startedAt = Date.now();
  let runId: number | null = null;
  let jobRunId: number | null = null;

  mkdirSync(WORK_DIR, { recursive: true });

  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15);

  const rawSchemaPath = join(WORK_DIR, `schema-public-${stamp}.sql`);
  const rawAuthPath = join(WORK_DIR, `data-auth-${stamp}.sql`);
  const rawStoragePath = join(WORK_DIR, `data-storage-${stamp}.sql`);
  const rawPublicPath = join(WORK_DIR, `data-public-${stamp}.sql`);

  const schemaPath = `${rawSchemaPath}.gz`;
  const authPath = `${rawAuthPath}.gz`;
  const storageDataPath = `${rawStoragePath}.gz`;
  const publicPath = `${rawPublicPath}.gz`;

  const manifestPath = join(WORK_DIR, `manifest-${stamp}.json`);
  const archivePath = join(WORK_DIR, `conformia-${stamp}.tar`);
  const encryptedPath = `${archivePath}.enc`;
  const storageDir = join(WORK_DIR, `storage-${stamp}`);

  try {
    const opened = await pool.query<{ start_backup_run: number }>(
      "select public.start_backup_run($1::public.backup_kind)",
      [kind],
    );
    runId = opened.rows[0]?.start_backup_run ?? null;

    const job = await pool.query<{ start_job_run: number }>("select public.start_job_run($1)", [
      "backup",
    ]);
    jobRunId = job.rows[0]?.start_job_run ?? null;

    console.log("1/5 export logique de la base…");

    const source = await readSourceState(pool);

    console.log(`    source : ${source.database}, PostgreSQL ${source.serverVersion}`);

    await dump("schéma public", ["--schema-only", "--schema=public"], rawSchemaPath);

    await dump(
      "données Auth",
      ["--data-only", ...AUTH_TABLES.flatMap((table) => [`--table=${table}`])],
      rawAuthPath,
    );

    await dump(
      "métadonnées Storage",
      ["--data-only", "--table=storage.buckets", "--table=storage.objects"],
      rawStoragePath,
    );

    await dump("données applicatives", ["--data-only", "--schema=public"], rawPublicPath);

    await gzipFile(rawSchemaPath, schemaPath);
    await gzipFile(rawAuthPath, authPath);
    await gzipFile(rawStoragePath, storageDataPath);
    await gzipFile(rawPublicPath, publicPath);

    for (const path of [rawSchemaPath, rawAuthPath, rawStoragePath, rawPublicPath]) {
      if (existsSync(path)) unlinkSync(path);
    }

    const manifest = {
      format_version: FORMAT_VERSION,
      created_at: new Date().toISOString(),
      database: source.database,
      server_version: source.serverVersion,
      sql_files: [
        basename(schemaPath),
        basename(authPath),
        basename(storageDataPath),
        basename(publicPath),
      ],
      counts: source.counts,
      restore_order: ["data-auth", "data-storage", "data-public"],
    };

    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    // ── 2. Copie du stockage documentaire ──────────────────────────────────
    let storageBytes = 0;

    if (STORAGE_SOURCE.length > 0) {
      console.log("2/5 copie du stockage…");
      mkdirSync(storageDir, { recursive: true });

      const isRemote = STORAGE_SOURCE.includes(":") && !existsSync(STORAGE_SOURCE);

      const copy = isRemote
        ? await run("rclone", ["sync", STORAGE_SOURCE, storageDir, "--quiet"])
        : await run("cp", ["-r", `${STORAGE_SOURCE}/.`, storageDir]);

      if (copy.code !== 0) {
        throw new Error(`copie du stockage échouée : ${copy.stderr.slice(0, 500)}`);
      }

      storageBytes = directorySize(storageDir);
    } else {
      console.log("2/5 stockage IGNORÉ (BACKUP_ALLOW_DB_ONLY) — sauvegarde incomplète.");
      mkdirSync(storageDir, { recursive: true });
    }

    // ── 3. Assemblage puis chiffrement ─────────────────────────────────────
    console.log("3/5 assemblage et chiffrement…");

    const tar = await run("tar", [
      "-cf",
      toTarPath(archivePath),
      "-C",
      toTarPath(WORK_DIR),
      basename(manifestPath),
      basename(schemaPath),
      basename(authPath),
      basename(storageDataPath),
      basename(publicPath),
      basename(storageDir),
    ]);

    if (tar.code !== 0) {
      throw new Error(`assemblage échoué : ${tar.stderr.slice(0, 500)}`);
    }

    await encryptFile(archivePath, encryptedPath, ENCRYPTION_KEY);

    const sha256 = await sha256Of(encryptedPath);
    const sizeBytes = (await stat(encryptedPath)).size;

    const databaseBytes =
      (await stat(schemaPath)).size +
      (await stat(authPath)).size +
      (await stat(storageDataPath)).size +
      (await stat(publicPath)).size;

    // ── 4. Rapatriement ────────────────────────────────────────────────────
    console.log("4/5 transfert…");

    const fileName = basename(encryptedPath);
    let destination: string;

    if (RCLONE_REMOTE.length > 0) {
      const push = await run("rclone", ["copy", encryptedPath, RCLONE_REMOTE, "--quiet"]);

      if (push.code !== 0) {
        throw new Error(
          push.code === 127
            ? "rclone introuvable. Installer rclone, ou renseigner BACKUP_DESTINATION."
            : `transfert rclone échoué : ${push.stderr.slice(0, 500)}`,
        );
      }

      destination = `${RCLONE_REMOTE}/${fileName}`;
    } else {
      mkdirSync(DESTINATION, { recursive: true });

      const copy = await run("cp", [encryptedPath, join(DESTINATION, fileName)]);

      if (copy.code !== 0) {
        throw new Error(`copie vers la destination échouée : ${copy.stderr.slice(0, 500)}`);
      }

      destination = join(DESTINATION, fileName);
    }

    // ── 5. Relecture à destination ─────────────────────────────────────────
    console.log("5/5 vérification à destination…");

    if (RCLONE_REMOTE.length > 0) {
      const check = await run("rclone", ["check", encryptedPath, RCLONE_REMOTE, "--one-way"]);

      if (check.code !== 0) {
        throw new Error(`relecture à destination échouée : ${check.stderr.slice(0, 500)}`);
      }
    } else {
      const copied = await stat(destination);

      if (copied.size !== sizeBytes) {
        throw new Error(
          `taille divergente à destination : ${String(copied.size)} au lieu de ${String(sizeBytes)}.`,
        );
      }

      const copiedHash = await sha256Of(destination);

      if (copiedHash !== sha256) {
        throw new Error("empreinte divergente à destination : archive corrompue au transfert.");
      }
    }

    const detail =
      STORAGE_SOURCE.length === 0
        ? "⚠️ Stockage documentaire NON inclus (BACKUP_ALLOW_DB_ONLY)."
        : null;

    await pool.query("select public.finish_backup_run($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      runId,
      "SUCCEEDED",
      sizeBytes,
      databaseBytes,
      storageBytes,
      6,
      sha256,
      destination,
      detail,
    ]);

    await pool.query("select public.mark_backup_verified($1)", [runId]);

    if (jobRunId !== null) {
      await pool.query("select public.finish_job_run($1,$2,$3,$4,$5)", [
        jobRunId,
        "SUCCEEDED",
        1,
        0,
        JSON.stringify({
          sha256,
          sizeBytes,
          destination,
          kind,
          formatVersion: FORMAT_VERSION,
          counts: source.counts,
        }),
      ]);
    }

    console.log(
      `\nSAUVEGARDE OK — ${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo, ` +
        `${String(Math.round((Date.now() - startedAt) / 1000))} s\n` +
        `  destination : ${destination}\n` +
        `  empreinte   : ${sha256}\n` +
        `  format      : ${String(FORMAT_VERSION)}\n` +
        `  source      : ${source.database} / PostgreSQL ${source.serverVersion}`,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    if (runId !== null) {
      await pool
        .query("select public.finish_backup_run($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
          runId,
          "FAILED",
          null,
          null,
          null,
          null,
          null,
          null,
          message.slice(0, 1000),
        ])
        .catch(() => undefined);
    }

    if (jobRunId !== null) {
      await pool
        .query("select public.finish_job_run($1,$2,$3,$4,$5)", [
          jobRunId,
          "FAILED",
          0,
          1,
          JSON.stringify({
            error: message.slice(0, 500),
          }),
        ])
        .catch(() => undefined);
    }

    console.error(`\nSAUVEGARDE EN ÉCHEC : ${message}`);
    process.exitCode = 1;
  } finally {
    for (const path of [
      rawSchemaPath,
      rawAuthPath,
      rawStoragePath,
      rawPublicPath,
      schemaPath,
      authPath,
      storageDataPath,
      publicPath,
      manifestPath,
      archivePath,
      encryptedPath,
    ]) {
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch {
          // Rien : l'artefact chiffré à destination reste la sauvegarde.
        }
      }
    }

    if (existsSync(storageDir)) {
      try {
        await run("rm", ["-rf", storageDir]);
      } catch {
        // Le répertoire de travail n'est pas la destination de sauvegarde.
      }
    }

    await pool.end().catch(() => undefined);
  }

  if (process.exitCode === 1) {
    process.exit(1);
  }
}

await main();
