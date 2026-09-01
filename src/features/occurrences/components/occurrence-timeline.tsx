import { ArrowRight, FileUp, PenLine, UserRoundCog } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTimeFr } from "@/lib/dates";
import type { OccurrenceDetailView, TimelineEntry } from "@/services/occurrences/detail";

/**
 * Onglet « Historique » : transitions, dépôts et actions d'audit, fusionnés.
 *
 * ⚠️ Les actions DÉLÉGUÉES affichent les DEUX identités : celle qui a agi et
 * celle au nom de qui elle a agi. Une délégation n'efface pas l'auteur — c'est
 * la règle que porte déjà `occurrence_transitions.on_behalf_of_id`, et la
 * respecter à l'affichage est ce qui la rend utile.
 *
 * Les entrées d'audit portant un changement de statut sont écartées en amont :
 * elles décrivent le même fait qu'une ligne de transition, en moins lisible.
 */
export function OccurrenceTimeline({ detail }: { readonly detail: OccurrenceDetailView }) {
  const t = useTranslations("occurrences.detail");

  if (detail.timeline.length === 0) {
    return <EmptyState title={t("noHistory")} />;
  }

  return (
    <ol className="space-y-1">
      {detail.timeline.map((entry) => (
        <li key={entry.id} className="flex gap-3 border-s border-border ps-4 pb-3 last:pb-0">
          <span className="mt-0.5 shrink-0 text-text-muted">
            <EntryIcon entry={entry} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
              <TimelineLabel entry={entry} />
            </p>

            <p className="mt-0.5 text-xs text-text-muted">
              {entry.onBehalfOfName === null
                ? (entry.actorName ?? t("systemActor"))
                : t("onBehalfOf", {
                    actor: entry.actorName ?? t("systemActor"),
                    delegator: entry.onBehalfOfName,
                  })}
              {" · "}
              {formatDateTimeFr(new Date(entry.occurredAt))}
            </p>

            {entry.reason === null ? null : (
              <p className="mt-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary">
                {entry.reason}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function EntryIcon({ entry }: { readonly entry: TimelineEntry }) {
  if (entry.kind === "DOCUMENT") return <FileUp aria-hidden="true" className="size-4" />;
  if (entry.kind === "AUDIT") return <UserRoundCog aria-hidden="true" className="size-4" />;
  return <PenLine aria-hidden="true" className="size-4" />;
}

function TimelineLabel({ entry }: { readonly entry: TimelineEntry }) {
  const t = useTranslations("occurrences.detail");

  if (entry.kind === "TRANSITION") {
    return (
      <>
        {entry.fromStatus === null ? (
          <span>{t("created")}</span>
        ) : (
          <>
            <StatusBadge status={entry.fromStatus} />
            <ArrowRight aria-hidden="true" className="size-3.5 text-text-muted" />
          </>
        )}
        {entry.toStatus === null ? null : <StatusBadge status={entry.toStatus} />}
      </>
    );
  }

  if (entry.kind === "DOCUMENT") {
    return <span>{t("depositedPiece", { name: entry.detail ?? "" })}</span>;
  }

  return (
    <span>
      {t("auditChange", {
        fields:
          entry.changedFields.length === 0 ? t("auditNoFields") : entry.changedFields.join(", "),
      })}
    </span>
  );
}
