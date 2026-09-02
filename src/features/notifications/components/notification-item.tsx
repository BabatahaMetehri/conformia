"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { InboxItem } from "@/features/notifications/actions/types";

/**
 * Une ligne de notification.
 *
 * ⚠️ Le corps affiché est le TEXTE BRUT, jamais le HTML. Deux raisons, et la
 * seconde suffirait : le corps HTML est rédigé pour un client de messagerie et
 * s'affiche mal dans une page ; et l'injecter reviendrait à faire confiance à
 * une colonne de la base pour du balisage exécutable.
 */
export function NotificationItem({
  item,
  onRead,
  onDismiss,
  busy,
}: {
  readonly item: InboxItem;
  readonly onRead: (id: number) => void;
  readonly onDismiss: (id: number) => void;
  readonly busy: boolean;
}) {
  const t = useTranslations();
  const unread = item.readAt === null;

  // Un genre inconnu — ajouté par une migration plus récente que ce catalogue —
  // s'affiche sous son code plutôt que de faire échouer le rendu de la liste.
  const kindKey = `notifications.kind.${item.kind}`;
  const kindLabel = t.has(kindKey) ? t(kindKey) : item.kind;

  const body = item.subject ?? item.bodyText ?? "";

  return (
    <li
      className={cn(
        "flex gap-3 border-b border-border px-4 py-3 last:border-b-0",
        unread ? "bg-surface-raised" : null,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          {/* Pastille purement décorative : l'état « non lue » est déjà porté par
              le libellé du bouton « marquer comme lu », donc lisible sans couleur. */}
          {unread ? (
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-status-progress"
            />
          ) : null}
          {kindLabel}
        </p>

        <p className={cn("mt-0.5 text-sm", unread ? "text-text-primary" : "text-text-secondary")}>
          {body}
        </p>

        {item.reason === null || item.reason.length === 0 ? null : (
          <p className="mt-1 text-xs text-text-secondary">{item.reason}</p>
        )}

        {item.occurrenceId === null ? null : (
          <Link
            href={`/echeancier/${item.occurrenceId}`}
            className="mt-1 inline-block text-xs font-medium underline underline-offset-2"
          >
            {t("emails.common.viewOccurrence")}
          </Link>
        )}
      </div>

      <div className="flex shrink-0 items-start gap-1">
        {unread ? (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t("notifications.markRead")}
            onClick={() => {
              onRead(item.id);
            }}
          >
            <Check aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={t("notifications.dismiss")}
          onClick={() => {
            onDismiss(item.id);
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </li>
  );
}
