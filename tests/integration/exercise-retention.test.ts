// @vitest-environment node

/**
 * CONSERVATION PAR EXERCICE — CE QUI PROTÈGE LES PIÈCES AVANT QU'ON LES RETIRE.
 *
 * ⚠️ CE FICHIER ÉPROUVE UN REFUS, PAS UNE FONCTIONNALITÉ.
 *
 * `mark_exercise_archived` enregistre qu'un exercice est passé hors ligne. Le
 * retrait des fichiers appartient au script d'exploitation ; la base, elle, pose
 * les conditions. Si l'une d'elles cède, on retire des déclarations fiscales en
 * se croyant couvert par une archive qui ne les contient pas — et l'on ne s'en
 * aperçoit qu'en les cherchant, des mois plus tard.
 *
 * Prérequis : `supabase start`. Lancement : `npm run test:rls`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestScope, destroyTestScope, type TestScope } from "../helpers/test-scope";

let scope: TestScope;
let adminId = "";

const ANNEE = 2024;

/** Crée une archive dans l'état demandé, et rend son identifiant. */
async function archive(options: {
  readonly status?: string;
  readonly encrypted?: boolean;
  readonly relue?: boolean;
  readonly finishedAt?: string;
}): Promise<number> {
  const { rows } = await scope.pool.query<{ id: string }>(
    `insert into public.backup_runs (started_at, finished_at, status, encrypted, kind)
     values (now() - interval '1 hour', $1::timestamptz, $2, $3, 'MANUAL')
     returning id`,
    [
      options.finishedAt ?? new Date().toISOString(),
      options.status ?? "SUCCEEDED",
      options.encrypted ?? true,
    ],
  );
  const id = Number(rows[0]?.id);

  if (options.relue ?? true) {
    await scope.pool.query(
      `insert into public.restore_tests (started_at, finished_at, status, backup_run_id)
       values (now(), now(), 'PASSED', $1)`,
      [id],
    );
  }
  return id;
}

/** Appelle la fonction SOUS L'IDENTITÉ de l'utilisateur, jamais en superutilisateur. */
async function marquer(userId: string, year: number, backupId: number): Promise<number> {
  return scope.asUser(userId, async (client) => {
    const { rows } = await client.query<{ n: number }>(
      "select public.mark_exercise_archived($1, $2) as n",
      [year, backupId],
    );
    return rows[0]?.n ?? -1;
  });
}

beforeAll(async () => {
  scope = await createTestScope();
  adminId = await scope.createUserWithRole("ADMIN");

  const obligationId = await scope.createObligation({
    code: "RETENTION-TEST",
    name: "Test conservation par exercice",
    scope: "ENTITY",
    periodicity: "MONTHLY",
  });

  await scope.createOccurrence({
    obligationId,
    periodKey: "2024-01",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-31",
    legalDueDate: "2024-02-20",
    internalDueDate: "2024-02-13",
    status: "TODO",
  });
}, 120_000);

afterAll(async () => {
  await scope.pool.query(
    "delete from public.restore_tests where backup_run_id in (select id from public.backup_runs where kind = 'MANUAL')",
  );
  await destroyTestScope(scope);
}, 60_000);

describe("refus d'archivage", () => {
  it("⚠️ une archive JAMAIS RELUE est refusée", async () => {
    /*
     * La condition la plus facile à négliger, et la plus coûteuse. Une archive
     * qui n'a jamais été restaurée n'est pas une archive : c'est un fichier dont
     * on espère qu'il s'ouvre. On ne découvre le contraire qu'en ayant besoin
     * d'elle — donc après avoir retiré ce qu'elle devait protéger.
     */
    const id = await archive({ relue: false });
    await expect(marquer(adminId, ANNEE, id)).rejects.toThrow(/jamais relue/i);
  });

  it("⚠️ une archive NON CHIFFRÉE est refusée", async () => {
    // Elle contient des déclarations fiscales et des données sociales : la
    // laisser en clair sur un disque de sauvegarde déplace le risque, il ne
    // disparaît pas.
    const id = await archive({ encrypted: false });
    await expect(marquer(adminId, ANNEE, id)).rejects.toThrow(/non chiffrée/i);
  });

  it("une archive INCOMPLÈTE est refusée", async () => {
    const id = await archive({ status: "FAILED" });
    await expect(marquer(adminId, ANNEE, id)).rejects.toThrow(/statut/i);
  });

  it("une archive INTROUVABLE est refusée", async () => {
    await expect(marquer(adminId, ANNEE, 999_999_999)).rejects.toThrow(/introuvable/i);
  });

  it("⚠️ sans `settings.manage`, l'appel est refusé", async () => {
    /*
     * La fonction est SECURITY DEFINER : sans ce contrôle interne, elle
     * s'exécuterait avec les droits du propriétaire et contournerait la RLS
     * pour n'importe quel porteur de session.
     */
    const responsable = await scope.createUserWithRole("RESPONSABLE", "FISCAL");
    const id = await archive({});
    await expect(marquer(responsable, ANNEE, id)).rejects.toThrow(/settings\.manage/i);
  });

  it("une archive ACCEPTABLE passe, et ne marque rien s'il n'y a rien à marquer", async () => {
    // L'exercice 2024 ne porte aucune pièce dans le jeu d'essai : le compte
    // retourné est zéro, et c'est une réponse, pas un échec.
    const id = await archive({});
    await expect(marquer(adminId, ANNEE, id)).resolves.toBe(0);
  });
});

describe("inventaire par exercice", () => {
  it("rend une ligne par année, la plus récente en tête", async () => {
    const { rows } = await scope.pool.query<{ exercice: number; hors_fenetre: boolean }>(
      "select exercice, hors_fenetre from public.exercise_inventory",
    );
    expect(rows.length).toBeGreaterThan(0);

    const annees = rows.map((row) => row.exercice);
    expect([...annees].sort((a, b) => b - a)).toEqual(annees);
  });

  it("⚠️ la fenêtre suit le RÉGLAGE, elle n'est pas figée dans la vue", async () => {
    /*
     * Une fenêtre codée en dur obligerait à une migration pour passer de trois à
     * cinq ans — c'est-à-dire à un déploiement pour un choix d'exploitation.
     */
    const courante = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Africa/Algiers" }),
    ).getFullYear();

    await scope.pool.query(
      "update public.app_settings set value = to_jsonb(0) where key = 'retention_live_years'",
    );
    const serree = await scope.pool.query<{ exercice: number; hors_fenetre: boolean }>(
      "select exercice, hors_fenetre from public.exercise_inventory",
    );
    // Fenêtre nulle : tout exercice antérieur au courant est hors fenêtre.
    for (const row of serree.rows) {
      expect(row.hors_fenetre).toBe(row.exercice < courante);
    }

    await scope.pool.query(
      "update public.app_settings set value = to_jsonb(3) where key = 'retention_live_years'",
    );
    const large = await scope.pool.query<{ exercice: number; hors_fenetre: boolean }>(
      "select exercice, hors_fenetre from public.exercise_inventory",
    );
    for (const row of large.rows) {
      expect(row.hors_fenetre).toBe(row.exercice < courante - 3);
    }
  });
});
