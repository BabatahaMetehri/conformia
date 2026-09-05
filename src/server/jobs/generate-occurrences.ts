/**
 * GÉNÉRATION DES OCCURRENCES — tâche quotidienne, 02 h 00 heure d'Alger.
 *
 * ⚠️ SEULE EXÉCUTION À LA FOIS. Le verrou consultatif est pris AVANT tout
 * travail et relâché dans un `finally`. Deux exécutions simultanées ne
 * créeraient pas de doublons — la contrainte d'unicité y veille — mais elles se
 * disputeraient les mêmes lignes, doubleraient la charge et rendraient les
 * rapports incompréhensibles.
 *
 * ⚠️ Une exécution sautée est SIGNALÉE, jamais tue : le journal porte une ligne
 * `SKIPPED`. Un silence ne se distingue pas d'une panne, et une tâche dont on ne
 * sait pas si elle a tourné n'est pas une tâche planifiée.
 *
 * Emprunte la clé de service : générer pour tous les domaines est précisément ce
 * qu'une session utilisateur ne peut pas faire. C'est l'usage n° 1 de la liste
 * fermée de `src/lib/supabase/admin.ts`.
 */

// ⚠️ EN PREMIER, avant le client de service : ce module pose le marqueur
// que la garde d'emplacement attend (cf. admin-guard.ts).
import "@/server/jobs/_job-context";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  finishJobRun,
  startJobRun,
  tryLockJob,
  unlockJob,
  type GenerationClient,
} from "@/data/queries/generation";
import { DEFAULT_HORIZON_MONTHS, generateAllActive } from "@/services/scheduling/generator";
import { ensureHolidayCalendarTask } from "@/server/jobs/holiday-calendar-reminder";

export const JOB_NAME = "generate-occurrences";

export interface JobOutcome {
  readonly status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "SKIPPED";
  readonly processed: number;
  readonly errors: number;
  readonly runId: number | null;
}

/**
 * Exécute la génération sous verrou.
 *
 * Le client reste injectable pour les tests, qui fournissent le leur. En
 * production, y compris depuis la route de secours, c'est le client de service
 * par défaut qui est employé — la route importe ce module DYNAMIQUEMENT, de
 * sorte que la clé n'entre jamais dans son graphe statique.
 */
export async function runGenerationJob(
  client: GenerationClient = createSupabaseAdminClient(),
  horizonMonths: number = DEFAULT_HORIZON_MONTHS,
  /*
   * ⚠️ PARAMÈTRE, ET NON `new Date()` à l'intérieur. Le rappel de calendrier ne
   * s'arme qu'un jour par an ; sans instant injectable, l'éprouver demanderait
   * d'attendre le 1er décembre.
   */
  now: Date = new Date(),
): Promise<JobOutcome> {
  const lock = await tryLockJob(client, JOB_NAME);

  if (!lock.ok) {
    logger.error("Verrou de génération inaccessible", { code: lock.error.code });
    return { status: "FAILED", processed: 0, errors: 1, runId: null };
  }

  if (!lock.value) {
    // ⚠️ On NE BLOQUE PAS en attendant son tour : une tâche quotidienne qui
    // patiente s'empile, et deux heures plus tard on a douze processus en file.
    const run = await startJobRun(client, JOB_NAME);
    if (run.ok) {
      await finishJobRun(client, run.value, "SKIPPED", 0, 0, {
        reason: "LOCK_HELD",
        note: "Une autre exécution est en cours.",
      });
    }
    logger.warn("Génération sautée : verrou déjà tenu", {});
    return { status: "SKIPPED", processed: 0, errors: 0, runId: run.ok ? run.value : null };
  }

  const run = await startJobRun(client, JOB_NAME);
  if (!run.ok) {
    await unlockJob(client, JOB_NAME);
    logger.error("Journal d'exécution indisponible", { code: run.error.code });
    return { status: "FAILED", processed: 0, errors: 1, runId: null };
  }

  try {
    const report = await generateAllActive(client, horizonMonths);

    if (!report.ok) {
      await finishJobRun(client, run.value, "FAILED", 0, 1, { code: report.error.code });
      logger.error("Génération en échec", { code: report.error.code });
      return { status: "FAILED", processed: 0, errors: 1, runId: run.value };
    }

    /*
     * ⚠️ PARTIAL n'est pas une coquetterie. Le générateur poursuit après un
     * échec unitaire : annoncer « réussi » masquerait les obligations non
     * traitées, annoncer « échoué » masquerait les dizaines qui ont abouti.
     */
    const status = report.value.failed > 0 ? "PARTIAL" : "SUCCEEDED";

    /*
     * ⚠️ LE RAPPEL DE MAINTENANCE DU CALENDRIER, GREFFÉ ICI — ET IL NE L'ÉTAIT
     * NULLE PART.
     *
     * `ensureHolidayCalendarTask` existait, elle était testée, et AUCUN appelant ne
     * la déclenchait : ni pg_cron, ni route, ni tâche. Le dispositif qui devait
     * rappeler de saisir les fêtes religieuses de l'année suivante — fixées par
     * décret, donc impossibles à calculer — ne se serait jamais manifesté. Le
     * calendrier serait resté vide, et les échéances seraient tombées des jours
     * chômés sans que rien ne le signale : exactement le silence que cette tâche
     * existe pour rompre.
     *
     * Greffée sur la génération quotidienne plutôt que dotée de son propre
     * ordonnanceur, pour la raison qui vaut déjà pour l'alerte de sauvegarde
     * périmée : un second dispositif est un second dispositif dont personne ne
     * surveille la santé. Elle n'agit que le 1er décembre et reste idempotente ;
     * les 364 autres jours, elle ne coûte qu'une comparaison de date.
     *
     * Son échec ne fait pas échouer la génération : les échéances du jour comptent
     * davantage qu'un rappel qui repassera demain.
     */
    let holidayReminder: { year: number; created: boolean } | { error: string };
    try {
      const reminder = await ensureHolidayCalendarTask(now);
      holidayReminder = { year: reminder.year, created: reminder.created };
    } catch (cause) {
      holidayReminder = { error: cause instanceof Error ? cause.message : String(cause) };
      logger.error("Rappel de calendrier des jours fériés en échec", holidayReminder);
    }

    await finishJobRun(client, run.value, status, report.value.created, report.value.failed, {
      holidayReminder,
      obligations: report.value.obligations,
      created: report.value.created,
      skipped: report.value.skipped,
      failed: report.value.failed,
      // Seules les obligations en difficulté sont détaillées : un rapport qui
      // liste tout ne se lit pas, donc ne se lit pas du tout.
      failures: report.value.perObligation
        .filter((entry) => entry.failed > 0)
        .map((entry) => ({ code: entry.obligationCode, failures: entry.failures })),
    });

    logger.info("Génération terminée", {
      status,
      obligations: report.value.obligations,
      created: report.value.created,
      skipped: report.value.skipped,
      failed: report.value.failed,
    });

    return {
      status,
      processed: report.value.created,
      errors: report.value.failed,
      runId: run.value,
    };
  } catch (cause) {
    // ⚠️ La clôture DOIT avoir lieu même ici : une ligne restée à RUNNING est le
    // seul signal distinguant une tâche interrompue d'une tâche jamais lancée.
    await finishJobRun(client, run.value, "FAILED", 0, 1, {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    logger.error("Génération interrompue", {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return { status: "FAILED", processed: 0, errors: 1, runId: run.value };
  } finally {
    await unlockJob(client, JOB_NAME);
  }
}
