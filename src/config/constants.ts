/**
 * Énumérations métier partagées et constantes applicatives.
 *
 * ⚠️ Contrat avec la base : chaque énumération ci-dessous doit correspondre
 * **exactement** au type ENUM Postgres homonyme créé en Phase 2. La vérification
 * est faite à la compilation dans `src/types/domain.ts` dès que les types générés
 * existent : une divergence casse le typecheck, elle ne passe pas en silence.
 *
 * Aucune règle réglementaire ici (périodicité d'une obligation donnée, échéance,
 * pièces requises) : ce sont des données en base (cf. CLAUDE.md §3.5).
 */

// ─── Cycle de vie d'une occurrence ───────────────────────────────────────────

export const OccurrenceStatus = {
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_VALIDATION: "PENDING_VALIDATION",
  VALIDATED: "VALIDATED",
  SUBMITTED: "SUBMITTED",
  ARCHIVED: "ARCHIVED",
  REJECTED: "REJECTED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;

export type OccurrenceStatus = (typeof OccurrenceStatus)[keyof typeof OccurrenceStatus];

export const OCCURRENCE_STATUSES = Object.values(OccurrenceStatus);

// ─── Périodicité d'une obligation ────────────────────────────────────────────

export const Periodicity = {
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  SEMIANNUAL: "SEMIANNUAL",
  ANNUAL: "ANNUAL",
} as const;

export type Periodicity = (typeof Periodicity)[keyof typeof Periodicity];

export const PERIODICITIES = Object.values(Periodicity);

// ─── Criticité d'une obligation ──────────────────────────────────────────────

export const Criticality = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;

export type Criticality = (typeof Criticality)[keyof typeof Criticality];

export const CRITICALITIES = Object.values(Criticality);

// ─── Canaux de notification ──────────────────────────────────────────────────

export const NotificationChannel = {
  EMAIL: "EMAIL",
  IN_APP: "IN_APP",
  SMS: "SMS",
} as const;

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NOTIFICATION_CHANNELS = Object.values(NotificationChannel);

// ─── Actions traçables sur un document ───────────────────────────────────────

export const DocumentAction = {
  UPLOADED: "UPLOADED",
  REPLACED: "REPLACED",
  DOWNLOADED: "DOWNLOADED",
  ARCHIVED: "ARCHIVED",
  DELETED: "DELETED",
  INTEGRITY_VERIFIED: "INTEGRITY_VERIFIED",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
} as const;

export type DocumentAction = (typeof DocumentAction)[keyof typeof DocumentAction];

export const DOCUMENT_ACTIONS = Object.values(DocumentAction);

// ─── Constantes applicatives ─────────────────────────────────────────────────

export const APP_NAME = "CONFORMIA";

export const LOCALES = ["fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";

/** Locales écrites de droite à gauche. */
export const RTL_LOCALES: readonly Locale[] = ["ar"];

export type TextDirection = "ltr" | "rtl";

/** Aucun bucket public : tout passe par des URL signées de courte durée. */
export const STORAGE_BUCKET_DOCUMENTS = "documents";

export const SIGNED_URL_TTL_SECONDS = 60;
