// @vitest-environment node

/**
 * LE RAPPEL DE MAINTENANCE DU CALENDRIER — EST-IL SEULEMENT DÉCLENCHÉ ?
 *
 * ⚠️ CE FICHIER EXISTE PARCE QUE LA RÉPONSE ÉTAIT NON. `ensureHolidayCalendarTask`
 * était écrite, commentée, et appelée par PERSONNE : ni pg_cron, ni route, ni
 * tâche. Une fonction correcte que rien n'invoque est indiscernable d'une
 * fonction absente — sauf qu'elle rassure à la relecture.
 *
 * Ce qu'elle protège : les fêtes religieuses algériennes suivent le calendrier
 * hégirien et sont fixées par décret. Elles ne se calculent pas, elles se
 * saisissent. Une saisie annuelle que rien ne réclame est une saisie qu'on
 * oublie, et un calendrier oublié fait tomber des échéances un jour chômé —
 * c'est-à-dire fabrique des retards par le seul fait de ne pas s'être tenu à
 * jour.
 *
 * On éprouve donc le CHEMIN COMPLET : la tâche quotidienne, telle que pg_cron
 * l'appelle, au 1er décembre.
 *
 * Prérequis : `supabase start`. Lancement : `npm run test:rls`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runGenerationJob } from "@/server/jobs/generate-occurrences";
import { ensureHolidayCalendarTask } from "@/server/jobs/holiday-calendar-reminder";

import { createTestScope, destroyTestScope, type TestScope } from "../helpers/test-scope";

let scope: TestScope;

/** Le 1er décembre, à midi UTC — donc sans ambiguïté de date à Alger. */
const PREMIER_DECEMBRE = new Date("2026-12-01T12:00:00.000Z");
/** Un jour quelconque qui n'est pas le 1er décembre. */
const AUTRE_JOUR = new Date("2026-06-17T12:00:00.000Z");

const CODE = "SYS-HOLIDAYS";

async function occurrencesDeMaintenance(annee: number): Promise<number> {
  const { rows } = await scope.pool.query<{ n: string }>(
    `select count(*) as n
       from public.obligation_occurrences oc
       join public.obligation_types ot on ot.id = oc.obligation_type_id
      where ot.code = $1 and oc.period_key = $2`,
    [CODE, String(annee)],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Efface la tâche interne et son obligation : elles ne portent aucune entité. */
async function nettoyer(): Promise<void> {
  /*
   * ⚠️ Le déclencheur APPEND-ONLY des transitions est coupé le temps du
   * nettoyage. Il porte sur le flux applicatif, pas sur la capacité d'un test à
   * effacer ce qu'il a lui-même posé ; sans cela, la suppression échoue à
   * mi-course et laisse une obligation orpheline d'une exécution à l'autre.
   */
  await scope.pool.query(
    "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
  );
  try {
    await scope.pool.query(
      `delete from public.occurrence_transitions
        where occurrence_id in (
          select oc.id from public.obligation_occurrences oc
          join public.obligation_types ot on ot.id = oc.obligation_type_id
          where ot.code = $1)`,
      [CODE],
    );
    await scope.pool.query(
      `delete from public.obligation_occurrences
        where obligation_type_id in (
          select id from public.obligation_types where code = $1)`,
      [CODE],
    );
  } finally {
    await scope.pool.query(
      "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
    );
  }
  await scope.pool.query("delete from public.obligation_types where code = $1", [CODE]);
}

beforeAll(async () => {
  scope = await createTestScope();
  /*
   * ⚠️ UN COMPTE ADMIN EST REQUIS : la tâche s'affecte à un administrateur, et
   * sans destinataire elle le SIGNALE plutôt que de créer un dossier que
   * personne ne verra. Le scénario doit donc en fournir un.
   */
  await scope.createUserWithRole("ADMIN");
  await nettoyer();
}, 120_000);

afterAll(async () => {
  await nettoyer();
  await destroyTestScope(scope);
}, 60_000);

describe("rappel de maintenance du calendrier", () => {
  it("la tâche QUOTIDIENNE le déclenche le 1er décembre", async () => {
    /*
     * ⚠️ C'EST LE CHEMIN RÉEL QUI EST ÉPROUVÉ, pas la fonction isolée. Appeler
     * `ensureHolidayCalendarTask` directement aurait passé au vert pendant tout
     * le temps où plus rien ne l'appelait — c'est exactement ce qui s'est
     * produit, et c'est ce que ce test refuse de reproduire.
     *
     * ⚠️ LE VERDICT DE LA TÂCHE EST VÉRIFIÉ AVANT SON EFFET. Sans cela, un cycle
     * SAUTÉ — verrou déjà tenu — produirait exactement la même observation qu'un
     * rappel qui ne se déclenche pas : zéro dossier, et un test vert au mauvais
     * endroit.
     */
    expect(await occurrencesDeMaintenance(2027)).toBe(0);

    const outcome = await runGenerationJob(scope.admin, 1, PREMIER_DECEMBRE);
    expect(outcome.status, "le cycle doit avoir tourné, non être sauté").not.toBe("SKIPPED");

    // Une tâche pour l'année SUIVANTE : on saisit en décembre le calendrier de
    // l'année qui commence dans un mois.
    expect(await occurrencesDeMaintenance(2027)).toBe(1);
  }, 120_000);

  it("le dossier créé NOMME ce qu'il faut saisir", async () => {
    const { rows } = await scope.pool.query<{ name: string; legal_basis: string | null }>(
      "select name, legal_basis from public.obligation_types where code = $1",
      [CODE],
    );

    /*
     * ⚠️ L'INTITULÉ EST LA MOITIÉ DU DISPOSITIF. Un dossier nommé « SYS-HOLIDAYS »
     * arrivant dans une file n'apprend rien à celui qui le reçoit ; il faut que la
     * raison — les fêtes fixées par décret — soit lisible sans ouvrir la
     * documentation.
     */
    expect(rows[0]?.name ?? "").toContain("calendrier des jours fériés");
    expect(rows[0]?.legal_basis ?? "").toContain("décret");
  });

  it("il est idempotent : un second passage ne double rien", async () => {
    const rapport = await ensureHolidayCalendarTask(PREMIER_DECEMBRE);
    expect(rapport.created).toBe(false);
    expect(await occurrencesDeMaintenance(2027)).toBe(1);
  }, 60_000);

  it("il ne se déclenche AUCUN autre jour", async () => {
    /*
     * Un rappel qui se recréerait chaque jour ne serait plus un rappel : il
     * deviendrait du bruit dans la file de l'administrateur, et le vrai dossier
     * de décembre s'y perdrait. La garde de date VIT DANS LA FONCTION — elle
     * n'était nulle part, et la fonction créait le dossier quel que soit le jour.
     */
    await nettoyer();
    const rapport = await ensureHolidayCalendarTask(AUTRE_JOUR);

    expect(rapport.created).toBe(false);
    expect(rapport.occurrenceId).toBeNull();
    expect(await occurrencesDeMaintenance(2027)).toBe(0);
  }, 60_000);
});
