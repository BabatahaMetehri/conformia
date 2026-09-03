/**
 * Attend que la base soit RÉELLEMENT prête, et pas seulement joignable.
 *
 * ⚠️ CE SCRIPT CORRIGE UNE COURSE MESURÉE, PAS UNE CRAINTE.
 *
 * `supabase db reset` REDÉMARRE les conteneurs avant de rendre la main.
 * Enchaîner directement sur la suite d'intégration faisait échouer une
 * vingtaine de tests sur « the database system is in recovery mode » — une
 * erreur qui n'a rien à voir avec ce qu'ils éprouvent, et qui change de victime
 * à chaque exécution. Une suite dont les échecs se déplacent est pire qu'une
 * suite rouge : on cesse de la croire.
 *
 * ⚠️ TROIS RÉPONSES CONSÉCUTIVES, pas une. Pendant la reprise, PostgreSQL
 * accepte la connexion puis refuse la requête ; un unique `select 1` réussi ne
 * prouve donc rien. On exige une stabilité, pas un instant de chance.
 */

import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { Client } from "pg";

function loadEnvLocal() {
  let raw;
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

const CONNECTION =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const REQUIRED_STREAK = 3;
const ATTEMPT_DELAY_MS = 500;
const GIVE_UP_AFTER_MS = 120_000;

async function answers() {
  const client = new Client({ connectionString: CONNECTION, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    // Une lecture RÉELLE, pas un `select 1` : en reprise, le moteur répond aux
    // expressions constantes avant d'ouvrir l'accès aux relations.
    await client.query("select count(*) from public.entities");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const deadline = Date.now() + GIVE_UP_AFTER_MS;
let streak = 0;

while (Date.now() < deadline) {
  streak = (await answers()) ? streak + 1 : 0;
  if (streak >= REQUIRED_STREAK) {
    console.log("base prête.");
    process.exit(0);
  }
  await sleep(ATTEMPT_DELAY_MS);
}

console.error(
  `Base injoignable après ${String(GIVE_UP_AFTER_MS / 1000)} s.\n` +
    "Vérifier que `supabase start` tourne.",
);
process.exit(1);
