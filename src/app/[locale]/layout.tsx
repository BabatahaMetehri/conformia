import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppProviders } from "@/app/providers";
import { APP_NAME } from "@/config/constants";
import { getTextDirection } from "@/i18n/request";
import { routing } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/services/auth/context";
import type { CurrentUser } from "@/types/current-user";

import "../globals.css";

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
    <html lang={locale} dir={getTextDirection(locale)}>
      <body className="antialiased">
        <NextIntlClientProvider>
          <AppProviders currentUser={currentUser}>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
