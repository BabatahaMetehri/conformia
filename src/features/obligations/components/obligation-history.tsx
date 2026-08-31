"use client";

import { FilePlus2, PencilLine, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { formatDateTimeFr } from "@/lib/dates";

/**
 * Historique d'audit d'une obligation.
 *
 * Distinct de `AuditTrailList`, qui présente les TRANSITIONS D'ÉTAT d'une
 * occurrence — un objet dont la vie est un cycle nommé. Ici, il s'agit
 * d'écritures de référentiel : création, modification, liste de champs touchés.
 * Les deux se ressemblent à l'écran et portent des métiers différents ; les
 * fondre derrière un composant commun ferait payer chaque évolution de l'un à
 * l'autre (cf. CLAUDE.md §3.4).
 */

export interface ObligationHistoryEntry {
  readonly id: string;
  readonly action: string;
  readonly actorEmail: string | null;
  readonly changedFields: readonly string[];
  readonly occurredAt: string;
}

export function ObligationHistory({
  entries,
  canReadAudit,
}: {
  readonly entries: readonly ObligationHistoryEntry[];
  /**
   * Sans `audit.read`, la RLS rend zéro ligne. On le DIT : un historique vide
   * laisserait croire qu'il ne s'est rien passé sur cette obligation.
   */
  readonly canReadAudit: boolean;
}) {
  const t = useTranslations("obligations.history");
  const tAudit = useTranslations("audit");

  if (!canReadAudit) {
    return <EmptyState title={t("notPermitted")} description={t("notPermittedHint")} />;
  }
  if (entries.length === 0) {
    return <EmptyState title={t("empty")} description={t("emptyHint")} />;
  }

  return (
    <ol className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <ActionIcon action={entry.action} />

          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">
              {/* L'adresse est dénormalisée dans le journal : elle reste lisible
                  même si le compte a disparu depuis. */}
              {entry.actorEmail ?? tAudit("systemActor")}
              <span className="text-text-secondary"> · {t(`action.${entry.action}`)}</span>
            </p>

            {entry.changedFields.length === 0 ? null : (
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {entry.changedFields.map((field) => (
                  <li key={field}>
                    <Badge variant="outline" className="text-2xs">
                      {field}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <time dateTime={entry.occurredAt} data-numeric className="text-xs text-text-muted">
            {formatDateTimeFr(new Date(entry.occurredAt))}
          </time>
        </li>
      ))}
    </ol>
  );
}

function ActionIcon({ action }: { readonly action: string }) {
  const className = "mt-0.5 size-4 shrink-0 text-text-muted";

  if (action === "INSERT") return <FilePlus2 aria-hidden="true" className={className} />;
  if (action === "DELETE") return <ShieldOff aria-hidden="true" className={className} />;
  return <PencilLine aria-hidden="true" className={className} />;
}
