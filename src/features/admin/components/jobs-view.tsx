import { AlertTriangle, CheckCircle2, CircleSlash, Clock } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/states";
import type { JobHealthRow, JobRunRow, JobVerdict } from "@/services/admin/jobs";
import { cn } from "@/lib/utils";

/**
 * Surveillance des travaux planifiés.
 *
 * ⚠️ CET ÉCRAN EXISTE POUR MONTRER CE QUI N'A PAS EU LIEU.
 *
 * Une liste d'exécutions passées est rassurante par construction : elle ne peut
 * afficher que ce qui a tourné. Un planificateur arrêté n'y produit aucune
 * ligne rouge — il n'y produit RIEN, et l'écran reste vert. Le tableau du haut
 * part donc de la liste des travaux ATTENDUS et rend un verdict pour chacun,
 * `NEVER_RAN` compris.
 *
 * ⚠️ Composant SERVEUR : il n'y a ici aucune interaction, seulement de la
 * lecture. Le rendre client enverrait ces données au navigateur pour rien.
 */

const TONE: Readonly<Record<JobVerdict, string>> = {
  OK: "text-due-far",
  PARTIAL: "text-due-soon",
  STALE: "text-due-soon",
  FAILED: "text-destructive",
  NEVER_RAN: "text-destructive",
};

function VerdictIcon({ verdict }: { readonly verdict: JobVerdict }) {
  const className = cn("size-4 shrink-0", TONE[verdict]);
  if (verdict === "OK") return <CheckCircle2 aria-hidden="true" className={className} />;
  if (verdict === "NEVER_RAN") return <CircleSlash aria-hidden="true" className={className} />;
  if (verdict === "STALE") return <Clock aria-hidden="true" className={className} />;
  return <AlertTriangle aria-hidden="true" className={className} />;
}

export async function JobsView({
  health,
  runs,
}: {
  readonly health: readonly JobHealthRow[];
  readonly runs: readonly JobRunRow[];
}) {
  const t = await getTranslations("admin.jobs");
  const format = await getFormatter();

  const failing = health.filter((row) => row.verdict !== "OK");

  return (
    <div className="space-y-6">
      {failing.length === 0 ? null : (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium text-destructive">{t("alertTitle")}</p>
          <ul className="mt-1 space-y-0.5 text-text-secondary">
            {failing.map((row) => (
              <li key={row.jobName}>
                {t(`verdict.${row.verdict}`)} — <span className="font-mono">{row.jobName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="jobs-expected">
        <h2 id="jobs-expected" className="mb-2 text-sm font-medium text-text-primary">
          {t("expectedTitle")}
        </h2>
        <p className="mb-3 text-xs text-text-muted">{t("expectedHint")}</p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-muted text-start text-xs text-text-secondary">
              <tr>
                <th scope="col" className="p-2 text-start font-medium">
                  {t("columns.job")}
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {t("columns.verdict")}
                </th>
                <th scope="col" className="p-2 text-end font-medium">
                  {t("columns.age")}
                </th>
                <th scope="col" className="p-2 text-end font-medium">
                  {t("columns.threshold")}
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {t("columns.lastRun")}
                </th>
              </tr>
            </thead>
            <tbody>
              {health.map((row) => (
                <tr key={row.jobName} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{row.jobName}</td>
                  <td className="p-2">
                    <span className={cn("inline-flex items-center gap-1.5", TONE[row.verdict])}>
                      <VerdictIcon verdict={row.verdict} />
                      {t(`verdict.${row.verdict}`)}
                    </span>
                  </td>
                  <td className="p-2 text-end" data-numeric>
                    {row.hoursSince === null ? "—" : t("hours", { value: row.hoursSince })}
                  </td>
                  <td className="p-2 text-end text-text-muted" data-numeric>
                    {t("hours", { value: row.maxAgeHours })}
                  </td>
                  <td className="p-2 text-text-secondary">
                    {row.finishedAt === null
                      ? "—"
                      : format.dateTime(new Date(row.finishedAt), "short")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="jobs-recent">
        <h2 id="jobs-recent" className="mb-2 text-sm font-medium text-text-primary">
          {t("recentTitle")}
        </h2>

        {runs.length === 0 ? (
          <EmptyState title={t("noRuns")} description={t("noRunsHint")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-muted text-xs text-text-secondary">
                <tr>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.job")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.status")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.startedAt")}
                  </th>
                  <th scope="col" className="p-2 text-end font-medium">
                    {t("columns.processed")}
                  </th>
                  <th scope="col" className="p-2 text-end font-medium">
                    {t("columns.errors")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className="p-2 font-mono text-xs">{run.jobName}</td>
                    <td className="p-2">
                      <Badge variant={run.status === "FAILED" ? "destructive" : "secondary"}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="p-2 text-text-secondary">
                      {format.dateTime(new Date(run.startedAt), "short")}
                    </td>
                    <td className="p-2 text-end" data-numeric>
                      {run.processedCount}
                    </td>
                    <td
                      className={cn("p-2 text-end", run.errorCount > 0 ? "text-destructive" : "")}
                      data-numeric
                    >
                      {run.errorCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
