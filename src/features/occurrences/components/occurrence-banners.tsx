import { AlertTriangle, ArrowLeftRight, Info, ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/shared/status-badge";
import type { OccurrenceStatus } from "@/config/constants";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { OccurrenceDetailView } from "@/services/occurrences/detail";

/**
 * Bandeaux de contexte du dossier.
 *
 * ⚠️ Le bandeau de DÉPENDANCE informe, il ne bloque JAMAIS. Le métier sait
 * parfois ce que le modèle ignore — une AGO tenue mais pas encore saisie, un
 * accord verbal avec l'administration. Bloquer sur cette base produirait des
 * contournements hors de l'outil, c'est-à-dire la fin de la traçabilité.
 */
export function OccurrenceBanners({ detail }: { readonly detail: OccurrenceDetailView }) {
  const t = useTranslations("occurrences.detail");

  /** Statuts qui closent un dossier — les mêmes que ceux exemptés de retard. */
  const CLOSED: readonly OccurrenceStatus[] = ["SUBMITTED", "ARCHIVED", "NOT_APPLICABLE"];
  const dependency = detail.dependency;
  const dependencyOpen =
    dependency === null || dependency.status === null || !CLOSED.includes(dependency.status);

  return (
    <div className="mb-4 space-y-2">
      {detail.isOverdue ? (
        <Banner tone="danger" icon={<AlertTriangle aria-hidden="true" className="size-4" />}>
          {t("overdueBanner", { days: Math.abs(detail.daysToLegal) })}
        </Banner>
      ) : detail.isInternallyLate ? (
        // Alerte PRÉCOCE : la marge interne est consommée, la limite légale tient
        // encore. C'est la fenêtre pendant laquelle un retard se rattrape sans
        // conséquence — la montrer est tout l'intérêt de cette marge.
        <Banner tone="warning" icon={<AlertTriangle aria-hidden="true" className="size-4" />}>
          {t("internallyLateBanner", { days: detail.daysToLegal })}
        </Banner>
      ) : null}

      {dependency !== null && dependencyOpen ? (
        <Banner tone="info" icon={<Info aria-hidden="true" className="size-4" />}>
          <span>
            {t("dependencyBanner", {
              obligation: dependency.obligationName,
              period: dependency.periodKey ?? "—",
            })}{" "}
          </span>
          {dependency.status === null ? (
            <span className="text-text-muted">{t("dependencyMissing")}</span>
          ) : (
            <StatusBadge status={dependency.status} />
          )}
          {dependency.dependencyOccurrenceId === null ? null : (
            <Link
              href={`/echeancier/${dependency.dependencyOccurrenceId}`}
              className="ms-2 text-primary underline-offset-2 hover:underline"
            >
              {t("openDependency")}
            </Link>
          )}
        </Banner>
      ) : null}

      {detail.original === null ? null : (
        <Banner tone="info" icon={<ArrowLeftRight aria-hidden="true" className="size-4" />}>
          {t("isRectificationOf", { period: detail.original.periodKey })}{" "}
          <Link
            href={`/echeancier/${detail.original.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {t("openOriginal")}
          </Link>
        </Banner>
      )}

      {detail.rectifications.length === 0 ? null : (
        <Banner tone="info" icon={<ScrollText aria-hidden="true" className="size-4" />}>
          {t("hasRectifications", { count: detail.rectifications.length })}{" "}
          {detail.rectifications.map((rectification) => (
            <Link
              key={rectification.id}
              href={`/echeancier/${rectification.id}`}
              className="ms-2 text-primary underline-offset-2 hover:underline"
              data-numeric
            >
              {rectification.periodKey}
            </Link>
          ))}
        </Banner>
      )}

      {detail.rejectionReason === null || detail.status !== "REJECTED" ? null : (
        <Banner tone="warning" icon={<AlertTriangle aria-hidden="true" className="size-4" />}>
          {t("rejectedBanner", { reason: detail.rejectionReason })}
        </Banner>
      )}

      {detail.naReason === null || detail.status !== "NOT_APPLICABLE" ? null : (
        <Banner tone="info" icon={<Info aria-hidden="true" className="size-4" />}>
          {t("notApplicableBanner", { reason: detail.naReason })}
        </Banner>
      )}
    </div>
  );
}

type BannerTone = "info" | "warning" | "danger";

const TONE_CLASS: Readonly<Record<BannerTone, string>> = {
  info: "border-border bg-surface-raised text-text-secondary",
  warning: "border-due-soon/40 bg-due-soon/10 text-text-primary",
  danger: "border-due-overdue/40 bg-due-overdue/10 text-text-primary",
};

function Banner({
  tone,
  icon,
  children,
}: {
  readonly tone: BannerTone;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div
      // `status` et non `alert` : ces bandeaux accompagnent la lecture, ils
      // n'interrompent pas. Un `alert` couperait la parole au lecteur d'écran.
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        TONE_CLASS[tone],
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
