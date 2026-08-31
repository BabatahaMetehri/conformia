"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Cloche de notifications.
 *
 * ⚠️ COQUILLE ASSUMÉE. Le modèle de notifications (table, règles de jalon,
 * canaux, escalade) n'existe pas encore en base : il appartient à une phase
 * ultérieure. Le compteur est donc absent, et non fixé à zéro par commodité —
 * afficher « 0 » affirmerait qu'il n'y a rien à lire, ce que rien ne permet de
 * savoir aujourd'hui. Le panneau montre l'état vide, qui est la vérité.
 *
 * `count` est déjà au contrat : le jour où la donnée existe, seul l'appelant
 * change.
 */
export function NotificationBell({ count = null }: { readonly count?: number | null }) {
  const t = useTranslations();
  const unread = count ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t("layout.notificationsLabel", { count: unread })}
        >
          <Bell aria-hidden="true" className="size-4" />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              data-numeric
              className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-status-overdue px-1 text-2xs font-semibold text-text-inverse"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-text-primary">{t("notifications.title")}</p>
        </div>
        <div className="p-3">
          <EmptyState title={t("notifications.empty")} className="border-0 py-6" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
