"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { NavList } from "@/components/layout/nav-list";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/config/constants";
import type { NavCounters, NavItem } from "@/config/navigation";
import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE } from "@/config/ui";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Barre latérale repliable.
 *
 * L'état replié est écrit dans un COOKIE, pas dans un store client. La raison
 * est le rendu serveur : le layout doit connaître la largeur AVANT d'émettre le
 * HTML, sans quoi la barre s'affiche déployée puis se replie sous les yeux à
 * l'hydratation. Un `localStorage` ne serait lisible qu'après. C'est aussi
 * pourquoi ce n'est pas un cas d'usage de Zustand : l'état survit au
 * rechargement, il n'est pas éphémère.
 */

function persistCollapsed(collapsed: boolean): void {
  // `SameSite=Lax` : préférence d'affichage, aucune valeur d'authentification.
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=${String(SIDEBAR_COOKIE_MAX_AGE)}; SameSite=Lax`;
}

export function Sidebar({
  items,
  counters,
  defaultCollapsed,
}: {
  readonly items: readonly NavItem[];
  readonly counters: NavCounters;
  readonly defaultCollapsed: boolean;
}) {
  const t = useTranslations();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <aside
      aria-label={t("nav.primary")}
      data-collapsed={collapsed ? "" : undefined}
      className={cn(
        // `hidden lg:flex` : sous le point de rupture, la navigation passe par
        // le tiroir. Deux navigations simultanées se disputeraient le focus.
        "hidden shrink-0 flex-col border-e border-border bg-surface transition-[width] lg:flex",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-border px-3",
          collapsed && "justify-center px-2",
        )}
      >
        {collapsed ? null : (
          <Link
            href="/my-tasks"
            className="truncate text-sm font-semibold tracking-tight text-text-primary"
          >
            {APP_NAME}
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={collapsed ? "" : "ms-auto"}
          aria-label={collapsed ? t("layout.openSidebar") : t("layout.closeSidebar")}
          onClick={() => {
            setCollapsed((previous) => {
              persistCollapsed(!previous);
              return !previous;
            });
          }}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          )}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <NavList items={items} counters={counters} collapsed={collapsed} />
      </nav>
    </aside>
  );
}
