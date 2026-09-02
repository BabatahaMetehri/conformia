/**
 * Surface publique de la feature « rapports ».
 *
 * ⚠️ Seul point d'entrée : importer un chemin interne depuis une autre feature
 * est interdit (CLAUDE.md §4).
 */

export { ReportsView } from "./components/reports-view";
export { ExportForm } from "./components/export-form";
export type { ExportRunView, DownloadPayload } from "./actions/types";
