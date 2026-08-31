import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
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
