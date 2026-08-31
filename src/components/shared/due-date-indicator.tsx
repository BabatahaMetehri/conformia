import { AlertTriangle, CalendarClock, CalendarDays, CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Indicateur d'échéance : à quelle distance, et faut-il s'en inquiéter.
 *
 * Purement présentationnel — il reçoit un nombre de jours déjà calculé
 * (`daysUntil()` de `src/lib/dates`, en fuseau Africa/Algiers). Il ne lit ni
 * l'horloge ni la base : un composant qui calculerait « aujourd'hui » lui-même
 * afficherait une date différente du serveur qui l'a rendu.
 */

export type DueUrgency = "far" | "soon" | "imminent" | "overdue";

/** Seuils métier : J-30 lointain, J-7 proche, J-1 imminent, puis dépassé. */
const SOON_THRESHOLD_DAYS = 7;
const IMMINENT_THRESHOLD_DAYS = 1;

export function resolveUrgency(daysRemaining: number): DueUrgency {
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= IMMINENT_THRESHOLD_DAYS) return "imminent";
  if (daysRemaining <= SOON_THRESHOLD_DAYS) return "soon";
  return "far";
}

const URGENCY_PRESENTATION: Readonly<
  Record<DueUrgency, { readonly icon: typeof CalendarDays; readonly className: string }>
> = {
  far: { icon: CalendarDays, className: "text-due-far" },
  soon: { icon: CalendarClock, className: "text-due-soon" },
  imminent: { icon: CircleAlert, className: "text-due-imminent font-medium" },
  overdue: { icon: AlertTriangle, className: "text-due-overdue font-semibold" },
};

interface DueDateIndicatorProps {
  /** Échéance déjà formatée pour l'affichage (`formatDateFr`). */
  readonly formattedDate: string;
  /** Date ISO, pour l'attribut `dateTime` de `<time>`. */
  readonly isoDate: string;
  /** Jours civils restants : négatif si l'échéance est dépassée. */
  readonly daysRemaining: number;
  readonly className?: string;
}

export function DueDateIndicator({
  formattedDate,
  isoDate,
  daysRemaining,
  className,
}: DueDateIndicatorProps) {
  const t = useTranslations("occurrences.due");
  const urgency = resolveUrgency(daysRemaining);
  const { icon: Icon, className: tone } = URGENCY_PRESENTATION[urgency];

  // Trois signaux redondants : la teinte, la forme de l'icône, et le texte.
  // L'urgence reste lisible en noir et blanc.
  const relative =
    urgency === "overdue"
      ? t("overdue", { days: Math.abs(daysRemaining) })
      : t("remaining", { days: daysRemaining });

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", tone, className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {/* `<time>` hérite de tabular-nums : les dates s'alignent en colonne. */}
      <time dateTime={isoDate}>{formattedDate}</time>
      <span className="text-xs opacity-90">({relative})</span>
    </span>
  );
}
