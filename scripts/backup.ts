/**
 * SAUVEGARDE — niveau 2 de la stratégie (voir docs/backup-strategy.md).
 *
 * Produit une archive chiffrée contenant l'export logique de la base ET une
 * copie du stockage documentaire, puis la RAPATRIE sur un support contrôlé par
 * AGROESPACE, et la RELIT à destination avant de déclarer le succès.
 *
 * ⚠️ N'EMPLOIE PAS la clé `service_role`. Comme `seed.mjs` et `create-user.mjs`,
 * il parle à PostgreSQL directement (CLAUDE.md §6 vise le code applicatif, pas
 * l'outillage d'exploitation hors ligne). Le stockage, lui, est copié par rclone
 * ou depuis un chemin monté — jamais par l'API applicative.
 *
 * ⚠️ LA CLÉ DE CHIFFREMENT NE PART JAMAIS AVEC L'ARCHIVE. Elle vit dans
 * l'environnement du serveur qui sauvegarde, et dans le coffre de l'entreprise.
 * Une archive chiffrée déposée à côté de sa clé est une archive en clair.
 *
 * Exécution : npm run backup [-- --kind=DAILY|WEEKLY|MONTHLY|MANUAL]
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { readFileSync } from "node:fs";
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

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ENCRYPTION_KEY = process.env["BACKUP_ENCRYPTION_KEY"] ?? "";
/** Répertoire CONTRÔLÉ PAR AGROESPACE où l'archive est rapatriée. */
const DESTINATION = process.env["BACKUP_DESTINATION"] ?? "";
/** Remote rclone facultatif : NAS, serveur d'entreprise, stockage tiers. */
const RCLONE_REMOTE = process.env["BACKUP_RCLONE_REMOTE"] ?? "";
/** Source des objets de stockage : chemin monté, ou remote rclone. */
const STORAGE_SOURCE = process.env["BACKUP_STORAGE_SOURCE"] ?? "";
/**
 * ⚠️ SOUPAPE DE DÉVELOPPEMENT, à ne jamais poser en production.
 *
 * Sans copie du stockage, une restauration rend une base qui référence des
 * documents absents : les dossiers existent, les pièces ont disparu. C'est une
 * sauvegarde qui a l'air complète et ne l'est pas — exactement le piège que ce
 * script existe pour fermer. On refuse donc, sauf déclaration explicite.
 */
const ALLOW_DB_ONLY = process.env["BACKUP_ALLOW_DB_ONLY"] === "true";

const WORK_DIR = process.env["BACKUP_WORK_DIR"] ?? join(process.cwd(), ".backup-work");

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`ÉCHEC : ${message}`);
  process.exit(1);
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
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) hash.update(chunk as Buffer);
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

// ─── Programme ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (ENCRYPTION_KEY.length < MIN_KEY_LENGTH) {
    fail("BACKUP_ENCRYPTION_KEY absente ou trop courte (32 caractères minimum).");
  }
  if (DESTINATION.length === 0 && RCLONE_REMOTE.length === 0) {
    fail(
      "BACKUP_DESTINATION ou BACKUP_RCLONE_REMOTE requis : une sauvegarde qui reste sur la machine sauvegardée n'en est pas une.",
    );
  }
  if (STORAGE_SOURCE.length === 0 && !ALLOW_DB_ONLY) {
    fail(
      "BACKUP_STORAGE_SOURCE absente. Sans copie du stockage, la restauration rendrait une base qui référence des documents disparus.\n" +
        "Poser BACKUP_ALLOW_DB_ONLY=true pour l'accepter sciemment — développement uniquement.",
    );
  }

  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const startedAt = Date.now();
  let runId: number | null = null;
  let jobRunId: number | null = null;

  mkdirSync(WORK_DIR, { recursive: true });

  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15);
  const dumpPath = join(WORK_DIR, `conformia-${stamp}.sql.gz`);
  const archivePath = join(WORK_DIR, `conformia-${stamp}.tar`);
  const encryptedPath = `${archivePath}.enc`;

  try {
    // ── Journal ouvert AVANT le travail : une ligne restée à RUNNING est le
    //    seul signal qui distingue une interruption d'une absence de lancement.
    const opened = await pool.query<{ start_backup_run: number }>(
      "select public.start_backup_run($1::public.backup_kind)",
      [kind],
    );
    runId = opened.rows[0]?.start_backup_run ?? null;

    const job = await pool.query<{ start_job_run: number }>("select public.start_job_run($1)", [
      "backup",
    ]);
    jobRunId = job.rows[0]?.start_job_run ?? null;

    // ── 1. Export logique de la base ───────────────────────────────────────
    console.log("1/5 export de la base…");
    const dump = await run("pg_dump", [
      DATABASE_URL,
      "--no-owner",
      "--no-privileges",
      // `--clean --if-exists` : le fichier est rejouable sur une base non vide,
      // ce dont la procédure de restauration a besoin.
      "--clean",
      "--if-exists",
      "--format=plain",
      `--file=${join(WORK_DIR, `dump-${stamp}.sql`)}`,
    ]);

    if (dump.code !== 0) {
      throw new Error(
        dump.code === 127
          ? "pg_dump introuvable. Installer les outils clients PostgreSQL sur le serveur de sauvegarde."
          : `pg_dump a échoué : ${dump.stderr.slice(0, 400)}`,
      );
    }

    const plainDump = join(WORK_DIR, `dump-${stamp}.sql`);
    await pipeline(
      (await open(plainDump, "r")).createReadStream(),
      createGzip({ level: 9 }),
      createWriteStream(dumpPath),
    );
    unlinkSync(plainDump);

    const databaseBytes = (await stat(dumpPath)).size;

    // ── 2. Copie du stockage documentaire ──────────────────────────────────
    let storageBytes = 0;
    const storageDir = join(WORK_DIR, `storage-${stamp}`);

    if (STORAGE_SOURCE.length > 0) {
      console.log("2/5 copie du stockage…");
      mkdirSync(storageDir, { recursive: true });

      const isRemote = STORAGE_SOURCE.includes(":") && !existsSync(STORAGE_SOURCE);
      const copy = isRemote
        ? await run("rclone", ["sync", STORAGE_SOURCE, storageDir, "--quiet"])
        : await run("cp", ["-r", `${STORAGE_SOURCE}/.`, storageDir]);

      if (copy.code !== 0) {
        throw new Error(`copie du stockage échouée : ${copy.stderr.slice(0, 400)}`);
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
      archivePath,
      "-C",
      WORK_DIR,
      basename(dumpPath),
      basename(storageDir),
    ]);
    if (tar.code !== 0) {
      throw new Error(`assemblage échoué : ${tar.stderr.slice(0, 400)}`);
    }

    await encryptFile(archivePath, encryptedPath, ENCRYPTION_KEY);

    const sha256 = await sha256Of(encryptedPath);
    const sizeBytes = (await stat(encryptedPath)).size;

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
            : `transfert rclone échoué : ${push.stderr.slice(0, 400)}`,
        );
      }
      destination = `${RCLONE_REMOTE}/${fileName}`;
    } else {
      mkdirSync(DESTINATION, { recursive: true });
      const copy = await run("cp", [encryptedPath, join(DESTINATION, fileName)]);
      if (copy.code !== 0) {
        throw new Error(`copie vers la destination échouée : ${copy.stderr.slice(0, 400)}`);
      }
      destination = join(DESTINATION, fileName);
    }

    // ── 5. RELECTURE À DESTINATION ─────────────────────────────────────────
    /*
     * ⚠️ L'ÉTAPE QU'ON SAUTE, ET QU'IL NE FAUT PAS SAUTER.
     *
     * Un `cp` qui rend 0 dit que l'écriture a été acceptée, pas que les octets
     * sont lisibles : disque plein en fin de copie, montage réseau qui tombe,
     * quota atteint. On relit donc taille ET empreinte à destination. C'est ce
     * qui distingue « la commande n'a pas protesté » de « la sauvegarde existe ».
     */
    console.log("5/5 vérification à destination…");

    /*
     * ⚠️ Toute divergence LÈVE. Il n'y a pas de « vérifié partiellement » : une
     * archive dont la relecture ne concorde pas n'est pas une sauvegarde, et la
     * consigner en SUCCEEDED reviendrait à mentir au dispositif d'alerte.
     */
    if (RCLONE_REMOTE.length > 0) {
      const check = await run("rclone", ["check", encryptedPath, RCLONE_REMOTE, "--one-way"]);
      if (check.code !== 0) {
        throw new Error(`relecture à destination échouée : ${check.stderr.slice(0, 400)}`);
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

    await pool.query("select public.finish_backup_run($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
      runId,
      "SUCCEEDED",
      sizeBytes,
      databaseBytes,
      storageBytes,
      2,
      sha256,
      destination,
      detail,
    ]);
    // Atteint uniquement si la relecture a concordé : les cas contraires ont levé.
    await pool.query("select public.mark_backup_verified($1)", [runId]);

    if (jobRunId !== null) {
      await pool.query("select public.finish_job_run($1, $2, $3, $4, $5)", [
        jobRunId,
        "SUCCEEDED",
        1,
        0,
        JSON.stringify({ sha256, sizeBytes, destination, kind }),
      ]);
    }

    console.log(
      `\nSAUVEGARDE OK — ${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo, ` +
        `${String(Math.round((Date.now() - startedAt) / 1000))} s\n` +
        `  destination : ${destination}\n  empreinte   : ${sha256}`,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    if (runId !== null) {
      await pool
        .query("select public.finish_backup_run($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
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
        .query("select public.finish_job_run($1, $2, $3, $4, $5)", [
          jobRunId,
          "FAILED",
          0,
          1,
          JSON.stringify({ error: message.slice(0, 500) }),
        ])
        .catch(() => undefined);
    }

    console.error(`\nSAUVEGARDE EN ÉCHEC : ${message}`);
    await pool.end();
    process.exit(1);
  } finally {
    // Le répertoire de travail est vidé : il contient un export EN CLAIR.
    for (const path of [dumpPath, archivePath, encryptedPath]) {
      if (existsSync(path)) unlinkSync(path);
    }
    await pool.end().catch(() => undefined);
  }
}

await main();
