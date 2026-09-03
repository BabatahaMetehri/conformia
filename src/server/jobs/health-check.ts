/**
 * SONDE DE SANTÉ — la partie qui touche l'infrastructure.
 *
 * ⚠️ ELLE VIT DANS `src/server/jobs/` PARCE QUE C'EST LE SEUL ENDROIT OÙ LA CLÉ
 * DE SERVICE A LE DROIT D'ÊTRE (CLAUDE.md §6). La route `/api/health` ne fait
 * que l'appeler par import DYNAMIQUE : le module reste hors de son graphe
 * statique, et la clé n'entre jamais dans une route handler. C'est le même
 * montage que `/api/cron/generate`, pour la même raison.
 *
 * ⚠️ Pourquoi la clé de service est nécessaire ici : la sonde doit répondre
 * QUAND L'AUTHENTIFICATION EST EN PANNE. Une sonde qui exige une session ne dit
 * rien précisément le jour où on l'interroge. `health_snapshot()` est réservée
 * au rôle de service pour cette raison, et ne rend aucune donnée métier —
 * booléens, horodatages, compteurs.
 */

// ⚠️ EN PREMIER, avant tout import qui mène au client de service : c'est ce
// marqueur qui autorise sa garde à s'ouvrir dans un build bundlé.
import "@/server/jobs/_job-context";

import { BACKUP_MAX_AGE_HOURS, GENERATION_MAX_AGE_HOURS } from "@/config/constants";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type HealthVerdict = "ok" | "degraded" | "down";

export interface HealthCheck {
  readonly name: string;
  readonly ok: boolean;
  /** Renseigné uniquement quand la vérification échoue ou vieillit. */
  readonly detail?: string;
}

export interface HealthReport {
  readonly status: HealthVerdict;
  readonly checkedAt: string;
  readonly checks: readonly HealthCheck[];
  /** Détail opérationnel — réservé aux appels authentifiés par le secret. */
  readonly detail: {
    readonly lastGenerationAt: string | null;
    readonly hoursSinceGeneration: number | null;
    readonly lastBackupAt: string | null;
    readonly hoursSinceBackup: number | null;
    readonly failedJobs24h: number | null;
    readonly pendingNotifications: number | null;
  };
}

interface Snapshot {
  readonly last_generation_at?: string | null;
  readonly hours_since_generation?: number | null;
  readonly last_backup_at?: string | null;
  readonly hours_since_backup?: number | null;
  readonly failed_jobs_24h?: number | null;
  readonly pending_notifications?: number | null;
}

function ageCheck(name: string, hours: number | null | undefined, maxHours: number): HealthCheck {
  if (hours === null || hours === undefined) {
    /*
     * ⚠️ « Jamais » n'est PAS « récent ». Une installation neuve reste donc
     * dégradée jusqu'à sa première exécution réussie. L'inverse — considérer
     * l'absence comme normale — laisserait passer une plateforme qui n'a jamais
     * rien produit, ce qui est exactement l'état qu'on cherche à détecter.
     */
    return { name, ok: false, detail: "aucune exécution réussie enregistrée" };
  }
  if (hours > maxHours) {
    return {
      name,
      ok: false,
      detail: `dernière réussite il y a ${hours.toFixed(1)} h (seuil ${String(maxHours)} h)`,
    };
  }
  return { name, ok: true };
}

export async function runHealthCheck(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  let snapshot: Snapshot = {};

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("health_snapshot");
    if (error !== null) throw new Error(error.message);
    snapshot = (data ?? {}) as Snapshot;
    checks.push({ name: "database", ok: true });
  } catch (cause) {
    logger.error("Sonde de santé : base injoignable", { cause: String(cause) });
    checks.push({ name: "database", ok: false, detail: "injoignable" });
  }

  /*
   * Le stockage est éprouvé par une opération RÉELLE — énumérer les buckets —
   * et non par un ping. Un service qui accepte la connexion mais refuse les
   * objets répondrait « en bonne santé » à toute vérification plus superficielle,
   * pendant qu'aucune pièce ne serait téléchargeable.
   */
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage.listBuckets();
    if (error !== null) throw new Error(error.message);
    checks.push({ name: "storage", ok: true });
  } catch (cause) {
    logger.error("Sonde de santé : stockage injoignable", { cause: String(cause) });
    checks.push({ name: "storage", ok: false, detail: "injoignable" });
  }

  const databaseUp = checks.some((check) => check.name === "database" && check.ok);
  if (databaseUp) {
    checks.push(
      ageCheck("generation", snapshot.hours_since_generation, GENERATION_MAX_AGE_HOURS),
      ageCheck("backup", snapshot.hours_since_backup, BACKUP_MAX_AGE_HOURS),
    );
  }

  const essentialsDown = checks.some(
    (check) => !check.ok && (check.name === "database" || check.name === "storage"),
  );
  const anythingDown = checks.some((check) => !check.ok);

  return {
    status: essentialsDown ? "down" : anythingDown ? "degraded" : "ok",
    checkedAt: new Date().toISOString(),
    checks,
    detail: {
      lastGenerationAt: snapshot.last_generation_at ?? null,
      hoursSinceGeneration: snapshot.hours_since_generation ?? null,
      lastBackupAt: snapshot.last_backup_at ?? null,
      hoursSinceBackup: snapshot.hours_since_backup ?? null,
      failedJobs24h: snapshot.failed_jobs_24h ?? null,
      pendingNotifications: snapshot.pending_notifications ?? null,
    },
  };
}
