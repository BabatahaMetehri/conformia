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

/** L'ordre de déclaration est celui du type ENUM Postgres : il fixe le tri SQL. */
export const OccurrenceStatus = {
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_VALIDATION: "PENDING_VALIDATION",
  REJECTED: "REJECTED",
  VALIDATED: "VALIDATED",
  SUBMITTED: "SUBMITTED",
  ARCHIVED: "ARCHIVED",
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
  BIENNIAL: "BIENNIAL",
  /** Déclenchée par un fait, pas par le calendrier : aucune génération automatique. */
  ON_EVENT: "ON_EVENT",
  /** Dates fixes portées par la règle de l'obligation. */
  CUSTOM: "CUSTOM",
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

// ─── Point d'ancrage du calcul d'échéance ────────────────────────────────────

export const DueAnchor = {
  /** Échéance calculée depuis la fin de la période (cas le plus courant). */
  PERIOD_END: "PERIOD_END",
  PERIOD_START: "PERIOD_START",
  /** Date civile fixe portée par la règle, indépendante de la période. */
  FIXED_DATE: "FIXED_DATE",
  /** Date d'expiration d'un titre, d'un agrément, d'une autorisation. */
  EXPIRY_DATE: "EXPIRY_DATE",
  /** Date du fait déclencheur, pour les obligations ON_EVENT. */
  EVENT_DATE: "EVENT_DATE",
} as const;

export type DueAnchor = (typeof DueAnchor)[keyof typeof DueAnchor];

export const DUE_ANCHORS = Object.values(DueAnchor);

// ─── Report d'une échéance tombant un jour chômé ─────────────────────────────

export const DateShift = {
  NEXT_BUSINESS_DAY: "NEXT_BUSINESS_DAY",
  PREVIOUS_BUSINESS_DAY: "PREVIOUS_BUSINESS_DAY",
  /** Aucun report : l'échéance reste au jour calculé, fût-il chômé. */
  NONE: "NONE",
} as const;

export type DateShift = (typeof DateShift)[keyof typeof DateShift];

export const DATE_SHIFTS = Object.values(DateShift);

// ─── Domaine réglementaire d'une obligation ──────────────────────────────────

export const DomainCode = {
  FISCAL: "FISCAL",
  SOCIAL: "SOCIAL",
  REGLEMENTAIRE: "REGLEMENTAIRE",
  JURIDIQUE: "JURIDIQUE",
} as const;

export type DomainCode = (typeof DomainCode)[keyof typeof DomainCode];

export const DOMAIN_CODES = Object.values(DomainCode);

// ─── Nature d'une pièce jointe ───────────────────────────────────────────────

export const DocumentKind = {
  JUSTIFICATIF: "JUSTIFICATIF",
  /** Accusé de réception ou récépissé délivré par l'administration. */
  PREUVE_DEPOT: "PREUVE_DEPOT",
  ANNEXE: "ANNEXE",
  CORRESPONDANCE: "CORRESPONDANCE",
} as const;

export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

export const DOCUMENT_KINDS = Object.values(DocumentKind);

// ─── Canaux de notification ──────────────────────────────────────────────────

export const NotificationChannel = {
  EMAIL: "EMAIL",
  IN_APP: "IN_APP",
  SMS: "SMS",
} as const;

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NOTIFICATION_CHANNELS = Object.values(NotificationChannel);

// ─── Destinataires d'une notification / palier d'escalade ────────────────────

export const NotificationAudience = {
  /** Responsable désigné de l'occurrence. */
  OWNER: "OWNER",
  VALIDATOR: "VALIDATOR",
  DEPARTMENT_HEAD: "DEPARTMENT_HEAD",
  DIRECTION: "DIRECTION",
} as const;

export type NotificationAudience = (typeof NotificationAudience)[keyof typeof NotificationAudience];

export const NOTIFICATION_AUDIENCES = Object.values(NotificationAudience);

/**
 * Paliers d'escalade d'un retard. Le validateur n'en fait pas partie : il est
 * sollicité par le workflow, pas par le dépassement d'échéance.
 */
export type EscalationLevel = Exclude<NotificationAudience, "VALIDATOR">;

// ─── Accès à un document ─────────────────────────────────────────────────────

/**
 * Traçabilité des ACCÈS à un document — qui a obtenu une URL, qui a consulté,
 * qui a téléchargé. Les événements de cycle de vie (dépôt, remplacement,
 * suppression) relèvent du journal d'audit général, pas de cette énumération.
 */
export const DocumentAction = {
  SIGNED_URL_ISSUED: "SIGNED_URL_ISSUED",
  VIEW: "VIEW",
  DOWNLOAD: "DOWNLOAD",
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

// ─── Délais et seuils (décisions arrêtées) ───────────────────────────────────

/**
 * Marge interne, en jours ouvrés, entre l'échéance affichée à l'équipe et
 * l'échéance légale. Plus l'obligation est critique, plus on se donne d'avance.
 */
export const INTERNAL_LEAD_DAYS_BY_CRITICALITY: Readonly<Record<Criticality, number>> = {
  CRITICAL: 7,
  HIGH: 5,
  MEDIUM: 3,
  LOW: 0,
};

/**
 * Jalons de notification, en jours par rapport à l'échéance.
 * Négatif = rappel avant échéance, positif = relance après échéance.
 */
export const NOTIFICATION_OFFSETS_DAYS: readonly number[] = [-30, -15, -7, -1, 1, 3, 7];

/** Jours de retard déclenchant chaque palier d'escalade, cas courant. */
export const ESCALATION_STANDARD_DAYS: Readonly<Record<EscalationLevel, number>> = {
  OWNER: 1,
  DEPARTMENT_HEAD: 3,
  DIRECTION: 7,
};

/** Idem pour une obligation CRITICAL : la direction est alertée sans délai. */
export const ESCALATION_CRITICAL_DAYS: Readonly<Record<EscalationLevel, number>> = {
  OWNER: 0,
  DEPARTMENT_HEAD: 0,
  DIRECTION: 2,
};

/** Profondeur de génération d'occurrences à l'avance, en mois. */
export const GENERATION_HORIZON_MONTHS = 18;

/** Durée de vie d'une URL signée de téléchargement, en secondes. */
export const SIGNED_URL_TTL_SECONDS = 300;

export const SESSION_TIMEOUT_MINUTES = 30;

export const MAX_UPLOAD_MB = 25;
/** Volume cumulé des pièces d'une même occurrence. */
export const MAX_OCCURRENCE_TOTAL_MB = 200;

/** Durée de conservation par défaut des pièces, en années. */
export const DEFAULT_RETENTION_YEARS = 10;

/** Durée maximale d'une délégation de responsabilité, en jours. */
export const MAX_DELEGATION_DAYS = 90;

/** Délai au-delà duquel une validation sans réponse bascule au palier suivant. */
export const VALIDATION_FALLBACK_DAYS = 5;

// ─── Types de fichiers acceptés ──────────────────────────────────────────────

/**
 * Liste blanche des types MIME acceptés au dépôt.
 *
 * Une liste blanche, jamais une liste noire : tout ce qui n'est pas explicitement
 * prévu est refusé. Le type MIME déclaré par le navigateur n'est PAS une preuve —
 * il devra être recoupé avec la signature réelle du fichier et l'extension.
 */
export const ALLOWED_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel", // xls
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/msword", // doc
  "text/csv",
  "text/plain",
  "application/xml",
  "text/xml",
  "application/zip",
  "application/x-zip-compressed",
];

/**
 * Extensions refusées quel que soit le type MIME annoncé — seconde barrière,
 * appliquée en plus de la liste blanche ci-dessus.
 *
 * ⚠️ `svg` est bloqué délibérément. Un SVG est un document XML qui peut contenir
 * des balises `<script>` et des gestionnaires `onload=` : servi depuis notre
 * domaine, il s'exécute avec nos cookies de session. C'est un vecteur XSS stocké
 * bien réel, régulièrement négligé parce que « ce n'est qu'une image ». Même
 * raisonnement pour `html`/`htm`. Ces trois types n'ont aucun usage légitime
 * comme justificatif administratif.
 */
export const BLOCKED_EXTENSIONS: readonly string[] = [
  "exe",
  "bat",
  "cmd",
  "sh",
  "js",
  "jar",
  "msi",
  "com",
  "scr",
  "vbs",
  "ps1",
  "html",
  "htm",
  "svg",
];
