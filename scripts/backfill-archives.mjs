/**
 * RATTRAPAGE HISTORIQUE — crée les coquilles ARCHIVÉES des mois précédents.
 *
 *   node scripts/backfill-archives.mjs --months 12 [--dry-run] [--only G50,CNAS-DAS]
 *
 * ⚠️ POURQUOI DES COQUILLES PLUTÔT QUE RIEN. Sans elles, un justificatif de mars
 * n'a nulle part où aller tant que personne n'a créé le dossier de mars à la
 * main. L'entreprise verse ses pièces anciennes au fil de l'eau, quand elle les
 * retrouve ; l'outil doit avoir une case prête, pas réclamer une campagne de
 * saisie rétroactive le premier jour.
 *
 * ⚠️ ARCHIVED, JAMAIS TODO. Ces dossiers ne réclament aucun travail : ils
 * n'apparaissent dans aucune file, ne comptent dans aucun indicateur de retard.
 * Les créer en TODO fabriquerait des centaines de dossiers « en retard » à
 * l'ouverture — exactement l'inverse du but, et la meilleure façon d'apprendre
 * aux gens que les retards affichés ne veulent rien dire.
 *
 * ⚠️ CE QU'IL FAUT SAVOIR AVANT DE VERSER UNE PIÈCE ANCIENNE : une occurrence
 * ARCHIVED est immuable. Y déposer un justificatif suppose de ROUVRIR le dossier
 * — transition ARCHIVED → SUBMITTED, permission `occurrence.unlock`, motif
 * obligatoire. C'est plus lourd que l'intention initiale ne le laissait croire ;
 * mieux vaut le savoir maintenant que le découvrir la pièce en main.
 *
 * ⚠️ IDEMPOTENT. Relancé, il ne crée rien de plus : l'unicité (obligation,
 * période) tranche. On peut donc l'exécuter en `--dry-run`, lire, puis relancer
 * pour de bon.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const DEFAUT_MOIS = 12;

function chargerEnvLocal() {
  let raw;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const ligne of raw.split(/\r?\n/)) {
    const t = ligne.trim();
    if (t.length === 0 || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    process.env[t.slice(0, i).trim()] ??= t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

chargerEnvLocal();

function argument(nom, defaut = null) {
  const index = process.argv.indexOf(`--${nom}`);
  return index === -1 ? defaut : (process.argv[index + 1] ?? defaut);
}

const mois = Number(argument("months", String(DEFAUT_MOIS)));
const simulation = process.argv.includes("--dry-run");
const seulement = argument("only");

if (!Number.isInteger(mois) || mois < 1 || mois > 36) {
  console.error("REFUS : --months doit être un entier entre 1 et 36.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !cle) {
  console.error(
    "REFUS : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.\n" +
      "Ce script écrit pour le compte du système : il emploie la clé de service,\n" +
      "comme les tâches planifiées, et non une session utilisateur.",
  );
  process.exit(1);
}

const client = createClient(url, cle, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/*
 * ⚠️ IMPORT DYNAMIQUE APRÈS le chargement de l'environnement. `src/config/env.ts`
 * valide au chargement du module : importer le générateur en tête de fichier
 * ferait échouer le script sur une variable absente avant même d'avoir lu
 * `.env.local`.
 */
const { backfillArchivedShells } = await import("../src/services/scheduling/generator.ts");

const { data: obligations, error } = await client
  .from("obligation_types")
  .select("id, code, name, periodicity, is_active")
  .eq("is_active", true)
  .neq("periodicity", "ON_EVENT")
  .is("deleted_at", null)
  .order("code");

if (error !== null) {
  console.error("Lecture du référentiel impossible :", error.message);
  process.exit(1);
}

const filtre = seulement === null ? null : new Set(seulement.split(",").map((c) => c.trim()));
const cibles = obligations.filter((o) => filtre === null || filtre.has(o.code));

if (cibles.length === 0) {
  console.error("Aucune obligation ne correspond. Rien à faire.");
  process.exit(1);
}

console.log(
  `${simulation ? "SIMULATION — " : ""}rattrapage sur ${String(mois)} mois, ` +
    `${String(cibles.length)} obligation(s).\n`,
);

let total = 0;
let echecs = 0;

for (const obligation of cibles) {
  if (simulation) {
    // En simulation on n'appelle rien : la fonction ÉCRIT, et une « simulation »
    // qui écrirait quand même serait pire qu'aucune simulation.
    console.log(`  ${obligation.code.padEnd(16)} ${obligation.name}`);
    continue;
  }

  const rapport = await backfillArchivedShells(client, obligation.id, mois);

  if (!rapport.ok) {
    echecs += 1;
    console.log(`  ${obligation.code.padEnd(16)} ÉCHEC — ${rapport.error.code}`);
    continue;
  }

  total += rapport.value.created;
  console.log(
    `  ${obligation.code.padEnd(16)} ${String(rapport.value.created).padStart(3)} créée(s), ` +
      `${String(rapport.value.skipped).padStart(3)} déjà là`,
  );
}

if (simulation) {
  console.log(`\nRien n'a été écrit. Relancer sans --dry-run pour appliquer.`);
} else {
  console.log(`\n${String(total)} coquille(s) archivée(s) créée(s), ${String(echecs)} échec(s).`);
  console.log(
    "Elles n'apparaissent dans aucune file et ne comptent dans aucun retard.\n" +
      "Pour y verser une pièce ancienne : rouvrir le dossier (ARCHIVED → SUBMITTED).",
  );
}
