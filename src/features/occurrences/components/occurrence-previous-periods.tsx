import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Link } from "@/i18n/navigation";
import { formatDateFr } from "@/lib/dates";
import type { OccurrenceDetailView } from "@/services/occurrences/detail";

/**
 * Onglet « Périodes précédentes ».
 *
 * Répond à l'exigence « historique des déclarations précédentes ». La question
 * posée devant un dossier en cours est presque toujours « comment a-t-on fait la
 * dernière fois » : y répondre en un clic, sans repasser par la liste ni
 * reconstruire un filtre, est tout l'objet de cet onglet.
 */
export function OccurrencePreviousPeriods({ detail }: { readonly detail: OccurrenceDetailView }) {
  const t = useTranslations("occurrences.detail");
  const tOcc = useTranslations("occurrences");

  if (detail.previousPeriods.length === 0) {
    return <EmptyState title={t("noPreviousPeriods")} description={t("noPreviousPeriodsHint")} />;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {detail.previousPeriods.map((occurrence) => (
        <li key={occurrence.id}>
          <Link
            href={`/echeancier/${occurrence.id}`}
            className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-surface-raised"
          >
            <span className="flex items-center gap-3">
              <span className="text-sm font-medium text-text-primary" data-numeric>
                {occurrence.periodKey}
              </span>
              <StatusBadge status={occurrence.status} />
            </span>

            <span className="flex items-center gap-3 text-xs text-text-muted">
              <span data-numeric>
                {tOcc("legalDueDate")}{" "}
                {formatDateFr(new Date(`${occurrence.legalDueDate}T12:00:00Z`))}
              </span>
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
