import { defineRouting } from "next-intl/routing";

import { DEFAULT_LOCALE, LOCALES } from "@/config/constants";

/**
 * Routage localisé. Le préfixe est TOUJOURS présent, y compris pour le français :
 * une URL sans locale devrait être devinée, et deux URL pour une même page
 * compliquent les liens envoyés par courriel autant que les journaux d'accès.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});
