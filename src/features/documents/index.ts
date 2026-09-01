/**
 * Surface publique de la feature documents.
 *
 * Un import d'un chemin interne depuis une AUTRE feature est interdit (barrière
 * inter-features) ; l'app, elle, passe par ici.
 */

export { DocumentFilters } from "@/features/documents/components/document-filters";
export { DocumentsTable, IntegrityBadge } from "@/features/documents/components/documents-table";
export { IntegrityAlerts } from "@/features/documents/components/integrity-alerts";
export { PurgeQueueTable } from "@/features/documents/components/purge-queue-table";
export type {
  ActionOutcome,
  ConfirmActionOutcome,
  PlainDocumentOutcome,
  TicketActionOutcome,
} from "@/features/documents/actions/types";
