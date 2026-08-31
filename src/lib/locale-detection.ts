/**
 * Détection de locale : cookie, puis `Accept-Language`, puis repli.
 *
 * Module pur — il ne connaît ni Next, ni les cookies du navigateur : on lui
 * passe deux chaînes, il rend une locale. C'est ce qui le rend testable sans
 * simuler une requête.
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/config/constants";

/** Nom du cookie posé par next-intl lorsqu'on change de langue. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

function isSupported(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

interface WeightedTag {
  readonly tag: string;
  readonly quality: number;
}

/**
 * Analyse `Accept-Language` : `fr-DZ,fr;q=0.9,ar;q=0.8,en;q=0.5`.
 *
 * La qualité par défaut est 1. Une valeur illisible vaut 0 plutôt que d'écarter
 * l'en-tête entier : un client mal élevé ne doit pas priver un client correct de
 * sa préférence.
 */
function parseAcceptLanguage(header: string): WeightedTag[] {
  return header
    .split(",")
    .map((part) => {
      const [rawTag, ...parameters] = part.trim().split(";");
      const tag = (rawTag ?? "").trim().toLowerCase();

      // Trois cas distincts, et le troisième est celui qui compte :
      //   « fr »          → aucun paramètre q, la qualité vaut 1 ;
      //   « fr;q=0.8 »    → qualité lue ;
      //   « fr;q=abc »    → paramètre PRÉSENT mais illisible → 0.
      // Confondre le premier et le troisième laisserait une entrée malformée
      // supplanter une entrée correcte.
      const rawQuality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));

      if (rawQuality === undefined) return { tag, quality: 1 };

      const parsed = Number.parseFloat(rawQuality.slice(2));
      return { tag, quality: Number.isNaN(parsed) ? 0 : parsed };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality);
}

/**
 * Locale à servir pour cette requête.
 *
 * Ordre imposé : le choix EXPLICITE de l'utilisateur (cookie) l'emporte sur la
 * configuration de son navigateur. Quelqu'un qui a demandé le français depuis un
 * poste configuré en arabe ne doit pas se le voir redemander à chaque visite.
 */
export function detectLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (cookieValue !== undefined && isSupported(cookieValue)) {
    return cookieValue;
  }

  if (acceptLanguage !== null && acceptLanguage.length > 0) {
    for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
      // `fr-DZ` doit satisfaire `fr` : on compare aussi la sous-balise primaire.
      const primary = tag.split("-")[0] ?? tag;
      if (isSupported(tag)) return tag;
      if (isSupported(primary)) return primary;
    }
  }

  return DEFAULT_LOCALE;
}
