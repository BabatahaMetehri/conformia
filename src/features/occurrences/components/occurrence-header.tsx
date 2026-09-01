import { Building2, ExternalLink, Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  CriticalityIndicator,
  RectificationBadge,
  StatusBadge,
} from "@/components/shared/status-badge";
import { DueDateIndicator } from "@/components/shared/due-date-indicator";
import { Badge } from "@/components/ui/badge";
import { formatDateFr } from "@/lib/dates";
import type { OccurrenceDetailView } from "@/services/occurrences/detail";

/**
 * En-tête du dossier.
 *
 * ⚠️ L'ÉCHÉANCE INTERNE occupe le premier plan, avec son compte à rebours ;
 * l'échéance légale n'apparaît qu'en second, en petit, comme limite absolue. Ce
 * décalage d'affichage est le mécanisme le plus efficace du système contre les
 * retards, et il est reconduit ici tel qu'il l'est dans la liste.
 *
 * Composant SERVEUR : le compte à rebours est calculé côté serveur, en fuseau
 * d'Alger. Un décompte recalculé dans le navigateur afficherait, à cheval sur
 * minuit, un jour d'écart avec la page qui l'a produit.
 */
export function OccurrenceHeader({ detail }: { readonly detail: OccurrenceDetailView }) {
  const t = useTranslations("occurrences");
  const tDetail = useTranslations("occurrences.detail");

  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">
              {detail.obligation.name}
            </h1>
            <StatusBadge status={detail.status} />
            {detail.rectificationIndex > 0 ? (
              <RectificationBadge index={detail.rectificationIndex} />
            ) : null}
            {detail.isLocked ? (
              <Badge variant="outline">
                <Lock aria-hidden="true" className="size-3" />
                {tDetail("locked")}
              </Badge>
            ) : null}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
            <span data-numeric>{detail.obligation.code}</span>
            <span data-numeric>{detail.periodKey}</span>
            {detail.obligation.authorityName === null ? null : (
              <span className="inline-flex items-center gap-1">
                <Building2 aria-hidden="true" className="size-3.5" />
                {detail.obligation.authorityName}
              </span>
            )}
            {detail.obligation.portalUrl === null ? null : (
              <a
                href={detail.obligation.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {tDetail("openPortal")}
              </a>
            )}
          </p>
        </div>

        {/* Bloc d'échéances : l'interne domine, la légale suit en retrait. */}
        <div className="shrink-0 text-end">
          <p className="mb-1 text-xs font-medium tracking-wide text-text-muted uppercase">
            {t("internalDueDate")}
          </p>
          <DueDateIndicator
            className="justify-end text-base"
            formattedDate={formatDateFr(new Date(`${detail.internalDueDate}T12:00:00Z`))}
            isoDate={detail.internalDueDate}
            daysRemaining={detail.daysToInternal}
          />
          <p className="mt-1 text-xs text-text-muted" data-numeric>
            {t("legalDueDate")} · {formatDateFr(new Date(`${detail.legalDueDate}T12:00:00Z`))}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("owner")} value={detail.ownerName} />
        <Field label={t("validator")} value={detail.validatorName} />
        <Field label={t("domain")} value={detail.obligation.domainLabel} />
        <div>
          <dt className="text-xs font-medium tracking-wide text-text-muted uppercase">
            {t("criticalityColumn")}
          </dt>
          <dd className="mt-1">
            <CriticalityIndicator criticality={detail.obligation.criticality} />
          </dd>
        </div>
      </dl>
    </header>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string | null }) {
  const t = useTranslations("common");
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-text-primary">{value ?? t("notProvided")}</dd>
    </div>
  );
}
