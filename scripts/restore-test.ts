/**
 * ÉPREUVE DE RESTAURATION — tâche mensuelle.
 *
 * La dernière sauvegarde réussie est restaurée dans le Supabase LOCAL du projet.
 *
 * IMPORTANT :
 *   - la base source/journal est la production via BACKUP_DATABASE_URL ;
 *   - la cible est obligatoirement le Supabase local ;
 *   - `supabase db reset --yes` initialise puis nettoie la cible ;
 *   - après l'épreuve, `supabase db reset --yes` est exécuté à nouveau afin
 *     de ne pas laisser les données de production dans l'environnement local.
 *
 * Cette épreuve emprunte exactement le même `scripts/restore.ts` que la vraie
 * procédure de restauration.
 *
 * Exécution :
 *   npm run restore:test
 *
 * Variables :
 *   BACKUP_DATABASE_URL     connexion PostgreSQL production/journal ;
 *   BACKUP_ENCRYPTION_KEY   clé de déchiffrement ;
 *   RESTORE_TEST_DATABASE_URL (optionnel) cible locale ;
 *   RESTORE_TEST_ARCHIVE      (optionnel) chemin explicite de l'archive.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { Pool } from "pg";

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

const BACKUP_DATABASE_URL = process.env["BACKUP_DATABASE_URL"] ?? "";
const RESTORE_TEST_DATABASE_URL =
  process.env["RESTORE_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const BACKUP_DESTINATION = process.env["BACKUP_DESTINATION"] ?? "";
const EXPLICIT_ARCHIVE = process.env["RESTORE_TEST_ARCHIVE"] ?? "";
const WORK_DIR = process.env["RESTORE_WORK_DIR"] ?? join(process.cwd(), ".restore-test");

const CHECKED_TABLES = [
  "obligation_types",
  "obligation_occurrences",
  "documents",
  "profiles",
  "user_roles",
  "audit_log",
  "occurrence_transitions",
] as const;

const SAMPLE_SIZE = 20;

// ─── Utilitaires ─────────────────────────────────────────────────────────────

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

function assertProductionSource(connectionString: string): void {
  if (connectionString.length === 0) {
    throw new Error("BACKUP_DATABASE_URL est obligatoire pour restore:test.");
  }

  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("BACKUP_DATABASE_URL n'est pas une URL valide.");
  }

  const hostname = url.hostname.toLowerCase();

  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.") ||
    hostname === "0.0.0.0";

  if (loopback) {
    throw new Error(
      "REFUS : BACKUP_DATABASE_URL pointe vers la machine locale. " +
        "restore:test doit lire le journal de production.",
    );
  }
}

function assertLocalTarget(connectionString: string): void {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("RESTORE_TEST_DATABASE_URL n'est pas une URL PostgreSQL valide.");
  }

  const hostname = url.hostname.toLowerCase();

  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.");

  if (!loopback) {
    throw new Error("REFUS : RESTORE_TEST_DATABASE_URL doit viser le Supabase local.");
  }
}

function resolveArchive(destination: string | null): string {
  if (EXPLICIT_ARCHIVE.length > 0) {
    return EXPLICIT_ARCHIVE;
  }

  if (destination !== null && existsSync(destination)) {
    return destination;
  }

  if (destination !== null && BACKUP_DESTINATION.length > 0) {
    const fileName = destination.split(/[\\/]/).pop() ?? "";

    if (fileName.length > 0) {
      const candidate = join(BACKUP_DESTINATION, fileName);

      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    "Archive de restauration introuvable.\n" +
      `  destination journalisée : ${destination ?? "(nulle)"}\n` +
      `  BACKUP_DESTINATION : ${BACKUP_DESTINATION || "(non défini)"}\n` +
      `  RESTORE_TEST_ARCHIVE : ${EXPLICIT_ARCHIVE || "(non défini)"}`,
  );
}

async function resetLocalSupabase(): Promise<void> {
  console.log("    supabase db reset --yes…");

  const result = await run("supabase", ["db", "reset", "--yes"]);

  if (result.code !== 0) {
    throw new Error(
      result.code === 127
        ? "Supabase CLI introuvable."
        : `supabase db reset a échoué : ${result.stderr.slice(-1200)}`,
    );
  }
}

async function clearLocalApplicationData(): Promise<void> {
  const sql = `
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('truncate table public.%I cascade', r.tablename);
  end loop;
end
$$;

truncate table storage.objects, storage.buckets cascade;
`;

  const result = await run("psql", [
    RESTORE_TEST_DATABASE_URL,
    "--quiet",
    "--single-transaction",
    "--set=ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);

  if (result.code !== 0) {
    throw new Error(`nettoyage de la base locale impossible : ${result.stderr.slice(-1000)}`);
  }
}

async function readLocalCounts(pool: Pool): Promise<Record<string, number>> {
  const query = await pool.query<Record<string, string>>(`
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

  const row = query.rows[0];

  if (row === undefined) {
    throw new Error("Impossible de lire les compteurs locaux.");
  }

  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

async function sampleDocuments(
  pool: Pool,
  storageDir: string,
): Promise<{ sampled: number; verified: number; failures: string[] }> {
  const result = await pool.query<{
    storage_path: string;
    sha256: string;
  }>(
    `select storage_path, sha256
       from public.documents
      where deleted_at is null
      order by storage_path
      limit $1`,
    [SAMPLE_SIZE],
  );

  const failures: string[] = [];
  let verified = 0;

  for (const document of result.rows) {
    const file = findFile(storageDir, document.storage_path);

    if (file === null) {
      failures.push(`absent du stockage : ${document.storage_path}`);
      continue;
    }

    const actual = await sha256Of(file);

    if (actual !== document.sha256) {
      failures.push(`empreinte divergente : ${document.storage_path}`);
      continue;
    }

    verified += 1;
  }

  return {
    sampled: result.rows.length,
    verified,
    failures,
  };
}

// ─── Épreuve ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertProductionSource(BACKUP_DATABASE_URL);
  assertLocalTarget(RESTORE_TEST_DATABASE_URL);

  const productionPool = new Pool({
    connectionString: BACKUP_DATABASE_URL,
    max: 2,
  });

  const started = Date.now();
  let testId: number | null = null;
  let localWasReset = false;
  let testFinished = false;

  const failures: { step: string; detail: string }[] = [];
  const counts: Record<string, number> = {};

  const storageDir = join(WORK_DIR, "storage");
  const reportPath = join(WORK_DIR, "restore-report.json");

  try {
    mkdirSync(WORK_DIR, { recursive: true });

    // ── 1. Dernière sauvegarde réussie ──────────────────────────────────────

    const { rows } = await productionPool.query<{
      id: number;
      destination: string | null;
      sha256: string | null;
    }>(
      `select id, destination, sha256
         from public.backup_runs
        where status = 'SUCCEEDED'
          and verified_at is not null
          and destination is not null
        order by finished_at desc nulls last
        limit 1`,
    );

    const backup = rows[0];

    if (backup === undefined) {
      testId =
        (
          await productionPool.query<{ start_restore_test: number }>(
            "select public.start_restore_test(null)",
          )
        ).rows[0]?.start_restore_test ?? null;

      if (testId !== null) {
        await productionPool.query("select public.finish_restore_test($1,$2,$3,$4,$5,$6,$7,$8)", [
          testId,
          "FAILED",
          "{}",
          0,
          0,
          JSON.stringify([
            {
              step: "SELECTION",
              detail: "Aucune sauvegarde réussie et vérifiée à éprouver.",
            },
          ]),
          0,
          "Aucune sauvegarde réussie et vérifiée en base.",
        ]);
        testFinished = true;
      }

      throw new Error("Aucune sauvegarde réussie et vérifiée à éprouver.");
    }

    testId =
      (
        await productionPool.query<{ start_restore_test: number }>(
          "select public.start_restore_test($1)",
          [backup.id],
        )
      ).rows[0]?.start_restore_test ?? null;

    const archivePath = resolveArchive(backup.destination);

    console.log(`Épreuve de la sauvegarde #${String(backup.id)}`);
    console.log(`  archive : ${archivePath}`);

    // ── 2. Vérification rapide de l'empreinte ───────────────────────────────

    if (backup.sha256 !== null) {
      const current = await sha256Of(archivePath);

      if (current !== backup.sha256) {
        failures.push({
          step: "FINGERPRINT",
          detail:
            `empreinte divergente : ${current.slice(0, 16)}… ` +
            `au lieu de ${backup.sha256.slice(0, 16)}…`,
        });
      }
    }

    // Une archive dont l'empreinte diverge n'est pas restaurée.
    if (failures.length > 0) {
      throw new Error(failures.map((failure) => failure.detail).join("\n"));
    }

    // ── 3. Initialisation propre du Supabase local ─────────────────────────

    await resetLocalSupabase();
    localWasReset = true;

    await clearLocalApplicationData();

    const authStatePool = new Pool({
      connectionString: RESTORE_TEST_DATABASE_URL,
      max: 1,
    });

    try {
      const result = await authStatePool.query<{ n: string }>(
        "select count(*)::text as n from auth.users",
      );

      const authUsers = Number(result.rows[0]?.n ?? "0");

      if (authUsers !== 0) {
        throw new Error(
          `Le Supabase local n'est pas vide avant le test : auth.users=${String(authUsers)}`,
        );
      }
    } finally {
      await authStatePool.end();
    }

    // ── 4. Restauration par le vrai script ──────────────────────────────────

    const restored = await run("node", [
      join(process.cwd(), "scripts", "restore.ts"),
      `--archive=${archivePath}`,
      `--target=${RESTORE_TEST_DATABASE_URL}`,
      `--storage=${storageDir}`,
      `--report=${reportPath}`,
    ]);

    if (restored.code !== 0) {
      failures.push({
        step: "RESTORE",
        detail: restored.stderr.slice(-1200) || "scripts/restore.ts a échoué sans message.",
      });
    }

    if (failures.length > 0) {
      throw new Error(failures.map((failure) => `[${failure.step}] ${failure.detail}`).join("\n"));
    }

    // ── 5. Contrôles indépendants ──────────────────────────────────────────

    const reportRaw = readFileSync(reportPath, "utf8");
    const report = JSON.parse(reportRaw) as {
      manifest: {
        counts: {
          documents: number;
        };
      };
      counts: Record<string, number>;
      profiles_without_auth: number;
      sampled_documents: number;
      verified_documents: number;
    };

    const restoredPool = new Pool({
      connectionString: RESTORE_TEST_DATABASE_URL,
      max: 1,
    });

    let sampled = 0;
    let verified = 0;

    try {
      const localCounts = await readLocalCounts(restoredPool);

      for (const [key, expected] of Object.entries(report.manifest.counts)) {
        const actual = localCounts[key];

        counts[key] = actual ?? -1;

        if (actual !== expected) {
          failures.push({
            step: "COUNT",
            detail: `${key}: attendu=${String(expected)}, ` + `obtenu=${String(actual)}`,
          });
        }
      }

      for (const table of CHECKED_TABLES) {
        const actual = localCounts[table] ?? 0;

        if (actual < 0) {
          failures.push({
            step: "COUNT",
            detail: `compteur indisponible pour ${table}`,
          });
        }
      }

      const profilesWithoutAuth = localCounts.profiles_without_auth ?? -1;

      if (profilesWithoutAuth !== 0) {
        failures.push({
          step: "INTEGRITY",
          detail: `profiles sans Auth correspondant : ${String(profilesWithoutAuth)}`,
        });
      }

      const sampledDocuments = await sampleDocuments(restoredPool, storageDir);

      sampled = sampledDocuments.sampled;
      verified = sampledDocuments.verified;

      for (const detail of sampledDocuments.failures) {
        failures.push({
          step: "DOCUMENT",
          detail,
        });
      }

      if (report.manifest.counts.documents > 0 && sampled > 0 && verified !== sampled) {
        failures.push({
          step: "DOCUMENT",
          detail: `échantillon documentaire invalide : ${String(verified)}/${String(sampled)}`,
        });
      }
    } finally {
      await restoredPool.end();
    }

    // ── 6. Journal ──────────────────────────────────────────────────────────

    const duration = Math.round((Date.now() - started) / 1000);
    const status = failures.length === 0 ? "PASSED" : "FAILED";

    const finalReport = [
      `Épreuve de restauration — sauvegarde #${String(backup.id)}`,
      `Durée : ${String(duration)} s`,
      `Archive : ${archivePath}`,
      ...Object.entries(counts).map(([table, count]) => `  ${table} : ${String(count)}`),
      `Documents éprouvés : ${String(verified)} / ${String(sampled)}`,
      failures.length === 0
        ? "Aucune anomalie."
        : `Anomalies :\n${failures
            .map((failure) => `  [${failure.step}] ${failure.detail}`)
            .join("\n")}`,
    ].join("\n");

    if (testId !== null) {
      await productionPool.query("select public.finish_restore_test($1,$2,$3,$4,$5,$6,$7,$8)", [
        testId,
        status,
        JSON.stringify(counts),
        sampled,
        verified,
        JSON.stringify(failures),
        duration,
        finalReport,
      ]);

      testFinished = true;
    }

    console.log(`\n${finalReport}\n`);

    if (status === "FAILED") {
      throw new Error("L'épreuve de restauration a échoué.");
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    failures.push({
      step: "FATAL",
      detail: message,
    });

    if (testId !== null && !testFinished) {
      await productionPool
        .query("select public.finish_restore_test($1,$2,$3,$4,$5,$6,$7,$8)", [
          testId,
          "FAILED",
          JSON.stringify(counts),
          0,
          0,
          JSON.stringify(failures),
          Math.round((Date.now() - started) / 1000),
          `Épreuve interrompue : ${message}`,
        ])
        .catch(() => undefined);
    }

    throw cause;
  } finally {
    /*
     * Le Supabase local a contenu les données de production.
     * On le remet systématiquement à l'état des migrations.
     */
    if (localWasReset) {
      console.log("    nettoyage final du Supabase local…");
      await resetLocalSupabase().catch((cause: unknown) => {
        console.error(
          `    ⚠️ nettoyage local impossible : ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      });
    }

    rmSync(WORK_DIR, { recursive: true, force: true });
    await productionPool.end().catch(() => undefined);
  }
}

try {
  await main();
} catch (cause) {
  console.error(`\nÉPREUVE EN ÉCHEC : ${cause instanceof Error ? cause.message : String(cause)}`);

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
