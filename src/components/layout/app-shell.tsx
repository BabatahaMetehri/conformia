import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import type { NavCounters, NavItem } from "@/config/navigation";
import { SIDEBAR_COOKIE } from "@/config/ui";

/**
 * Coquille de la zone authentifiée : barre latérale, en-tête, contenu.
 *
 * Le repli de la barre est lu ICI, dans le cookie, et non après hydratation :
 * la largeur est donc juste dès le premier octet de HTML. Une préférence lue
 * côté client produirait une barre déployée qui se replie sous les yeux à
 * chaque chargement de page.
 */
export async function AppShell({
  children,
  items,
  counters,
  locale,
}: {
  readonly children: ReactNode;
  readonly items: readonly NavItem[];
  readonly counters: NavCounters;
  readonly locale: string;
}) {
  const t = await getTranslations("layout");
  const cookieStore = await cookies();
  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <div className="flex min-h-screen">
      {/*
        Lien d'évitement : au clavier, la première tabulation d'une page saute
        la navigation. Sans lui, atteindre le contenu impose de traverser une
        vingtaine de liens identiques à chaque changement d'écran. Visible
        uniquement quand il a le focus.
      */}
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 text-sm font-medium text-text-primary shadow focus:not-sr-only focus:absolute focus:start-2 focus:top-2"
      >
        {t("skipToContent")}
      </a>

      <Sidebar items={items} counters={counters} defaultCollapsed={collapsed} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header items={items} counters={counters} locale={locale} />
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
