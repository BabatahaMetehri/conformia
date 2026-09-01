"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OccurrenceRowView } from "@/features/occurrences/components/types";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { formatDateFr } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Calendrier des échéances.
 *
 * ⚠️ Les occurrences sont positionnées à leur échéance INTERNE, pas à la légale.
 * C'est la date à laquelle le travail doit être fait ; placer les pastilles sur
 * la limite légale annulerait la marge que l'organisation s'est donnée.
 *
 * Les données arrivent DÉJÀ chargées pour toute la fenêtre, en une requête.
 * Ce composant ne fait que les disposer — il n'interroge rien.
 */

const STATUS_DOT: Readonly<Record<string, string>> = {
  TODO: "bg-status-todo",
  IN_PROGRESS: "bg-status-progress",
  PENDING_VALIDATION: "bg-status-pending",
  REJECTED: "bg-status-rejected",
  VALIDATED: "bg-status-validated",
  SUBMITTED: "bg-status-submitted",
  ARCHIVED: "bg-status-archived",
  NOT_APPLICABLE: "bg-status-na",
};

/** Au-delà, la case devient illisible : le reste passe derrière un « +N ». */
const MAX_VISIBLE_PER_DAY = 3;

export type CalendarScale = "month" | "quarter" | "year";

export function OccurrenceCalendar({
  from,
  to,
  scale,
  items,
}: {
  readonly from: string;
  readonly to: string;
  readonly scale: CalendarScale;
  readonly items: readonly OccurrenceRowView[];
}) {
  const t = useTranslations("occurrences.calendar");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [openDay, setOpenDay] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, OccurrenceRowView[]>();
    for (const item of items) {
      const bucket = map.get(item.internalDueDate);
      if (bucket === undefined) map.set(item.internalDueDate, [item]);
      else bucket.push(item);
    }
    return map;
  }, [items]);

  const days = useMemo(() => buildGrid(from, to), [from, to]);

  function move(offsetMonths: number): void {
    const anchor = new Date(`${from}T12:00:00Z`);
    anchor.setUTCMonth(anchor.getUTCMonth() + offsetMonths);
    const next = new URLSearchParams(params.toString());
    next.set("anchor", anchor.toISOString().slice(0, 10));
    startTransition(() => {
      router.replace({ pathname, query: Object.fromEntries(next.entries()) });
    });
  }

  function setScale(value: CalendarScale): void {
    const next = new URLSearchParams(params.toString());
    next.set("scale", value);
    startTransition(() => {
      router.replace({ pathname, query: Object.fromEntries(next.entries()) });
    });
  }

  const step = scale === "year" ? 12 : scale === "quarter" ? 3 : 1;
  const dayItems = openDay === null ? [] : (byDay.get(openDay) ?? []);

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("previous")}
          onClick={() => {
            move(-step);
          }}
        >
          <ChevronLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("next")}
          onClick={() => {
            move(step);
          }}
        >
          <ChevronRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        </Button>

        <p className="text-sm font-medium text-text-primary" data-numeric>
          {formatDateFr(new Date(`${from}T12:00:00Z`))} —{" "}
          {formatDateFr(new Date(`${to}T12:00:00Z`))}
        </p>

        <div className="ms-auto flex items-center gap-1" role="group" aria-label={t("scale")}>
          {(["month", "quarter", "year"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={scale === value ? "default" : "outline"}
              aria-pressed={scale === value}
              onClick={() => {
                setScale(value);
              }}
            >
              {t(`scales.${value}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-surface-raised text-xs text-text-secondary">
          {/* La semaine commence le DIMANCHE : le week-end algérien étant
              vendredi-samedi, il se retrouve ainsi d'un seul tenant en fin de ligne. */}
          {["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => (
            <div key={day} className="px-2 py-1.5 text-center font-medium">
              {t(`weekdays.${day}`)}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const entries = byDay.get(day.iso) ?? [];
            const visible = entries.slice(0, MAX_VISIBLE_PER_DAY);
            const hidden = entries.length - visible.length;

            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => {
                  setOpenDay(day.iso);
                }}
                disabled={entries.length === 0}
                aria-label={t("dayLabel", {
                  date: formatDateFr(new Date(`${day.iso}T12:00:00Z`)),
                  count: entries.length,
                })}
                className={cn(
                  "min-h-24 border-e border-b border-border p-1.5 text-start align-top",
                  day.outside && "bg-surface-raised/50",
                  entries.length > 0 && "hover:bg-surface-raised",
                )}
              >
                <span
                  className={cn("text-xs", day.outside ? "text-text-muted" : "text-text-secondary")}
                  data-numeric
                >
                  {day.dayOfMonth}
                </span>

                <span className="mt-1 flex flex-col gap-0.5">
                  {visible.map((item) => (
                    <Tooltip key={item.id}>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-1 truncate text-2xs text-text-primary">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              STATUS_DOT[item.status] ?? "bg-status-todo",
                            )}
                          />
                          <span className="truncate">{item.obligationCode}</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {item.obligationName} · {item.periodKey}
                      </TooltipContent>
                    </Tooltip>
                  ))}

                  {hidden > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-2xs font-medium text-text-muted">
                          {t("more", { count: hidden })}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        <span className="flex flex-col gap-0.5">
                          {entries.slice(MAX_VISIBLE_PER_DAY).map((item) => (
                            <span key={item.id} className="truncate">
                              {item.obligationCode} · {item.periodKey}
                            </span>
                          ))}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Sheet
        open={openDay !== null}
        onOpenChange={(open) => {
          if (!open) setOpenDay(null);
        }}
      >
        <SheetContent side="right" className="w-96">
          <SheetHeader>
            <SheetTitle>
              {openDay === null ? "" : formatDateFr(new Date(`${openDay}T12:00:00Z`))}
            </SheetTitle>
            <SheetDescription>{t("dayPanel", { count: dayItems.length })}</SheetDescription>
          </SheetHeader>

          <ul className="space-y-2 overflow-y-auto px-4 pb-4">
            {dayItems.map((item) => (
              <li key={item.id} className="rounded-lg border border-border p-3">
                <Link
                  href={`/echeancier/${item.id}`}
                  className="text-sm font-medium text-text-primary underline-offset-2 hover:underline"
                >
                  {item.obligationName}
                </Link>
                <p className="mt-0.5 text-xs text-text-muted" data-numeric>
                  {item.obligationCode} · {item.periodKey}
                </p>
                <span className="mt-2 inline-block">
                  <StatusBadge status={item.status} />
                </span>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface GridDay {
  readonly iso: string;
  readonly dayOfMonth: number;
  /** Vrai pour les jours de complément, hors de la fenêtre demandée. */
  readonly outside: boolean;
}

/**
 * Grille de semaines complètes couvrant l'intervalle.
 *
 * Les jours de complément (avant `from`, après `to`) sont rendus atténués :
 * une grille tronquée en début de ligne se lit mal, mais un jour hors fenêtre
 * ne doit pas se confondre avec un jour vide de la période.
 */
function buildGrid(from: string, to: string): GridDay[] {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);

  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());

  const last = new Date(end);
  last.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));

  const days: GridDay[] = [];
  // Borne dure : une fenêtre annuelle produit ~371 cases, jamais davantage.
  while (cursor <= last && days.length < 400) {
    const iso = cursor.toISOString().slice(0, 10);
    days.push({
      iso,
      dayOfMonth: cursor.getUTCDate(),
      outside: iso < from || iso > to,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
