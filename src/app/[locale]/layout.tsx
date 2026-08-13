import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppProviders } from "@/app/providers";
import { APP_NAME } from "@/config/constants";
import { getTextDirection, resolveLocale } from "@/i18n/request";
import { logger } from "@/lib/logger";
import { getCurrentUser } from "@/services/auth/current-user";

import "../globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
};

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  const resolvedLocale = resolveLocale(locale);

  // Unique lecture de l'identité par rendu : elle alimente `useCurrentUser()`
  // dans tout l'arbre client, sans un seul aller-retour réseau supplémentaire.
  const currentUser = await getCurrentUser();
  if (!currentUser.ok) {
    logger.error("Lecture de l'utilisateur courant impossible", {
      code: currentUser.error.code,
    });
  }

  return (
    <html lang={resolvedLocale} dir={getTextDirection(resolvedLocale)}>
      <body className="antialiased">
        <AppProviders currentUser={currentUser.ok ? currentUser.value : null}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
