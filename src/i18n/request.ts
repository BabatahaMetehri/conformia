import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALES, RTL_LOCALES } from "@/config/constants";
import type { Locale, TextDirection } from "@/config/constants";
import { APP_TIMEZONE } from "@/lib/dates";
import { APP_LOCALE_HEADER } from "@/lib/locale-detection";

/**
 * Locale portée par l'en-tête du middleware.
 *
 * `headers()` lève hors contexte de requête — rendu statique, script, gabarit
 * de courriel. L'absence n'est donc pas une erreur : on rend `undefined` et
 * l'appelant se replie.
 */
async function readLocaleHeader(): Promise<string | undefined> {
  try {
    return (await headers()).get(APP_LOCALE_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}

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
  /*
   * ⚠️ L'EN-TÊTE D'ABORD, `requestLocale` ENSUITE.
   *
   * `requestLocale` est alimenté par le middleware de next-intl, que ce projet
   * ne monte pas : le sien porte déjà la session, la CSP, la corrélation et la
   * limitation de débit. Laissé seul, `requestLocale` reste vide et
   * `resolveLocale(undefined)` retombe sur le français — mesuré :
   * `/ar/echeancier` rendait « Échéancier », et le catalogue arabe n'était
   * jamais lu.
   *
   * L'en-tête posé par notre middleware ne dépend d'aucun ordre d'exécution
   * entre la disposition et la page, contrairement à `setRequestLocale`. Le
   * repli sur `requestLocale` reste utile hors requête HTTP — génération
   * statique, rendu d'un courriel.
   */
  const headerLocale = await readLocaleHeader();
  const requested = headerLocale ?? (await requestLocale);
  const locale = resolveLocale(requested);

  const messages = (await import(`./messages/${locale}.json`)) as { default: unknown };

  return {
    locale,
    messages: messages.default as Record<string, unknown>,
    timeZone: APP_TIMEZONE,
  };
});
