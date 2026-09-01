import "server-only";

/**
 * Fiche d'une pièce : la pièce, ses versions, ses contrôles, ses accès.
 *
 * ⚠️ Aucune de ces lectures ne contourne la RLS. Si l'appelant n'a pas le droit
 * de voir la pièce, la première requête ne rend rien et la fiche répond
 * « introuvable ». C'est voulu : distinguer « absent » de « interdit »
 * renseignerait sur l'existence d'une déclaration qu'on n'a pas le droit de voir.
 */

import {
  listDocumentAccessLog,
  listIntegrityChecks,
  searchDocuments,
  type DocumentAccessEntry,
  type DocumentSearchRow,
  type IntegrityCheckEntry,
} from "@/data/queries/documents";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";

export interface DocumentFileView {
  readonly document: DocumentSearchRow & { readonly sha256: string };
  /** Versions précédentes, de la plus récente à la plus ancienne. */
  readonly versions: readonly DocumentSearchRow[];
  readonly accessLog: readonly DocumentAccessEntry[];
  readonly integrityChecks: readonly IntegrityCheckEntry[];
}

export async function getDocumentFile(documentId: string): Promise<Result<DocumentFileView>> {
  const context = await requirePermission("document.read");
  if (!context.ok) return context;

  const found = await searchDocuments({ documentId, limit: 1, offset: 0 });
  if (!found.ok) return found;

  const document = found.value.rows.at(0);
  if (document === undefined) return err(AppError.notFound("document", documentId));

  const [chain, accessLog, integrityChecks] = await Promise.all([
    // Toutes les pièces du même dossier rattachées à la même ligne de liste de
    // contrôle : c'est la chaîne de versions, `supersedes_id` la reliant.
    searchDocuments({
      occurrenceId: document.occurrenceId,
      checklistItemId: document.checklistItemId,
      limit: 50,
      offset: 0,
    }),
    listDocumentAccessLog(documentId),
    listIntegrityChecks(documentId),
  ]);

  return ok({
    document: { ...document, sha256: document.sha256 },
    versions: chain.ok ? chain.value.rows.filter((row) => row.id !== documentId) : [],
    accessLog: accessLog.ok ? accessLog.value : [],
    integrityChecks: integrityChecks.ok ? integrityChecks.value : [],
  });
}
