import type { Metadata } from "next";
import type { ReactNode } from "react";

import { APP_NAME } from "@/config/constants";
import { getTextDirection, resolveLocale } from "@/i18n/request";

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

  return (
    <html lang={resolvedLocale} dir={getTextDirection(resolvedLocale)}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
