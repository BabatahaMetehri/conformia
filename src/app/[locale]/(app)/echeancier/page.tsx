import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import type { Criticality, OccurrenceStatus } from "@/config/constants";
import { OccurrenceFilterBar } from "@/features/occurrences/components/occurrence-filters";
import { OccurrenceListView } from "@/features/occurrences/components/occurrence-list-view";
import { getFormOptions } from "@/services/obligations";
import { requireAuthContext } from "@/services/auth/context";
import { requireSectionAccess } from "@/services/navigation/guard";
import { listCommercialRegisters } from "@/services/registers";
import { getSummary, listOccurrences, parseOccurrenceFilters } from "@/services/occurrences";
import { listAssignableProfiles } from "@/data/queries/profiles-directory";

/**
 * Échéancier — écran le plus consulté de l'application.
 *
 * Server Component : la page arrive rendue, avec ses 50 lignes. Aucun chargement
 * complet côté client, aucun filtrage en mémoire.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionAccess("/echeancier");

  const t = await getTranslations("occurrences");
  const params = await searchParams;

  const filters = parseOccurrenceFilters(params);
  // Une URL sans aucun paramètre autorise la restauration des derniers filtres.
  // Dès qu'un seul est présent, l'URL fait foi : un lien partagé doit montrer à
  // son destinataire ce que son auteur voyait.
  const urlHadFilters = Object.keys(params).length > 0;

  const [list, summary, options, context, assignees, registers] = await Promise.all([
    listOccurrences(filters, { urlHadFilters }),
    getSummary(),
    getFormOptions(),
    requireAuthContext(),
    listAssignableProfiles(),
    // Le filtre par registre a besoin de la liste ; elle est courte et cachée
    // par Next entre deux rendus.
    listCommercialRegisters(),
  ]);

  if (!list.ok) {
    return (
      <>
        <SectionHeader titleKey="occurrences" descriptionKey="occurrences" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  const canAssign = context.ok && context.value.permissions.has("occurrence.assign");
  const canExport = context.ok && context.value.permissions.has("export.generate");

  const calendarQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw !== undefined && key !== "cursor") calendarQuery.set(key, raw);
  }

  return (
    <>
      <SectionHeader titleKey="occurrences" descriptionKey="occurrences" />

      {summary.ok ? (
        <dl className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label={t("summary.total")} value={summary.value.total} />
          <SummaryCard
            label={t("summary.overdue")}
            value={summary.value.overdue}
            tone="text-status-overdue"
          />
          <SummaryCard
            label={t("summary.internallyLate")}
            value={summary.value.internallyLate}
            tone="text-status-pending"
          />
          <SummaryCard label={t("summary.dueWithinWeek")} value={summary.value.dueWithinWeek} />
        </dl>
      ) : null}

      <OccurrenceFilterBar
        domains={options.ok ? options.value.domains.map((d) => ({ id: d.id, label: d.label })) : []}
        authorities={
          options.ok ? options.value.authorities.map((a) => ({ id: a.id, name: a.name })) : []
        }
        owners={assignees.ok ? assignees.value : []}
        registers={
          registers.ok
            ? registers.value.map((r) => ({ id: r.id, label: `${r.rcNumber} — ${r.label}` }))
            : []
        }
        calendarHref={`/echeancier/calendrier?${calendarQuery.toString()}`}
      />

      <OccurrenceListView
        rows={list.value.page.items.map((row) => ({
          id: row.id,
          obligationCode: row.obligationCode,
          obligationName: row.obligationName,
          periodKey: row.periodKey,
          internalDueDate: row.internalDueDate,
          legalDueDate: row.legalDueDate,
          daysToInternal: row.daysToInternal,
          isOverdue: row.isOverdue,
          isInternallyLate: row.isInternallyLate,
          status: row.status as OccurrenceStatus,
          ownerName: row.ownerName,
          validatorName: row.validatorName,
          documentsProvided: row.documentsProvided,
          documentsRequired: row.documentsRequired,
          criticality: row.criticality as Criticality,
          rectificationIndex: row.rectificationIndex,
          isLocked: row.isLocked,
          domainLabel: row.domainLabel,
          obligationScope: row.obligationScope,
          registerNumber: row.registerNumber,
        }))}
        nextCursor={list.value.page.nextCursor}
        hasPreviousPage={filters.cursor !== undefined}
        sort={list.value.filters.sort}
        direction={list.value.filters.direction}
        assignees={assignees.ok ? assignees.value : []}
        canAssign={canAssign}
        canExport={canExport}
      />
    </>
  );
}

async function SummaryCard({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: string;
}) {
  const t = await getTranslations("occurrences.summary");

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold ${tone ?? "text-text-primary"}`} data-numeric>
        {value}
      </dd>
      {/* Les agrégats viennent d'une vue matérialisée rafraîchie toutes les 15
          minutes : le dire évite qu'un écart d'une unité passe pour un défaut. */}
      <dd className="mt-0.5 text-2xs text-text-muted">{t("freshness")}</dd>
    </div>
  );
}
