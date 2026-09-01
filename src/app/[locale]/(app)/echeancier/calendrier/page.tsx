import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import type { Criticality, OccurrenceStatus } from "@/config/constants";
import { OccurrenceCalendar } from "@/features/occurrences/components/occurrence-calendar";
import { OccurrenceFilterBar } from "@/features/occurrences/components/occurrence-filters";
import { listAssignableProfiles } from "@/data/queries/profiles-directory";
import { getFormOptions } from "@/services/obligations";
import { requireSectionAccess } from "@/services/navigation/guard";
import { getCalendar, parseOccurrenceFilters, type CalendarScale } from "@/services/occurrences";

/**
 * Vue calendrier de l'échéancier.
 *
 * ⚠️ UNE seule requête pour l'intervalle affiché, quelle que soit l'échelle.
 * Le basculement liste/calendrier conserve les filtres : ils voyagent dans
 * l'URL, les deux écrans lisent la même chose.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionAccess("/echeancier");

  const t = await getTranslations("occurrences");
  const params = await searchParams;

  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const rawScale = single("scale");
  const scale: CalendarScale = rawScale === "quarter" || rawScale === "year" ? rawScale : "month";

  const filters = parseOccurrenceFilters(params);

  const [calendar, options, assignees] = await Promise.all([
    getCalendar(single("anchor"), scale, filters),
    getFormOptions(),
    listAssignableProfiles(),
  ]);

  if (!calendar.ok) {
    return (
      <>
        <SectionHeader titleKey="occurrences" descriptionKey="occurrences" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  const listQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const raw = Array.isArray(value) ? value[0] : value;
    // `anchor` et `scale` n'ont pas de sens dans la liste : ils ne la suivent pas.
    if (raw !== undefined && key !== "anchor" && key !== "scale") listQuery.set(key, raw);
  }

  return (
    <>
      <SectionHeader titleKey="occurrencesCalendar" descriptionKey="occurrencesCalendar" />

      <OccurrenceFilterBar
        isCalendar
        domains={options.ok ? options.value.domains.map((d) => ({ id: d.id, label: d.label })) : []}
        authorities={
          options.ok ? options.value.authorities.map((a) => ({ id: a.id, name: a.name })) : []
        }
        owners={assignees.ok ? assignees.value : []}
        calendarHref={`/echeancier?${listQuery.toString()}`}
      />

      <OccurrenceCalendar
        from={calendar.value.from}
        to={calendar.value.to}
        scale={calendar.value.scale}
        items={calendar.value.items.map((row) => ({
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
        }))}
      />
    </>
  );
}
