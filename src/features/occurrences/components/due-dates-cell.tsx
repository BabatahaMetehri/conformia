"use client";

import { useTranslations } from "next-intl";

import { resolveUrgency } from "@/components/shared/due-date-indicator";
import { formatDateFr } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Les deux échéances d'une occurrence, dans leur hiérarchie voulue.
 *
 * ⚠️ CE COMPOSANT EST LE MÉCANISME ANTI-RETARD DU SYSTÈME.
 *
 * L'échéance INTERNE est l'objectif : grande, contrastée, colorée par urgence.
 * L'échéance LÉGALE n'est que la limite absolue : petite, atténuée, en dessous.
 * Ce décalage est délibéré — si les deux dates s'affichaient à égalité, l'équipe
 * viserait naturellement la plus lointaine, et la marge interne ne servirait à
 * rien. Inverser cette hiérarchie viderait la fonctionnalité de son sens.
 */

const URGENCY_TONE = {
  overdue: "text-due-overdue font-semibold",
  imminent: "text-due-imminent font-semibold",
  soon: "text-due-soon font-medium",
  far: "text-text-primary",
} as const;

export function DueDatesCell({
  internalDueDate,
  legalDueDate,
  daysToInternal,
  isOverdue,
  isInternallyLate,
}: {
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly daysToInternal: number;
  readonly isOverdue: boolean;
  readonly isInternallyLate: boolean;
}) {
  const t = useTranslations("occurrences.due");

  const internal = new Date(`${internalDueDate}T12:00:00Z`);
  const legal = new Date(`${legalDueDate}T12:00:00Z`);
  const urgency = isInternallyLate ? "overdue" : resolveUrgency(daysToInternal);

  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("text-sm", URGENCY_TONE[urgency])}>
        <time dateTime={internalDueDate} data-numeric>
          {formatDateFr(internal)}
        </time>
        {/*
          Le retard est dit par un MOT, pas seulement par une couleur : un statut
          ne doit jamais se lire à la seule teinte.
        */}
        {isInternallyLate ? <span className="ms-1.5 text-2xs">{t("internallyLate")}</span> : null}
      </span>

      <span className="text-2xs text-text-muted">
        <span className="sr-only">{t("legalLimit")} </span>
        <time dateTime={legalDueDate} data-numeric>
          {formatDateFr(legal)}
        </time>
        {isOverdue ? (
          <span className="ms-1.5 font-medium text-status-overdue">{t("overdue")}</span>
        ) : null}
      </span>
    </div>
  );
}

/** Avancement des pièces. `0/0` signifie « aucune pièce attendue », pas « rien de fait ». */
export function DocumentsCell({
  provided,
  required,
}: {
  readonly provided: number;
  readonly required: number;
}) {
  const t = useTranslations("occurrences");
  const complete = required > 0 && provided >= required;

  if (required === 0) {
    return <span className="text-xs text-text-muted">{t("noDocumentsExpected")}</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        complete ? "text-status-validated" : "text-text-secondary",
      )}
      // Le ratio brut « 2/5 » est illisible à voix haute : on l'explicite.
      aria-label={t("documentsProgress", { provided, required })}
    >
      <span aria-hidden="true" data-numeric>
        {provided}/{required}
      </span>
      <span aria-hidden="true" className="h-1 w-10 overflow-hidden rounded-full bg-border">
        <span
          className={cn("block h-full", complete ? "bg-status-validated" : "bg-status-progress")}
          style={{ width: `${String(Math.min(100, Math.round((provided / required) * 100)))}%` }}
        />
      </span>
    </span>
  );
}
