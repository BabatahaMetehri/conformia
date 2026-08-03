/**
 * Résolution de la locale et chargement des messages.
 *
 * `next-intl` n'est pas encore installé : ce module expose déjà le contrat
 * (locale, direction, messages) pour que rien d'autre n'ait à changer quand
 * `getRequestConfig` viendra l'envelopper.
 */

import { DEFAULT_LOCALE, LOCALES, RTL_LOCALES } from "@/config/constants";
import type { Locale, TextDirection } from "@/config/constants";
import fr from "@/i18n/messages/fr.json";

/** Le catalogue français fait foi : toute autre locale doit exposer les mêmes clés. */
export type Messages = typeof fr;

export function isSupportedLocale(value: string | undefined): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function resolveLocale(value: string | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function getTextDirection(locale: Locale): TextDirection {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

export function getMessages(locale: Locale): Messages {
  switch (locale) {
    case "fr":
      return fr;
    case "ar":
      // Catalogue arabe non encore rédigé : repli sur le français pour ne jamais
      // afficher de clé brute à l'utilisateur.
      return fr;
  }
}
