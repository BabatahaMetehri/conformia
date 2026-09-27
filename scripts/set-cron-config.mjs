#!/usr/bin/env node
/**
 * CONFIGURATION DES TÂCHES PLANIFIÉES.
 *
 * ⚠️ CE SCRIPT EXISTE PARCE QUE LE SECRET NE DOIT PAS PASSER PAR L'ÉDITEUR SQL.
 * Une requête collée dans l'interface web de Supabase reste dans son historique,
 * consultable par quiconque ouvre le projet ensuite. Ici, le secret est lu dans
 * l'environnement et écrit par une requête paramétrée : il n'apparaît ni dans un
 * historique, ni dans les journaux de requêtes.
 *
 * Il renseigne `public.cron_dispatch_config`, que la base lit pour appeler
 * l'application. Sans lui, les cinq tâches lèvent une exception nommant ce
 * script — jamais un silence.
 *
 * Lancement :
 *   npm run cron:config
 *
 * Il lit `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` et `DATABASE_URL`. Pour cibler une
 * autre installation que celle du `.env.local` courant :
 *   DATABASE_URL="postgresql://…" NEXT_PUBLIC_APP_URL="https://…" npm run cron:config
 */

import { readFileSync } from "node:fs";
import process from "node:process";

import pg from "pg";

/**
 * Les deux adresses, et la route que chacune vise.
 *
 * Le resume hebdomadaire n'y figure PAS : il est deja produit par le cycle de
 * notification, qui appelle scheduleWeeklyDigest a chaque passage. La sauvegarde
 * non plus : c'est un script (npm run backup), pas une route — elle ecrit sur un
 * disque que l'application ne voit pas. Voir docs/deploiement.md.
 */
const ROUTES = Object.freeze({
  generate_occurrences_url: "/api/cron/generate",
  notifications_url: "/api/cron/notifications",
});

/** Charge `.env.local` sans dépendance : trois lignes valent mieux qu'un paquet. */
function readEnvFile(path) {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    out[match[1]] = (match[2] ?? "").trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const file = readEnvFile(".env.local");
const env = { ...file, ...process.env };

const appUrl = (env["NEXT_PUBLIC_APP_URL"] ?? "").replace(/\/+$/, "");
const secret = env["CRON_SECRET"] ?? "";
const databaseUrl = env["DATABASE_URL"] ?? "";

const problems = [];
if (appUrl === "") problems.push("NEXT_PUBLIC_APP_URL est vide.");
if (databaseUrl === "") problems.push("DATABASE_URL est vide.");
if (secret.length < 32) {
  problems.push(
    `CRON_SECRET fait ${String(secret.length)} caractères, 32 minimum. ` +
      "Le générer par « npm run secrets:generate ».",
  );
}

/*
 * ⚠️ REFUS D'UNE ADRESSE LOCALE POUR UNE BASE DISTANTE. Une base hébergée qui
 * appelle « localhost » appelle SA PROPRE machine, pas la vôtre : la tâche part,
 * échoue, et le 401 se perd. C'est précisément le genre de panne muette que
 * toute cette configuration existe pour empêcher.
 */
const baseEstDistante = !/(^|@)(localhost|127\.0\.0\.1)/.test(databaseUrl);
const adresseEstLocale = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(appUrl);
if (baseEstDistante && adresseEstLocale) {
  problems.push(
    `NEXT_PUBLIC_APP_URL vaut « ${appUrl} » alors que la base est distante. ` +
      "Une base hébergée qui appelle localhost appelle sa propre machine : " +
      "renseigner l'adresse publique de l'application.",
  );
}

if (problems.length > 0) {
  console.error("Configuration impossible :");
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}

/*
 * ⚠️ EN LOCAL, LA BASE TOURNE DANS DOCKER. « localhost » y désigne le conteneur
 * lui-même ; l'hôte s'atteint par `host.docker.internal`. Sans cette traduction,
 * la tâche planifiée locale ne joindrait jamais le serveur de développement — et
 * l'on croirait à tort que la correction ne fonctionne pas.
 */
const reachable = baseEstDistante
  ? appUrl
  : appUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)/, "$1host.docker.internal");

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();

  const entries = [
    ["cron_secret", secret],
    ...Object.entries(ROUTES).map(([key, path]) => [key, `${reachable}${path}`]),
  ];

  await client.query("begin");
  for (const [key, value] of entries) {
    await client.query(
      `insert into public.cron_dispatch_config (key, value, updated_at)
       values ($1, $2, now())
       on conflict (key) do update
         set value = excluded.value, updated_at = now()`,
      [key, value],
    );
  }
  await client.query("commit");

  console.log("Tâches planifiées configurées :");
  for (const [key, value] of entries) {
    // Le secret est confirmé par sa longueur, jamais réimprimé.
    console.log(
      `  ${key.padEnd(26)} ${key === "cron_secret" ? `(${String(secret.length)} caractères)` : value}`,
    );
  }
  if (reachable !== appUrl) {
    console.log(`\n  (adresse traduite pour Docker : ${appUrl} → ${reachable})`);
  }
  console.log("\nContrôler ensuite les réponses reçues :");
  console.log("  select * from public.cron_dispatch_log order by dispatched_at desc limit 10;");
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    // La transaction n'était peut-être pas ouverte : l'échec d'origine prime.
  }
  console.error(`Échec : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
