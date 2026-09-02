/**
 * NOTIFICATIONS — tâche horaire.
 *
 * Trois étapes, dans cet ordre et sans exception :
 *   1. planifier — remplir la file d'après les jalons et l'escalade ;
 *   2. préparer le résumé hebdomadaire, s'il est l'heure ;
 *   3. diffuser — vider la file d'envoi.
 *
 * ⚠️ L'ORDRE N'EST PAS INDIFFÉRENT. Planifier avant de diffuser fait partir les
 * alertes du cycle courant dans le même cycle ; l'inverse les retarderait d'une
 * heure, ce qui à J-1 signifie « la veille au soir » plutôt que « la veille ».
 *
 * ⚠️ UNE PANNE DU FOURNISSEUR N'EMPÊCHE PAS LES NOTIFICATIONS IN-APP. C'est un
 * critère d'acceptation, et il est tenu par la structure : l'étape 1 écrit en
 * base, l'étape 3 envoie. Un échec de la troisième laisse la première acquise.
 * C'est pourquoi le rapport distingue `SUCCEEDED` de `PARTIAL` — et pourquoi la
 * diffusion en échec ne fait pas échouer la tâche entière.
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
import { dispatchNotifications } from "@/services/notifications/dispatcher";
import { scheduleNotifications } from "@/services/notifications/scheduler";
import { scheduleWeeklyDigest } from "@/services/notifications/digest";

export const JOB_NAME = "process-notifications";

export interface NotificationJobOutcome {
  readonly status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "SKIPPED";
  readonly scheduled: number;
  readonly duplicates: number;
  readonly sent: number;
  readonly failed: number;
  readonly digestQueued: number;
  readonly runId: number | null;
}

const NOTHING = { scheduled: 0, duplicates: 0, sent: 0, failed: 0, digestQueued: 0 };

/**
 * Exécute un cycle complet, sous verrou.
 *
 * Le client reste injectable pour les tests. En production, y compris depuis la
 * route de secours, c'est le client de service qui est employé — la route
 * importe ce module DYNAMIQUEMENT, de sorte que la clé n'entre jamais dans son
 * graphe statique.
 */
export async function runNotificationJob(
  client: GenerationClient = createSupabaseAdminClient(),
  now: Date = new Date(),
): Promise<NotificationJobOutcome> {
  const lock = await tryLockJob(client, JOB_NAME);

  if (!lock.ok) {
    logger.error("Verrou de notification inaccessible", { code: lock.error.code });
    return { status: "FAILED", ...NOTHING, failed: 1, runId: null };
  }

  if (!lock.value) {
    /*
     * ⚠️ On NE BLOQUE PAS en attendant son tour, et l'exécution sautée est
     * SIGNALÉE. Un silence ne se distingue pas d'une panne : une tâche dont on
     * ignore si elle a tourné n'est pas une tâche planifiée.
     */
    const run = await startJobRun(client, JOB_NAME);
    if (run.ok) {
      await finishJobRun(client, run.value, "SKIPPED", 0, 0, {
        reason: "LOCK_HELD",
        note: "Un autre cycle de notification est en cours.",
      });
    }
    logger.warn("Cycle de notification sauté : verrou déjà tenu", {});
    return { status: "SKIPPED", ...NOTHING, runId: run.ok ? run.value : null };
  }

  const run = await startJobRun(client, JOB_NAME);
  if (!run.ok) {
    await unlockJob(client, JOB_NAME);
    logger.error("Journal d'exécution indisponible", { code: run.error.code });
    return { status: "FAILED", ...NOTHING, failed: 1, runId: null };
  }

  try {
    const scheduling = await scheduleNotifications(client, now);
    const digest = await scheduleWeeklyDigest(client, now);
    const dispatch = await dispatchNotifications(client, now);

    /*
     * ⚠️ La planification EN ÉCHEC est la seule qui fasse échouer le cycle : si
     * la file ne se remplit pas, rien ne rattrapera l'alerte manquée. Un échec
     * de diffusion, lui, laisse les lignes en file — elles repartiront à l'heure
     * suivante, et la notification in-app, elle, est déjà visible.
     */
    if (!scheduling.ok) {
      await finishJobRun(client, run.value, "FAILED", 0, 1, { code: scheduling.error.code });
      logger.error("Planification des notifications en échec", { code: scheduling.error.code });
      return { status: "FAILED", ...NOTHING, failed: 1, runId: run.value };
    }

    const dispatchFailed = !dispatch.ok;
    const digestFailed = !digest.ok;
    const failures =
      scheduling.value.failed +
      (dispatchFailed ? 1 : dispatch.value.failed) +
      (digestFailed ? 1 : digest.value.failed);

    const status = failures > 0 ? "PARTIAL" : "SUCCEEDED";

    await finishJobRun(client, run.value, status, scheduling.value.created, failures, {
      considered: scheduling.value.considered,
      created: scheduling.value.created,
      duplicates: scheduling.value.duplicates,
      schedulingFailures: scheduling.value.failures,
      digest: digestFailed ? { error: digest.error.code } : digest.value,
      dispatch: dispatchFailed ? { error: dispatch.error.code } : dispatch.value,
    });

    const outcome: NotificationJobOutcome = {
      status,
      scheduled: scheduling.value.created,
      duplicates: scheduling.value.duplicates,
      sent: dispatchFailed ? 0 : dispatch.value.sent,
      failed: failures,
      digestQueued: digestFailed ? 0 : digest.value.queued,
      runId: run.value,
    };

    logger.info("Cycle de notification terminé", { ...outcome });
    return outcome;
  } catch (cause) {
    // La clôture DOIT avoir lieu : une ligne restée à RUNNING est le seul signal
    // qui distingue une tâche interrompue d'une tâche jamais lancée.
    await finishJobRun(client, run.value, "FAILED", 0, 1, {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    logger.error("Cycle de notification interrompu", {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return { status: "FAILED", ...NOTHING, failed: 1, runId: run.value };
  } finally {
    await unlockJob(client, JOB_NAME);
  }
}
