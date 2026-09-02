/**
 * ÉPREUVE DE RESTAURATION — tâche mensuelle.
 *
 * Restaure la dernière sauvegarde réussie dans une base JETABLE, compte les
 * tables principales, vérifie l'intégrité d'un échantillon de documents, écrit
 * son verdict dans `restore_tests`, puis détruit tout.
 *
 * ⚠️ C'EST LA SEULE CHOSE QUI TRANSFORME « on a des sauvegardes » EN FAIT. Le
 * reste — la ligne `SUCCEEDED`, l'empreinte, la relecture à destination — dit
 * qu'un fichier existe et qu'il est intact. Seule une restauration dit qu'il est
 * EXPLOITABLE.
 *
 * Exécution : npm run restore:test
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { Pool } from "pg";

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
    process.env[key] ??= trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DESTINATION = process.env["BACKUP_DESTINATION"] ?? "";
const WORK_DIR = process.env["RESTORE_WORK_DIR"] ?? join(process.cwd(), ".restore-test");

/** Tables dont le comptage vaut contrôle. */
const CHECKED_TABLES = [
  "obligation_types",
  "obligation_occurrences",
  "documents",
  "profiles",
  "user_roles",
  "audit_log",
] as const;

/** Documents éprouvés par empreinte. Un échantillon, pas l'exhaustivité. */
const SAMPLE_SIZE = 20;

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
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk as Buffer);
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

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  const started = Date.now();
  let testId: number | null = null;
  const failures: { step: string; detail: string }[] = [];
  const counts: Record<string, number> = {};
  let sampled = 0;
  let verified = 0;

  const restoreDbName = `conformia_restore_test_${String(Date.now())}`;
  const adminUrl = new URL(DATABASE_URL);
  const targetUrl = new URL(DATABASE_URL);
  targetUrl.pathname = `/${restoreDbName}`;

  const storageDir = join(WORK_DIR, "storage");

  try {
    // ── La dernière sauvegarde réussie ET vérifiée ─────────────────────────
    const { rows } = await pool.query<{
      id: number;
      destination: string | null;
      sha256: string | null;
    }>(
      `select id, destination, sha256 from public.backup_runs
       where status = 'SUCCEEDED' and destination is not null
       order by finished_at desc nulls last limit 1`,
    );

    const backup = rows[0];
    if (backup === undefined) {
      /*
       * ⚠️ AUCUNE SAUVEGARDE À ÉPROUVER EST UN ÉCHEC, pas un « rien à faire ».
       * Sortir en silence produirait un journal d'épreuves vide qu'on lirait
       * comme « pas encore lancé », alors qu'il faut lire « il n'y a rien à
       * restaurer ».
       */
      testId =
        (await pool.query<{ start_restore_test: number }>("select public.start_restore_test(null)"))
          .rows[0]?.start_restore_test ?? null;

      if (testId !== null) {
        await pool.query("select public.finish_restore_test($1,$2,$3,$4,$5,$6,$7,$8)", [
          testId,
          "FAILED",
          "{}",
          0,
          0,
          JSON.stringify([{ step: "SELECTION", detail: "Aucune sauvegarde réussie à éprouver." }]),
          Math.round((Date.now() - started) / 1000),
          "Aucune sauvegarde réussie en base : rien à restaurer.",
        ]);
      }
      console.error("ÉCHEC : aucune sauvegarde réussie à éprouver.");
      await pool.end();
      process.exit(1);
    }

    testId =
      (
        await pool.query<{ start_restore_test: number }>("select public.start_restore_test($1)", [
          backup.id,
        ])
      ).rows[0]?.start_restore_test ?? null;

    const archivePath =
      backup.destination !== null && existsSync(backup.destination)
        ? backup.destination
        : DESTINATION.length > 0
          ? join(DESTINATION, backup.destination?.split(/[\\/]/).pop() ?? "")
          : "";

    if (archivePath.length === 0 || !existsSync(archivePath)) {
      throw new Error(`archive introuvable : ${backup.destination ?? "(sans destination)"}`);
    }

    // L'empreinte AVANT toute manipulation : si elle diverge, inutile d'aller
    // plus loin, et l'incident est de conservation, pas de restauration.
    if (backup.sha256 !== null) {
      const current = await sha256Of(archivePath);
      if (current !== backup.sha256) {
        failures.push({
          step: "FINGERPRINT",
          detail: `empreinte divergente : ${current.slice(0, 16)}… au lieu de ${backup.sha256.slice(0, 16)}…`,
        });
      }
    }

    // ── Base jetable ───────────────────────────────────────────────────────
    mkdirSync(WORK_DIR, { recursive: true });
    const created = await run("psql", [
      adminUrl.toString(),
      "--quiet",
      "-c",
      `create database ${restoreDbName}`,
    ]);
    if (created.code !== 0) {
      throw new Error(`création de la base d'épreuve impossible : ${created.stderr.slice(0, 300)}`);
    }

    // ── Restauration, par le script de restauration lui-même ───────────────
    /*
     * ⚠️ On appelle `scripts/restore.ts`, on ne réimplémente pas la
     * restauration. Une épreuve qui emprunterait un autre chemin que la vraie
     * procédure vérifierait un chemin que personne n'empruntera le jour du
     * sinistre.
     */
    const restored = await run("node", [
      join(process.cwd(), "scripts", "restore.ts"),
      `--archive=${archivePath}`,
      `--target=${targetUrl.toString()}`,
      `--storage=${storageDir}`,
    ]);

    if (restored.code !== 0) {
      failures.push({ step: "RESTORE", detail: restored.stderr.slice(-600) });
    }

    // ── Comptages ──────────────────────────────────────────────────────────
    const restoredPool = new Pool({ connectionString: targetUrl.toString(), max: 1 });
    try {
      for (const table of CHECKED_TABLES) {
        const result = await restoredPool.query<{ n: string }>(
          `select count(*)::text as n from public.${table}`,
        );
        counts[table] = Number(result.rows[0]?.n ?? "0");
        if (counts[table] === 0) {
          failures.push({ step: "COUNT", detail: `${table} est vide après restauration.` });
        }
      }

      // ── Échantillon de documents ─────────────────────────────────────────
      const sample = await restoredPool.query<{ storage_path: string; sha256: string }>(
        `select storage_path, sha256 from public.documents
         where deleted_at is null order by random() limit $1`,
        [SAMPLE_SIZE],
      );

      for (const document of sample.rows) {
        sampled += 1;
        const file = findFile(storageDir, document.storage_path);
        if (file === null) {
          failures.push({
            step: "DOCUMENT",
            detail: `absent du stockage : ${document.storage_path}`,
          });
          continue;
        }
        const actual = await sha256Of(file);
        if (actual === document.sha256) verified += 1;
        else {
          failures.push({
            step: "DOCUMENT",
            detail: `empreinte divergente : ${document.storage_path}`,
          });
        }
      }
    } finally {
      await restoredPool.end().catch(() => undefined);
    }

    const duration = Math.round((Date.now() - started) / 1000);
    const status = failures.length === 0 ? "PASSED" : "FAILED";

    const report = [
      `Épreuve de restauration — sauvegarde #${String(backup.id)}`,
      `Durée : ${String(duration)} s`,
      ...Object.entries(counts).map(([table, count]) => `  ${table} : ${String(count)}`),
      `Documents éprouvés : ${String(verified)} / ${String(sampled)}`,
      failures.length === 0
        ? "Aucune anomalie."
        : `Anomalies :\n${failures.map((f) => `  [${f.step}] ${f.detail}`).join("\n")}`,
    ].join("\n");

    if (testId !== null) {
      await pool.query("select public.finish_restore_test($1,$2,$3,$4,$5,$6,$7,$8)", [
        testId,
        status,
        JSON.stringify(counts),
        sampled,
        verified,
        JSON.stringify(failures),
        duration,
        report,
      ]);
    }

    console.log(`\n${report}\n`);
    if (status === "FAILED") process.exit(1);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    failures.push({ step: "FATAL", detail: message });

    if (testId !== null) {
      await pool
        .query("select public.finish_restore_test($1,$2,$3,$4,$5,$6,$7,$8)", [
          testId,
          "FAILED",
          JSON.stringify(counts),
          sampled,
          verified,
          JSON.stringify(failures),
          Math.round((Date.now() - started) / 1000),
          `Épreuve interrompue : ${message}`,
        ])
        .catch(() => undefined);
    }

    console.error(`\nÉPREUVE EN ÉCHEC : ${message}`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  } finally {
    /*
     * ⚠️ La base d'épreuve et le stockage restauré contiennent TOUTES les données
     * de l'entreprise, sans les protections de la production. Les laisser
     * traîner annulerait le bénéfice de l'exercice.
     */
    await run("psql", [
      adminUrl.toString(),
      "--quiet",
      "-c",
      `drop database if exists ${restoreDbName}`,
    ]);
    rmSync(WORK_DIR, { recursive: true, force: true });
    await pool.end().catch(() => undefined);
  }
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

await main();
