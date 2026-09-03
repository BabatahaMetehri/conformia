import "server-only";

/**
 * État des travaux planifiés — lecture seule.
 *
 * ⚠️ La vue `job_health` est interrogée telle quelle, sans reconstruire son
 * verdict côté application. Le calcul « jamais exécuté / périmé / en échec »
 * vit en base, où il sert AUSSI aux alertes : deux implémentations finiraient
 * par diverger, et l'écran finirait par rassurer pendant que l'alerte crie.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";

export type JobVerdict = "OK" | "STALE" | "FAILED" | "PARTIAL" | "NEVER_RAN";

export interface JobHealthRow {
  readonly jobName: string;
  readonly maxAgeHours: number;
  readonly status: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCount: number | null;
  readonly hoursSince: number | null;
  readonly verdict: JobVerdict;
}

export interface JobRunRow {
  readonly id: number;
  readonly jobName: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly processedCount: number;
  readonly errorCount: number;
}

const VERDICTS: ReadonlySet<string> = new Set(["OK", "STALE", "FAILED", "PARTIAL", "NEVER_RAN"]);

function toVerdict(value: unknown): JobVerdict {
  // Un verdict inconnu est traité comme un échec : une valeur que l'interface ne
  // sait pas lire ne doit jamais s'afficher en vert.
  return typeof value === "string" && VERDICTS.has(value) ? (value as JobVerdict) : "FAILED";
}

/** Le verdict de chaque travail ATTENDU, absence comprise. */
export async function listJobHealth(): Promise<Result<readonly JobHealthRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("job_health")
    .select(
      "job_name, max_age_hours, status, started_at, finished_at, error_count, hours_since, verdict",
    )
    .order("job_name", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      jobName: row.job_name ?? "",
      maxAgeHours: row.max_age_hours ?? 0,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorCount: row.error_count,
      hoursSince: row.hours_since,
      verdict: toVerdict(row.verdict),
    })),
  );
}

/** Les dernières exécutions, tous travaux confondus. */
export async function listRecentJobRuns(limit = 30): Promise<Result<readonly JobRunRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("job_runs")
    .select("id, job_name, status, started_at, finished_at, processed_count, error_count")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      jobName: row.job_name,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      processedCount: row.processed_count,
      errorCount: row.error_count,
    })),
  );
}
