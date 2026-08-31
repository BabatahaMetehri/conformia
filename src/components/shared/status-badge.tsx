import {
  Archive,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  CopyCheck,
  MinusCircle,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Criticality, OccurrenceStatus, Periodicity } from "@/config/constants";
import { cn } from "@/lib/utils";

/**
 * Badges d'état. Purement présentationnels : aucun appel de données.
 *
 * ⚠️ ACCESSIBILITÉ — un statut n'est JAMAIS signalé par la seule couleur.
 * Chaque badge porte trois signaux redondants : la teinte, une icône de forme
 * distincte, et le libellé écrit. Un daltonien, un écran monochrome et un
 * lecteur d'écran lisent la même information.
 *
 * Les classes sont écrites en toutes lettres et non composées : Tailwind lit le
 * source statiquement, une classe assemblée à l'exécution ne serait jamais générée.
 */

interface StatusPresentation {
  readonly icon: LucideIcon;
  readonly className: string;
}

const STATUS_PRESENTATION: Readonly<Record<OccurrenceStatus, StatusPresentation>> = {
  TODO: { icon: Circle, className: "bg-status-todo-bg text-status-todo" },
  IN_PROGRESS: { icon: CircleDot, className: "bg-status-progress-bg text-status-progress" },
  PENDING_VALIDATION: { icon: Clock, className: "bg-status-pending-bg text-status-pending" },
  REJECTED: { icon: XCircle, className: "bg-status-rejected-bg text-status-rejected" },
  VALIDATED: { icon: CheckCircle2, className: "bg-status-validated-bg text-status-validated" },
  SUBMITTED: { icon: Send, className: "bg-status-submitted-bg text-status-submitted" },
  ARCHIVED: { icon: Archive, className: "bg-status-archived-bg text-status-archived" },
  NOT_APPLICABLE: { icon: MinusCircle, className: "bg-status-na-bg text-status-na" },
};

const BADGE_BASE =
  "inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function StatusBadge({
  status,
  className,
}: {
  readonly status: OccurrenceStatus;
  readonly className?: string;
}) {
  const t = useTranslations("occurrences.status");
  const { icon: Icon, className: tone } = STATUS_PRESENTATION[status];

  return (
    <span className={cn(BADGE_BASE, tone, className)}>
      {/* L'icône est décorative : le libellé qui suit porte déjà l'information. */}
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {t(status)}
    </span>
  );
}

// ─── Périodicité ─────────────────────────────────────────────────────────────

export function PeriodicityBadge({
  periodicity,
  className,
}: {
  readonly periodicity: Periodicity;
  readonly className?: string;
}) {
  const t = useTranslations("obligations.periodicity");

  return (
    <span
      className={cn(
        BADGE_BASE,
        "border-border bg-transparent font-normal text-text-secondary",
        className,
      )}
    >
      {t(periodicity)}
    </span>
  );
}

// ─── Criticité ───────────────────────────────────────────────────────────────

/**
 * La criticité est rendue par un compteur de barres pleines, pas par une seule
 * pastille colorée : le NOMBRE de barres reste lisible sans distinguer les teintes.
 */
const CRITICALITY_LEVEL: Readonly<Record<Criticality, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const CRITICALITY_TONE: Readonly<Record<Criticality, string>> = {
  LOW: "bg-status-todo",
  MEDIUM: "bg-status-pending",
  HIGH: "bg-status-rejected",
  CRITICAL: "bg-status-overdue",
};

export function CriticalityIndicator({
  criticality,
  className,
}: {
  readonly criticality: Criticality;
  readonly className?: string;
}) {
  const t = useTranslations("obligations.criticality");
  const level = CRITICALITY_LEVEL[criticality];
  const label = t(criticality);

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className="inline-flex items-end gap-0.5">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "w-1 rounded-xs",
              step <= level ? CRITICALITY_TONE[criticality] : "bg-border",
              step === 1 && "h-1.5",
              step === 2 && "h-2",
              step === 3 && "h-2.5",
              step === 4 && "h-3",
            )}
          />
        ))}
      </span>
      <span className="text-xs text-text-secondary">{label}</span>
    </span>
  );
}

// ─── Rectificative ───────────────────────────────────────────────────────────

/**
 * Signale qu'une occurrence rectifie un dépôt antérieur, et renvoie à l'originale.
 * Sans ce rappel, deux lignes « G50 janvier 2026 » se ressemblent trop pour qu'on
 * comprenne laquelle fait foi.
 */
export function RectificationBadge({
  index,
  originalHref,
  className,
}: {
  readonly index: number;
  /** Lien vers l'occurrence d'origine. Absent, le badge reste informatif. */
  readonly originalHref?: string;
  readonly className?: string;
}) {
  const t = useTranslations("occurrences.rectification");

  const content = (
    <>
      <CopyCheck aria-hidden="true" className="size-3.5 shrink-0" />
      {t("badge", { index })}
    </>
  );

  const tone = "bg-status-submitted-bg text-status-submitted";

  if (originalHref === undefined) {
    return <span className={cn(BADGE_BASE, tone, className)}>{content}</span>;
  }

  return (
    <a
      href={originalHref}
      className={cn(BADGE_BASE, tone, "hover:underline", className)}
      aria-label={t("linkToOriginal", { index })}
    >
      {content}
    </a>
  );
}
