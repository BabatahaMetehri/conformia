"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  dismissAction,
  loadPanelAction,
  markAllReadAction,
  markReadAction,
} from "@/features/notifications/actions/inbox";
import type { InboxItem } from "@/features/notifications/actions/types";
import { NotificationItem } from "@/features/notifications/components/notification-item";
import { Link } from "@/i18n/navigation";
import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * Contenu du panneau déroulant.
 *
 * ⚠️ Les messages sont chargés À L'OUVERTURE, pas au rendu de l'en-tête. Les
 * charger d'avance ferait une requête sur chaque page de l'application pour un
 * panneau que l'on ouvre quelques fois par jour — et le compteur, lui, suffit à
 * dire s'il y a quelque chose à regarder.
 */
export function NotificationPanel({ open }: { readonly open: boolean }) {
  const t = useTranslations();
  const [items, setItems] = useState<readonly InboxItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, run] = useActionRunner();

  const load = useCallback(() => {
    void loadPanelAction().then((outcome) => {
      if (outcome.status === "success") {
        setItems(outcome.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
  }, []);

  useEffect(() => {
    if (open && items === null && !failed) load();
  }, [open, items, failed, load]);

  /*
   * ⚠️ LE TRAVAIL ASYNCHRONE EST REMIS AU LANCEUR, il n'est plus jeté dans une
   * transition synchrone sous la forme `void mutate().then(...)`. Cette forme-là
   * refermait la transition AVANT le premier résultat : le drapeau d'attente
   * retombait aussitôt, les boutons redevenaient cliquables, et la relecture qui
   * suivait s'exécutait hors de tout suivi.
   */
  const act = (mutate: () => Promise<unknown>) => {
    run(async () => {
      await mutate();
      load();
    });
  };

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="text-sm font-medium text-text-primary">{t("notifications.panelTitle")}</p>
        {items !== null && items.some((item) => item.readAt === null) ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              act(markAllReadAction);
            }}
          >
            {t("notifications.markAllRead")}
          </Button>
        ) : null}
      </div>

      {failed ? (
        <div className="p-3">
          <ErrorState
            title={t("notifications.errors.loadFailed")}
            action={
              <Button variant="outline" size="sm" onClick={load}>
                {t("common.actions.retry")}
              </Button>
            }
          />
        </div>
      ) : items === null ? (
        <div className="p-3">
          <LoadingState label={t("common.states.loading")} />
        </div>
      ) : items.length === 0 ? (
        <div className="p-3">
          <EmptyState title={t("notifications.empty")} className="border-0 py-6" />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul>
            {items.map((item) => (
              <NotificationItem
                key={item.id}
                item={item}
                busy={pending}
                onRead={(id) => {
                  act(() => markReadAction(id));
                }}
                onDismiss={(id) => {
                  act(() => dismissAction(id));
                }}
              />
            ))}
          </ul>
        </ScrollArea>
      )}

      <div className="border-t border-border px-4 py-2">
        <Link
          href="/notifications"
          className="text-sm font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t("notifications.viewAll")}
        </Link>
      </div>
    </div>
  );
}
