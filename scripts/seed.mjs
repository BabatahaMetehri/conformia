/**
 * Applique les fichiers de `supabase/seed/`, dans l'ordre de leurs noms.
 *
 * ⚠️ EXISTE PARCE QUE `supabase db query --file` NE CONVIENT PAS : la CLI
 * envoie le fichier comme une requête préparée unique, et PostgreSQL refuse
 * alors plusieurs commandes (« cannot insert multiple commands into a prepared
 * statement »). Le chemin nominal reste `supabase db reset`, qui charge le même
 * dossier via `config.toml` ; ce script sert à REJOUER le seed sans réinitialiser
 * une base qui contient déjà du travail.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

const SEED_DIR = "supabase/seed";
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const files = readdirSync(SEED_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`Aucun fichier .sql dans ${SEED_DIR}.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: CONNECTION });
await client.connect();

try {
  for (const file of files) {
    const sql = readFileSync(join(SEED_DIR, file), "utf8");
    await client.query(sql);
    console.log(`appliqué : ${file}`);
  }
} finally {
  await client.end();
}
