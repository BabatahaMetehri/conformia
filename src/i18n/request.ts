import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALES, RTL_LOCALES } from "@/config/constants";
import type { Locale, TextDirection } from "@/config/constants";
import { APP_TIMEZONE } from "@/lib/dates";

export function isSupportedLocale(value: string | undefined): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function resolveLocale(value: string | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function getTextDirection(locale: Locale): TextDirection {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

/**
 * Configuration par requête. Le fuseau est imposé : les dates affichées sont des
 * échéances administratives algériennes, elles ne doivent pas dépendre de l'endroit
 * d'où l'on consulte l'application.
 */
// `requestLocale` reste l'API stable de next-intl 4. Son remplaçant,
// `next/root-params`, repose sur une fonctionnalité Next encore expérimentale :
// migrer maintenant échangerait un avertissement contre une instabilité de routage.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = resolveLocale(requested);

  const messages = (await import(`./messages/${locale}.json`)) as { default: unknown };

  return {
    locale,
    messages: messages.default as Record<string, unknown>,
    timeZone: APP_TIMEZONE,
  };
});
