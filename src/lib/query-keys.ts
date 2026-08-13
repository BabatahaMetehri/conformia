/**
 * Fabrique des clés de cache TanStack Query.
 *
 * Aucune clé littérale ailleurs dans le code : une clé écrite à la main dans un
 * hook et une autre dans une invalidation divergent au premier renommage, et le
 * cache cesse silencieusement de se rafraîchir. Tout passe par ce module.
 *
 * Convention : de la racine au détail, `[domaine, portée, ...paramètres]`.
 * `invalidateQueries({ queryKey: queryKeys.occurrences.all() })` invalide donc
 * toute la branche, listes et détails compris.
 */

import type { Criticality, DomainCode, OccurrenceStatus } from "@/config/constants";

const ROOT = {
  obligations: "obligations",
  occurrences: "occurrences",
  documents: "documents",
  audit: "audit",
  notifications: "notifications",
  dashboard: "dashboard",
  users: "users",
} as const;

export interface ObligationListFilters {
  readonly domain?: DomainCode;
  readonly criticality?: Criticality;
  readonly search?: string;
  readonly page?: number;
}

export interface OccurrenceListFilters {
  readonly status?: OccurrenceStatus;
  readonly domain?: DomainCode;
  /** Clé de période, éventuellement rectificative (`2026-01`, `2026-01-R1`). */
  readonly period?: string;
  readonly assigneeId?: string;
  readonly overdueOnly?: boolean;
  readonly page?: number;
}

export interface AuditListFilters {
  readonly entity?: string;
  readonly entityId?: string;
  readonly actorId?: string;
  readonly page?: number;
}

export const queryKeys = {
  obligations: {
    all: () => [ROOT.obligations] as const,
    list: (filters: ObligationListFilters = {}) => [ROOT.obligations, "list", filters] as const,
    detail: (obligationId: string) => [ROOT.obligations, "detail", obligationId] as const,
  },

  occurrences: {
    all: () => [ROOT.occurrences] as const,
    list: (filters: OccurrenceListFilters = {}) => [ROOT.occurrences, "list", filters] as const,
    detail: (occurrenceId: string) => [ROOT.occurrences, "detail", occurrenceId] as const,
    history: (occurrenceId: string) =>
      [ROOT.occurrences, "detail", occurrenceId, "history"] as const,
  },

  documents: {
    all: () => [ROOT.documents] as const,
    byOccurrence: (occurrenceId: string) =>
      [ROOT.documents, "by-occurrence", occurrenceId] as const,
    detail: (documentId: string) => [ROOT.documents, "detail", documentId] as const,
  },

  audit: {
    all: () => [ROOT.audit] as const,
    list: (filters: AuditListFilters = {}) => [ROOT.audit, "list", filters] as const,
  },

  notifications: {
    all: () => [ROOT.notifications] as const,
    unreadCount: () => [ROOT.notifications, "unread-count"] as const,
  },

  dashboard: {
    all: () => [ROOT.dashboard] as const,
    summary: (departmentId: string | null) => [ROOT.dashboard, "summary", departmentId] as const,
  },

  users: {
    all: () => [ROOT.users] as const,
    list: () => [ROOT.users, "list"] as const,
    detail: (userId: string) => [ROOT.users, "detail", userId] as const,
  },
} as const;

/** Type de toute clé produite par la fabrique. */
export type AppQueryKey = ReturnType<
  | (typeof queryKeys.obligations)[keyof typeof queryKeys.obligations]
  | (typeof queryKeys.occurrences)[keyof typeof queryKeys.occurrences]
  | (typeof queryKeys.documents)[keyof typeof queryKeys.documents]
  | (typeof queryKeys.audit)[keyof typeof queryKeys.audit]
  | (typeof queryKeys.notifications)[keyof typeof queryKeys.notifications]
  | (typeof queryKeys.dashboard)[keyof typeof queryKeys.dashboard]
  | (typeof queryKeys.users)[keyof typeof queryKeys.users]
>;
