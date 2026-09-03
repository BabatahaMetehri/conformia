/**
 * ÉPREUVE DE CHARGE — cinquante sessions simultanées.
 *
 * ⚠️ CE QUE CETTE ÉPREUVE MESURE, ET CE QU'ELLE NE MESURE PAS.
 *
 * Elle mesure ce que subit le serveur quand cinquante personnes travaillent en
 * même temps : ouverture de session, échéancier, mes tâches, fiche de dossier,
 * documents. Chaque appel traverse le middleware, la RLS et PostgREST — c'est le
 * chemin réel, pas une requête SQL isolée.
 *
 * Elle NE mesure PAS le rendu côté navigateur : aucun navigateur n'est lancé
 * ici. Le temps affiché est celui du serveur, et c'est celui sur lequel on peut
 * agir. LCP et INP relèvent d'un autre outil et d'un autre document.
 *
 * ⚠️ CINQUANTE EST DÉJÀ AU-DELÀ DU BESOIN. La plateforme sert quelques dizaines
 * de personnes ; l'épreuve vise donc à établir une marge, pas à trouver le point
 * de rupture. Un résultat sain ici ne dit rien d'une charge de mille sessions,
 * et rien ne le prétend.
 *
 * Prérequis : l'application tournant sur `npm start` (ou `npm run dev`), la pile
 * Supabase locale, et des comptes de test existants. Les comptes sont créés au
 * besoin par ce script s'il dispose de la clé de service.
 *
 * Exécution : npm run load-test
 */

import { readFileSync } from "node:fs";

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

const APP_URL = process.env["LOAD_TEST_URL"] ?? "http://127.0.0.1:3210";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const USERS = Number(process.env["LOAD_TEST_USERS"] ?? "50");
const ROUNDS = Number(process.env["LOAD_TEST_ROUNDS"] ?? "4");
const PASSWORD = "conformia-charge-2026";

/** Les écrans réellement ouverts dans une journée de travail. */
const PATHS = ["/fr/echeancier", "/fr/mes-taches", "/fr/documents", "/fr/referentiel"] as const;

interface Sample {
  readonly path: string;
  readonly ms: number;
  readonly status: number;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

async function ensureUser(index: number): Promise<string | null> {
  const email = `charge${String(index).padStart(3, "0")}@e2e.test.dz`;

  if (SERVICE_KEY.length > 0) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    }).catch(() => undefined);
  }
  return email;
}

/**
 * Ouvre une session et rend les cookies à présenter ensuite.
 *
 * ⚠️ On passe par GoTrue directement plutôt que par le formulaire : ce qui est
 * mesuré est la charge des ÉCRANS, et faire porter à chaque session le coût du
 * rendu de la page de connexion fausserait la lecture.
 */
async function openSession(email: string): Promise<string | null> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) return null;

  const session = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (session.access_token === undefined || session.refresh_token === undefined) return null;

  /*
   * Format du cookie de `@supabase/ssr` : la clé dérive de l'hôte du projet, et
   * la valeur est la session JSON encodée en base64 préfixée par « base64- ».
   */
  const host = new URL(SUPABASE_URL).hostname.split(".")[0] ?? "local";
  const payload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  const encoded = `base64-${Buffer.from(payload, "utf8").toString("base64")}`;
  return `sb-${host}-auth-token=${encoded}`;
}

async function visit(cookie: string, path: string): Promise<Sample> {
  const started = performance.now();
  const response = await fetch(`${APP_URL}${path}`, {
    headers: { cookie, "accept-language": "fr" },
    redirect: "manual",
  });
  // Le corps doit être consommé : sans cela la connexion reste ouverte et les
  // mesures suivantes attendent un créneau libre plutôt que le serveur.
  await response.arrayBuffer().catch(() => undefined);
  return { path, ms: performance.now() - started, status: response.status };
}

async function main(): Promise<void> {
  if (ANON_KEY.length === 0) {
    console.error("NEXT_PUBLIC_SUPABASE_ANON_KEY absente : impossible d'ouvrir une session.");
    process.exitCode = 1;
    return;
  }

  console.log(`Préparation de ${String(USERS)} sessions…`);
  const emails = await Promise.all(
    Array.from({ length: USERS }, (_unused, index) => ensureUser(index)),
  );
  const cookies = (
    await Promise.all(
      emails.map(async (email) => (email === null ? null : await openSession(email))),
    )
  ).filter((cookie): cookie is string => cookie !== null);

  if (cookies.length === 0) {
    console.error("Aucune session ouverte. Les comptes de charge existent-ils ?");
    process.exitCode = 1;
    return;
  }
  console.log(`${String(cookies.length)} sessions ouvertes sur ${String(USERS)} demandées.`);

  const samples: Sample[] = [];
  const wallStart = performance.now();

  for (let round = 0; round < ROUNDS; round += 1) {
    const path = PATHS[round % PATHS.length] ?? PATHS[0];
    // ⚠️ TOUT PART EN MÊME TEMPS. Séquencer les sessions mesurerait une file
    // d'attente que personne ne subit dans la réalité.
    const batch = await Promise.all(cookies.map((cookie) => visit(cookie, path)));
    samples.push(...batch);
    console.log(
      `  tour ${String(round + 1)}/${String(ROUNDS)} — ${path} : ` +
        `médiane ${percentile(
          batch.map((s) => s.ms),
          0.5,
        ).toFixed(0)} ms, ` +
        `p95 ${percentile(
          batch.map((s) => s.ms),
          0.95,
        ).toFixed(0)} ms`,
    );
  }

  const wallMs = performance.now() - wallStart;
  const durations = samples.map((sample) => sample.ms);
  const failures = samples.filter((sample) => sample.status >= 400);
  const redirects = samples.filter((sample) => sample.status >= 300 && sample.status < 400);

  console.log("");
  console.log("─── Résultat ────────────────────────────────────────────────");
  console.log(`Requêtes           : ${String(samples.length)}`);
  console.log(`Durée totale       : ${(wallMs / 1000).toFixed(1)} s`);
  console.log(`Débit              : ${((samples.length / wallMs) * 1000).toFixed(1)} req/s`);
  console.log(`Médiane            : ${percentile(durations, 0.5).toFixed(0)} ms`);
  console.log(`p95                : ${percentile(durations, 0.95).toFixed(0)} ms`);
  console.log(`p99                : ${percentile(durations, 0.99).toFixed(0)} ms`);
  console.log(`Maximum            : ${Math.max(...durations).toFixed(0)} ms`);
  console.log(`Redirections (3xx) : ${String(redirects.length)}`);
  console.log(`Échecs (4xx/5xx)   : ${String(failures.length)}`);

  if (failures.length > 0) {
    const codes = new Map<number, number>();
    for (const failure of failures) codes.set(failure.status, (codes.get(failure.status) ?? 0) + 1);
    console.log(
      `  détail : ${[...codes].map(([code, n]) => `${String(code)}×${String(n)}`).join(", ")}`,
    );
    process.exitCode = 1;
  }
}

await main();
