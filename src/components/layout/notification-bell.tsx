"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationPanel } from "@/features/notifications";

/**
 * Cloche de notifications.
 *
 * ⚠️ `count` peut valoir `null`, et ce n'est pas la même chose que zéro : `null`
 * signifie « on ne sait pas » — lecture en échec, session expirée. Aucun badge
 * n'est alors affiché, plutôt qu'un « 0 » qui affirmerait qu'il n'y a rien à
 * lire. Le composant portait déjà cette distinction quand la table n'existait
 * pas ; elle vaut toujours maintenant qu'elle existe.
 *
 * Le compteur est calculé côté serveur, à chaque rendu de l'en-tête. Le panneau,
 * lui, ne charge ses messages qu'à l'ouverture : les charger d'avance ferait une
 * requête par page pour un panneau qu'on ouvre trois fois par jour.
 */
export function NotificationBell({ count = null }: { readonly count?: number | null }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const unread = count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
              className="absolute -inset-e-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-status-overdue px-1 text-2xs font-semibold text-text-inverse"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <NotificationPanel open={open} />
      </PopoverContent>
    </Popover>
  );
}
