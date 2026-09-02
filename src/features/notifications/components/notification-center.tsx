"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  dismissAction,
  loadPageAction,
  markAllReadAction,
  markReadAction,
} from "@/features/notifications/actions/inbox";
import type { InboxItem } from "@/features/notifications/actions/types";
import { NotificationItem } from "@/features/notifications/components/notification-item";
import { cn } from "@/lib/utils";

/**
 * Liste complète, avec filtre lu / non lu.
 *
 * Le filtre est une INTERROGATION SERVEUR et non un masquage local : « non
 * lues » doit rendre les non lues, pas les non lues parmi les cinquante
 * dernières. La nuance se voit le jour où quelqu'un revient de congés.
 */
export function NotificationCenter() {
  const t = useTranslations();
  const [includeRead, setIncludeRead] = useState(true);
  const [items, setItems] = useState<readonly InboxItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback((withRead: boolean) => {
    setItems(null);
    void loadPageAction(withRead).then((outcome) => {
      if (outcome.status === "success") {
        setItems(outcome.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
  }, []);

  useEffect(() => {
    load(includeRead);
  }, [includeRead, load]);

  const act = (run: () => Promise<unknown>) => {
    startTransition(() => {
      void run().then(() => {
        load(includeRead);
      });
    });
  };

  const hasUnread = items?.some((item) => item.readAt === null) ?? false;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        {/*
          ⚠️ DES BOUTONS À DEUX ÉTATS, PAS DES ONGLETS.

          La première version employait `Tabs`. Le rendu était juste, le sens ne
          l'était pas : un onglet DOIT contrôler un panneau, et Radix lui pose
          donc un `aria-controls` vers un `TabsContent`. Comme les deux filtres
          partagent la même liste, ce panneau n'existait pas — axe le signale en
          `aria-valid-attr-value`, et un lecteur d'écran annonce un onglet dont
          il ne trouve pas le contenu.

          Ici la liste n'est pas un panneau : c'est la même région, réinterrogée.
          Un groupe de bascules le dit exactement, et `aria-pressed` porte l'état
          sans dépendre de la couleur.
        */}
        <div
          role="group"
          aria-label={t("notifications.filters.label")}
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {(
            [
              ["all", true, t("notifications.filters.all")],
              ["unread", false, t("notifications.filters.unread")],
            ] as const
          ).map(([key, withRead, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={includeRead === withRead}
              onClick={() => {
                setIncludeRead(withRead);
              }}
              className={cn(
                "rounded-sm px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                includeRead === withRead
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {hasUnread ? (
          <Button
            variant="outline"
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
        <div className="p-4">
          <ErrorState
            title={t("notifications.errors.loadFailed")}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  load(includeRead);
                }}
              >
                {t("common.actions.retry")}
              </Button>
            }
          />
        </div>
      ) : items === null ? (
        <div className="p-4">
          <LoadingState label={t("common.states.loading")} />
        </div>
      ) : items.length === 0 ? (
        <div className="p-4">
          <EmptyState title={t("notifications.empty")} className="border-0 py-8" />
        </div>
      ) : (
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
      )}
    </section>
  );
}
