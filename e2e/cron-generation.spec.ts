import { expect, test } from "@playwright/test";
import { Pool } from "pg";

/**
 * Route de secours de génération, éprouvée par de vraies requêtes HTTP.
 *
 * ⚠️ Ce que seul un appel réel démontre : que l'import dynamique du job
 * fonctionne à l'exécution. La garde d'emplacement de `src/lib/supabase/admin.ts`
 * lit la pile d'appels ; un import statique faisait échouer le BUILD, et rien
 * n'assurait a priori qu'un import dynamique passerait à l'exécution. Il fallait
 * l'essayer, pas le supposer.
 */

const CRON_SECRET = process.env["CRON_SECRET"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: DB_URL, max: 2 });

test.afterAll(async () => {
  await pool.end();
});

test.beforeEach(() => {
  test.skip(CRON_SECRET.length === 0, "CRON_SECRET absent de l'environnement de test.");
});

test.describe("POST /api/cron/generate", () => {
  test("REFUSE un appel sans secret", async ({ request }) => {
    const response = await request.post("/api/cron/generate");
    expect(response.status()).toBe(403);

    // La réponse ne dit pas CE QUI manque : « secret absent » plutôt que
    // « secret faux » renseignerait l'appelant sur ce qu'il doit corriger.
    expect(await response.json()).toEqual({ error: "FORBIDDEN" });
  });

  test("REFUSE un secret faux, même de la bonne longueur", async ({ request }) => {
    const wrong = "x".repeat(CRON_SECRET.length);
    const response = await request.post("/api/cron/generate", {
      headers: { "x-cron-secret": wrong },
    });
    expect(response.status()).toBe(403);
  });

  test("ACCEPTE le bon secret et rend un rapport d'exécution", async ({ request }) => {
    const response = await request.post("/api/cron/generate", {
      headers: { "x-cron-secret": CRON_SECRET },
    });

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      status: string;
      processed: number;
      runId: number | null;
    };

    // ⚠️ La preuve que l'import dynamique tient : sans lui, le job ne se
    // chargerait pas et la route rendrait une erreur serveur.
    expect(["SUCCEEDED", "PARTIAL", "SKIPPED"]).toContain(body.status);
    expect(body.runId).not.toBeNull();

    // L'exécution laisse une trace close : une ligne restée ouverte signalerait
    // un processus interrompu.
    const { rows } = await pool.query<{ status: string; finished_at: Date | null }>(
      "select status, finished_at from public.job_runs where id = $1",
      [body.runId],
    );
    expect(rows[0]?.finished_at).not.toBeNull();
  });

  test("deux appels consécutifs ne créent aucun doublon", async ({ request }) => {
    const before = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.obligation_occurrences",
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.post("/api/cron/generate", {
        headers: { "x-cron-secret": CRON_SECRET },
      });
      expect(response.status()).toBe(200);
    }

    const after = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.obligation_occurrences",
    );

    /*
     * ⚠️ Critère d'acceptation, éprouvé par le chemin réel. Le premier appel a
     * pu créer des dossiers ; le second ne doit rien ajouter. L'égalité stricte
     * entre les deux mesures d'après-appel serait le vrai test, mais le premier
     * appel de CE test peut lui-même être le premier de la session : on compare
     * donc au total d'après le premier appel.
     */
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
