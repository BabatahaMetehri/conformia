import { useTranslations } from "next-intl";

import { StatusBadge } from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { OccurrenceStatus } from "@/config/constants";
import { cn } from "@/lib/utils";

/**
 * Journal des transitions d'une occurrence.
 *
 * Purement présentationnel : il reçoit des entrées déjà lues et déjà formatées.
 * Rendu en `<ol>` — l'ordre chronologique est une information, pas une mise en
 * page, et doit être annoncé comme telle.
 */

export interface AuditTrailEntry {
  readonly id: string;
  readonly fromStatus: OccurrenceStatus | null;
  readonly toStatus: OccurrenceStatus;
  readonly actorName: string | null;
  /** Délégant, si l'action a été faite au nom d'un autre. */
  readonly onBehalfOfName: string | null;
  readonly reason: string | null;
  /** Horodatage déjà formaté (`formatDateTimeFr`). */
  readonly formattedAt: string;
  readonly isoAt: string;
}

export function AuditTrailList({
  entries,
  className,
}: {
  readonly entries: readonly AuditTrailEntry[];
  readonly className?: string;
}) {
  const t = useTranslations("audit");

  return (
    <ol className={cn("space-y-3", className)}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <UserAvatar fullName={entry.actorName} size="sm" />

          <span className="text-sm text-text-primary">{entry.actorName ?? t("systemActor")}</span>

          {/* La délégation ne remplace pas l'auteur : elle s'ajoute à lui. */}
          {entry.onBehalfOfName === null ? null : (
            <span className="text-xs text-text-muted">
              {t("onBehalfOf", { name: entry.onBehalfOfName })}
            </span>
          )}

          <span className="flex items-center gap-2">
            {entry.fromStatus === null ? (
              <span className="text-xs text-text-muted">{t("creation")}</span>
            ) : (
              <>
                <StatusBadge status={entry.fromStatus} />
                {/* Flèche décorative : la relation est déjà dite par les deux badges. */}
                <span aria-hidden="true" className="text-text-muted">
                  →
                </span>
              </>
            )}
            <StatusBadge status={entry.toStatus} />
          </span>

          <time dateTime={entry.isoAt} className="ms-auto text-xs text-text-muted">
            {entry.formattedAt}
          </time>

          {entry.reason === null ? null : (
            <p className="w-full text-sm text-text-secondary">
              {t("reasonLabel")} {entry.reason}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
