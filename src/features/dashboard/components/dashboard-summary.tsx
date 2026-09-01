import { AlertTriangle, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { DataTable } from "@/features/dashboard/components/chart-frame";
import type { DashboardView } from "@/services/dashboard";

/**
 * Indicateurs et bandeau d'alertes.
 *
 * Composants SERVEUR : ce sont des nombres, pas des interactions. Les rendre
 * côté client n'ajouterait qu'un aller-retour.
 *
 * ⚠️ Un indicateur est une TUILE, pas un graphique à une barre. Un nombre unique
 * se lit mieux écrit en grand que dessiné.
 */

/** Tuile d'indicateur. `null` s'affiche « — », jamais « 0 % » : l'absence de
 *  dénominateur n'est pas une performance nulle. */
function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly tone?: "neutral" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{label}</p>
      <p
        data-numeric
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "warning" ? "text-status-overdue" : "text-text-primary"
        }`}
      >
        {value}
      </p>
      {hint === undefined ? null : <p className="mt-0.5 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

export async function DashboardSummary({ view }: { readonly view: DashboardView }) {
  const t = await getTranslations("dashboard");

  const overdue = view.overdueByCriticality[0]?.total ?? 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Stat
        label={t("kpi.compliance")}
        value={view.complianceRate === null ? "—" : `${String(view.complianceRate)} %`}
        hint={t("kpi.complianceHint")}
      />
      <Stat
        label={t("kpi.overdue")}
        value={String(overdue)}
        hint={t("kpi.overdueHint")}
        tone={overdue > 0 ? "warning" : "neutral"}
      />
      <Stat
        label={t("kpi.upcoming")}
        value={String(view.dueWithin30Days)}
        hint={t("kpi.upcomingHint")}
      />
      <Stat
        label={t("kpi.pending")}
        value={String(view.pendingValidation)}
        hint={t("kpi.pendingHint", { days: view.pendingAvgDays })}
      />
      <Stat
        label={t("kpi.completeness")}
        value={view.completenessRate === null ? "—" : `${String(view.completenessRate)} %`}
        hint={t("kpi.completenessHint")}
      />
    </div>
  );
}

export async function DashboardAlerts({ view }: { readonly view: DashboardView }) {
  const t = await getTranslations("dashboard");

  if (view.alerts.length === 0) return null;

  return (
    <section
      aria-labelledby="dashboard-alerts"
      className="rounded-lg border border-status-overdue/40 bg-status-overdue-bg p-3"
    >
      <h2
        id="dashboard-alerts"
        className="flex items-center gap-2 text-sm font-semibold text-status-overdue"
      >
        <ShieldAlert aria-hidden="true" className="size-4" />
        {t("alerts.title")}
      </h2>

      <ul className="mt-2 space-y-1">
        {view.alerts.map((alert) => (
          <li key={alert.code} className="flex items-center gap-2 text-sm text-text-primary">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-status-overdue" />
            {/* ⚠️ Le compteur ET le libellé : « 3 » seul n'est pas une alerte,
                et une alerte sans nombre ne dit pas s'il faut courir. */}
            <span>{t(`alerts.${alert.code}`, { count: alert.total })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Motifs de retard.
 *
 * ⚠️ L'indicateur le plus actionnable du produit : il dit POURQUOI les retards
 * se produisent, ce qu'aucun taux ne dit. Il est rendu en TABLE et non en
 * graphique — cinq motifs et leurs volumes se lisent mieux écrits, et un
 * camembert de cinq parts proches serait illisible.
 */
export async function LateReasonPanel({ view }: { readonly view: DashboardView }) {
  const t = await getTranslations("dashboard");
  const tReasons = await getTranslations("occurrences.detail.lateReasons");

  const total = view.lateReasons.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("lateReasons.title")}</h2>
      <p className="mt-0.5 mb-3 text-xs text-text-muted">{t("lateReasons.hint")}</p>

      {view.lateReasons.length === 0 ? (
        <p className="text-sm text-text-secondary">{t("lateReasons.empty")}</p>
      ) : (
        <DataTable
          caption={t("lateReasons.title")}
          columns={[t("reason"), t("count"), t("share")]}
          rows={view.lateReasons.map((entry) => [
            tReasons(entry.code),
            entry.total,
            total === 0 ? "—" : `${String(Math.round((entry.total / total) * 100))} %`,
          ])}
        />
      )}
    </section>
  );
}

/** Charge par personne — la charge sans le nom ne permet aucune décision. */
export async function WorkloadPanel({ view }: { readonly view: DashboardView }) {
  const t = await getTranslations("dashboard");

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("workload.title")}</h2>
      <p className="mt-0.5 mb-3 text-xs text-text-muted">{t("workload.hint")}</p>

      {view.people.length === 0 ? (
        <p className="text-sm text-text-secondary">{t("workload.empty")}</p>
      ) : (
        <DataTable
          caption={t("workload.title")}
          columns={[t("person"), t("open"), t("late")]}
          rows={view.people.map((person) => [person.label, person.open, person.late])}
        />
      )}
    </section>
  );
}
