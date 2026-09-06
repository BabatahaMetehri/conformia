"use client";

import { CalendarClock, MoveRight, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Periodicity } from "@/config/constants";
import { formatDateFr } from "@/lib/dates";
import { previewDueDates, type DueDatePreview } from "@/services/scheduling";
import { cn } from "@/lib/utils";
import type { HolidayEntry } from "@/lib/holidays";

/**
 * Prévisualisation en direct des prochaines échéances.
 *
 * ⚠️ ÉLÉMENT DÉTERMINANT DE L'ÉCRAN. C'est ce qui permet à un utilisateur métier
 * de reconnaître une règle fausse en quelques secondes, sans lire de JSON et
 * sans attendre la première génération. Tout le reste du formulaire peut se
 * relire ; une règle d'échéance, non — elle ne se juge que sur ses dates.
 *
 * Le calcul est LOCAL : `previewDueDates` est pure et importable côté client, la
 * liste se met donc à jour à chaque frappe sans aller-retour. Et c'est la MÊME
 * fonction qui produira les occurrences réelles — ce qui est affiché ici est ce
 * qui sera généré, pas une approximation d'affichage.
 *
 * La colonne « calculée » montre la date AVANT report, la colonne « échéance »
 * après. Sans les deux, un report reste invisible et l'utilisateur croit à une
 * erreur de calcul.
 */

const PREVIEW_COUNT = 6;

export function DueRulePreview({
  rule,
  periodicity,
  holidays,
  internalLeadDays,
  anchorDate,
  className,
}: {
  readonly rule: unknown;
  readonly periodicity: Periodicity;
  /** Jours fériés au format `yyyy-MM-dd`, chargés une fois par le serveur. */
  readonly holidays: readonly HolidayEntry[];
  readonly internalLeadDays: number;
  /** Date d'expiration ou d'événement, pour les ancres qui en dépendent. */
  readonly anchorDate?: string | undefined;
  readonly className?: string;
}) {
  const t = useTranslations("obligations.preview");
  const format = useFormatter();

  const holidayDates = useMemo(() => holidays, [holidays]);

  const result = useMemo(
    () =>
      previewDueDates({
        rule,
        periodicity,
        count: PREVIEW_COUNT,
        holidays: holidayDates,
        internalLeadDays,
        ...(anchorDate === undefined || anchorDate.length === 0
          ? {}
          : { anchorDate: new Date(`${anchorDate}T12:00:00.000Z`) }),
      }),
    [rule, periodicity, holidayDates, internalLeadDays, anchorDate],
  );

  if (!result.ok) {
    const reason = result.error.details?.["reason"];
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-status-pending/40 bg-status-pending-bg px-3 py-2.5"
      >
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-pending" />
        <div className="text-sm text-text-primary">
          <p className="font-medium">{t("unavailable")}</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {typeof reason === "string" ? t(`reasons.${reason}`) : t("reasons.UNKNOWN")}
          </p>
        </div>
      </div>
    );
  }

  const previews = result.value;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <CalendarClock aria-hidden="true" className="size-4 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">{t("title")}</p>
        <Badge variant="secondary" className="ms-auto">
          {format.number(previews.length)}
        </Badge>
      </div>

      {periodicity === Periodicity.ON_EVENT ? (
        <p className="text-xs text-text-muted">{t("onEventNote")}</p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="bg-surface-raised text-xs text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("period")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("computed")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("legal")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t("internal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {previews.map((preview) => (
              <PreviewRow key={preview.periodKey} preview={preview} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewRow({ preview }: { readonly preview: DueDatePreview }) {
  const t = useTranslations("obligations.preview");
  const shifted = preview.shiftReason !== null;

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 font-medium text-text-primary" data-numeric>
        {preview.periodKey}
      </td>
      <td className={cn("px-3 py-2", shifted ? "text-text-muted line-through" : "text-text-muted")}>
        <time dateTime={preview.rawDueDate.toISOString()}>{formatDateFr(preview.rawDueDate)}</time>
      </td>
      <td className="px-3 py-2 text-text-primary">
        <span className="inline-flex items-center gap-1.5">
          {shifted ? (
            <MoveRight aria-hidden="true" className="size-3.5 text-text-muted rtl:-scale-x-100" />
          ) : null}
          <time dateTime={preview.legalDueDate.toISOString()}>
            {formatDateFr(preview.legalDueDate)}
          </time>
          {/*
            Le report est signalé par un LIBELLÉ, pas seulement par une couleur
            ou une flèche : un statut ne doit jamais se lire à la seule couleur.
          */}
          {preview.shiftReason === null ? null : (
            <Badge variant="outline" className="text-2xs">
              {t(`shift.${preview.shiftReason}`)}
            </Badge>
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-text-secondary">
        <time dateTime={preview.internalDueDate.toISOString()}>
          {formatDateFr(preview.internalDueDate)}
        </time>
      </td>
    </tr>
  );
}
