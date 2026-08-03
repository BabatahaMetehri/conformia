/** Constantes applicatives. Aucune règle réglementaire ici : elles vivent en base. */

export const APP_NAME = "CONFORMIA";

/**
 * Fuseau de référence de l'entreprise. Toute date métier est calculée et affichée
 * dans ce fuseau ; le stockage reste en UTC (cf. CLAUDE.md §2).
 * L'Algérie est à UTC+1 toute l'année (pas d'heure d'été).
 */
export const APP_TIME_ZONE = "Africa/Algiers";

export const LOCALES = ["fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";

/** Locales écrites de droite à gauche. */
export const RTL_LOCALES: readonly Locale[] = ["ar"];

export type TextDirection = "ltr" | "rtl";

/** Préfixe de tous les buckets Storage. Aucun bucket public. */
export const STORAGE_BUCKET_DOCUMENTS = "documents";

/** Durée de validité d'une URL signée de téléchargement, en secondes. */
export const SIGNED_URL_TTL_SECONDS = 60;
