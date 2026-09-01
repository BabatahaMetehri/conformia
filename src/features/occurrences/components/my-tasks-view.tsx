"use client";

import { AlertTriangle, CalendarClock, CalendarRange, Clock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/states";
import { CriticalityIndicator, StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { DocumentsCell, DueDatesCell } from "@/features/occurrences/components/due-dates-cell";
import type { OccurrenceRowView } from "@/features/occurrences/components/types";
import { Link } from "@/i18n/navigation";

/**
 * « Mes tâches », groupées par urgence.
 *
 * Le tri est fait PAR LE SERVICE — urgence d'abord, criticité ensuite. Ce
 * composant ne réordonne rien : deux tris concurrents, l'un ici et l'autre en
 * amont, divergeraient au premier ajustement de règle.
 */

export type TaskBucket = "overdue" | "awaitingMe" | "thisWeek" | "thisMonth" | "later";

const BUCKET_ICON: Readonly<Record<TaskBucket, LucideIcon>> = {
  overdue: AlertTriangle,
  awaitingMe: ShieldCheck,
  thisWeek: Clock,
  thisMonth: CalendarClock,
  later: CalendarRange,
};

const BUCKET_TONE: Readonly<Record<TaskBucket, string>> = {
  overdue: "text-status-overdue",
  awaitingMe: "text-status-pending",
  thisWeek: "text-status-progress",
  thisMonth: "text-text-secondary",
  later: "text-text-muted",
};

export function MyTasksView({
  groups,
}: {
  readonly groups: readonly {
    readonly bucket: TaskBucket;
    readonly items: readonly OccurrenceRowView[];
  }[];
}) {
  const t = useTranslations("occurrences.myTasks");
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (total === 0) {
    return <EmptyState title={t("empty")} description={t("emptyHint")} />;
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => {
        if (group.items.length === 0) return null;
        const Icon = BUCKET_ICON[group.bucket];

        return (
          <section key={group.bucket} aria-labelledby={`bucket-${group.bucket}`}>
            <h2
              id={`bucket-${group.bucket}`}
              className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary"
            >
              <Icon aria-hidden="true" className={`size-4 ${BUCKET_TONE[group.bucket]}`} />
              {t(`buckets.${group.bucket}`)}
              <Badge variant="secondary">{group.items.length}</Badge>
            </h2>

            <ul className="space-y-2">
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/echeancier/${item.id}`}
                      className="text-sm font-medium text-text-primary underline-offset-2 hover:underline"
                    >
                      {item.obligationName}
                    </Link>
                    <p className="mt-0.5 text-2xs text-text-muted" data-numeric>
                      {item.obligationCode} · {item.periodKey}
                    </p>
                  </div>

                  <DueDatesCell
                    internalDueDate={item.internalDueDate}
                    legalDueDate={item.legalDueDate}
                    daysToInternal={item.daysToInternal}
                    isOverdue={item.isOverdue}
                    isInternallyLate={item.isInternallyLate}
                  />

                  <DocumentsCell
                    provided={item.documentsProvided}
                    required={item.documentsRequired}
                  />

                  <CriticalityIndicator criticality={item.criticality} />
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
