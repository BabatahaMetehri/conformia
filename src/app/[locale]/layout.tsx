import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { AppProviders } from "@/app/providers";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME } from "@/config/constants";
import { getTextDirection } from "@/i18n/request";
import { routing } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/services/auth/context";
import type { CurrentUser } from "@/types/current-user";

import "../globals.css";

/**
 * Inter en fonte variable : une seule ressource couvre toutes les graisses.
 * `display: swap` — le texte s'affiche immédiatement dans la fonte de secours
 * puis bascule. Sur une application de travail, lire tout de suite prime sur
 * afficher parfaitement.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  /*
   * ⚠️ SANS CET APPEL, TOUTE L'APPLICATION REND EN FRANÇAIS, quelle que soit
   * l'URL — et c'est ce qui s'est passé.
   *
   * `getRequestConfig` lit la locale via `requestLocale`, que next-intl alimente
   * normalement depuis SON PROPRE middleware. Ce projet a le sien, qui porte la
   * session, la CSP et les redirections d'accès : celui de next-intl n'est donc
   * jamais monté, `requestLocale` restait vide, et `resolveLocale(undefined)`
   * retombait sur le français.
   *
   * Le défaut était invisible : `lang` et `dir` viennent de `params` et
   * basculaient correctement en `ar`/`rtl`, si bien que la page avait TOUT
   * L'AIR d'être en arabe — sauf le texte. Les 1416 clés du catalogue `ar`
   * n'ont jamais été lues jusqu'ici.
   *
   * `setRequestLocale` pose la locale dans le cache de requête de next-intl :
   * `getTranslations`, `getFormatter` et le fournisseur client la trouvent tous.
   *
   * ⚠️ L'API est marquée dépréciée au profit de `next/root-params`, qui repose
   * sur une fonctionnalité Next encore EXPÉRIMENTALE. Même arbitrage que pour
   * `requestLocale` dans `src/i18n/request.ts` : migrer aujourd'hui échangerait
   * un avertissement contre une instabilité de routage. La dispense porte sur
   * cette ligne seule, et tombera avec la stabilisation de `next/root-params`.
   */
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- cf. ci-dessus
  setRequestLocale(locale);

  const headerBag = await headers();
  const nonce = headerBag.get("x-nonce") ?? undefined;

  // Unique résolution d'identité par rendu : elle alimente `useCurrentUser()` dans
  // tout l'arbre client, sans un seul aller-retour réseau supplémentaire.
  const context = await getAuthContext();
  if (!context.ok) {
    logger.error("Résolution du contexte d'autorisation impossible", {
      code: context.error.code,
    });
  }

  const authenticated = context.ok ? context.value : null;
  const currentUser: CurrentUser | null =
    authenticated === null
      ? null
      : {
          id: authenticated.userId,
          email: authenticated.email,
          profile: {
            fullName: authenticated.profile.fullName,
            departmentId: authenticated.profile.departmentId,
            locale,
          },
          roles: authenticated.roles,
          permissions: [...authenticated.permissions],
        };

  return (
    // `suppressHydrationWarning` : next-themes écrit `class="dark"` sur <html>
    // avant l'hydratation. Sans cette annotation, React signalerait à juste titre
    // un écart entre le HTML serveur et le DOM client.
    <html
      lang={locale}
      dir={getTextDirection(locale)}
      className={inter.variable}
      suppressHydrationWarning
    >
      <body className="bg-background font-sans text-text-primary antialiased">
        <NextIntlClientProvider>
          <AppProviders currentUser={currentUser} nonce={nonce}>
            {children}
            <Toaster />
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
