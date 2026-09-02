/**
 * RESTAURATION — reconstitue un environnement complet depuis une archive.
 *
 * ⚠️ UNE SAUVEGARDE JAMAIS RESTAURÉE N'EST PAS UNE SAUVEGARDE. Ce script existe
 * pour que la phrase précédente cesse d'être une inquiétude et devienne une
 * opération banale, exécutable par quelqu'un qui n'a pas écrit le code —
 * procédure pas à pas dans docs/restore-procedure.md.
 *
 * Exécution :
 *   npm run restore -- --archive=/srv/backups/conformia-20260902.tar.enc \
 *                      --target=postgresql://…/conformia_restore \
 *                      [--storage=/srv/restore/storage] [--verify-only]
 *
 * ⚠️ REFUSE D'ÉCRIRE SUR LA BASE DE PRODUCTION. La cible est obligatoire et
 * explicite : un script de restauration qui vise la production par défaut finit
 * un jour par y être lancé « pour voir ».
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
} from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { Pool } from "pg";

import { decryptFile, MIN_KEY_LENGTH } from "./lib/archive-crypto.ts";

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
const VERIFY_ONLY = hasFlag("verify-only");
const ENCRYPTION_KEY = process.env["BACKUP_ENCRYPTION_KEY"] ?? "";
const WORK_DIR = process.env["RESTORE_WORK_DIR"] ?? join(process.cwd(), ".restore-work");

/** Tables dont le comptage vaut contrôle : si elles sont là, la base est là. */
export const CHECKED_TABLES = [
  "obligation_types",
  "obligation_occurrences",
  "documents",
  "profiles",
  "user_roles",
  "audit_log",
  "occurrence_transitions",
] as const;

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
    for await (const chunk of handle.createReadStream()) hash.update(chunk as Buffer);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function main(): Promise<void> {
  if (ARCHIVE.length === 0) fail("--archive= requis.");
  if (!existsSync(ARCHIVE)) fail(`archive introuvable : ${ARCHIVE}`);
  if (ENCRYPTION_KEY.length < MIN_KEY_LENGTH) fail("BACKUP_ENCRYPTION_KEY absente ou trop courte.");

  if (!VERIFY_ONLY && TARGET.length === 0) {
    fail("--target= requis : la base de destination doit être NOMMÉE, jamais devinée.");
  }

  /*
   * ⚠️ GARDE-FOU. Restaurer, c'est écraser. Une cible dont le nom ne contient ni
   * « restore », ni « test », ni « staging » est probablement la production, et
   * on refuse — quitte à obliger quelqu'un à renommer sa base pour un exercice.
   * Le coût de ce refus est une minute ; le coût de l'inverse est l'entreprise.
   */
  if (!VERIFY_ONLY && !/restore|test|staging|127\.0\.0\.1|localhost/.test(TARGET)) {
    fail(
      "REFUS : la cible ne ressemble pas à un environnement de restauration.\n" +
        "Le nom doit contenir « restore », « test » ou « staging », ou viser une base locale.",
    );
  }

  mkdirSync(WORK_DIR, { recursive: true });
  const started = Date.now();

  const tarPath = join(WORK_DIR, "archive.tar");
  const extractDir = join(WORK_DIR, "extract");

  console.log(`1/5 empreinte de l'archive…`);
  const archiveHash = await sha256Of(ARCHIVE);
  console.log(`    ${archiveHash}`);

  console.log("2/5 déchiffrement…");
  try {
    await decryptFile(ARCHIVE, tarPath, ENCRYPTION_KEY);
  } catch (cause) {
    fail(
      "déchiffrement impossible. Soit la clé n'est pas celle qui a servi à chiffrer, " +
        "soit l'archive est corrompue.\n" +
        `Détail : ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  console.log("3/5 extraction…");
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  const untar = await run("tar", ["-xf", tarPath, "-C", extractDir]);
  if (untar.code !== 0) fail(`extraction échouée : ${untar.stderr.slice(0, 400)}`);

  const entries = readdirSync(extractDir);
  const dumpEntry = entries.find((name) => name.endsWith(".sql.gz"));
  const storageEntry = entries.find((name) => name.startsWith("storage-"));

  if (dumpEntry === undefined) fail("aucun export de base dans l'archive.");

  const dumpGz = join(extractDir, dumpEntry);
  const dumpSql = join(extractDir, "restore.sql");
  await pipeline(createReadStream(dumpGz), createGunzip(), createWriteStream(dumpSql));

  const dumpBytes = (await stat(dumpSql)).size;
  console.log(`    export : ${(dumpBytes / (1024 * 1024)).toFixed(1)} Mo`);

  if (VERIFY_ONLY) {
    console.log("\nARCHIVE LISIBLE — déchiffrée, extraite, export présent.");
    console.log("Aucune écriture effectuée (--verify-only).");
    return;
  }

  console.log("4/5 restauration de la base…");
  const psql = await run("psql", [TARGET, "--quiet", "--single-transaction", "-f", dumpSql]);
  if (psql.code !== 0) {
    fail(
      psql.code === 127
        ? "psql introuvable. Installer les outils clients PostgreSQL."
        : `restauration échouée : ${psql.stderr.slice(-800)}`,
    );
  }

  console.log("5/5 contrôles…");
  const pool = new Pool({ connectionString: TARGET, max: 1 });
  const counts: Record<string, number> = {};
  try {
    for (const table of CHECKED_TABLES) {
      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from public.${table}`,
      );
      counts[table] = Number(rows[0]?.n ?? "0");
    }
  } finally {
    await pool.end();
  }

  // La copie du stockage est facultative à la restauration : on peut vouloir
  // éprouver la base seule. Mais on le DIT, plutôt que de laisser croire.
  if (storageEntry !== undefined && STORAGE_TARGET.length > 0) {
    mkdirSync(STORAGE_TARGET, { recursive: true });
    const copy = await run("cp", ["-r", `${join(extractDir, storageEntry)}/.`, STORAGE_TARGET]);
    if (copy.code !== 0) fail(`copie du stockage échouée : ${copy.stderr.slice(0, 400)}`);
    console.log(`    stockage restauré dans ${STORAGE_TARGET}`);
  } else if (storageEntry === undefined) {
    console.log("    ⚠️ aucune copie de stockage dans l'archive.");
  } else {
    console.log("    stockage présent dans l'archive, non restauré (--storage= absent).");
  }

  console.log("\nRESTAURATION TERMINÉE");
  console.log(`  durée : ${String(Math.round((Date.now() - started) / 1000))} s`);
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(26)} ${String(count).padStart(8)}`);
  }

  const empty = Object.entries(counts).filter(([, count]) => count === 0);
  if (empty.length > 0) {
    console.log(
      `\n⚠️ Tables VIDES après restauration : ${empty.map(([table]) => table).join(", ")}.\n` +
        "   Une base restaurée dont une table métier est vide n'est pas une restauration réussie.",
    );
    process.exit(1);
  }
}

/** Taille d'un répertoire, pour le rapport. */
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
