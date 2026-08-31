import "server-only";

/**
 * Écritures liées aux pièces.
 *
 * La journalisation d'accès passe obligatoirement par la fonction SQL
 * `log_document_access` : l'insertion directe est révoquée pour tous les rôles,
 * y compris service_role, afin qu'un `actor_id` ne puisse pas être forgé.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentId } from "@/types/domain";

export type DocumentAccessAction = "SIGNED_URL_ISSUED" | "VIEW" | "DOWNLOAD";

export interface DocumentAccessContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export async function logDocumentAccess(
  documentId: DocumentId,
  action: DocumentAccessAction,
  context: DocumentAccessContext,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("log_document_access", {
    p_document_id: documentId,
    p_action: action,
    ...(context.ipAddress === null ? {} : { p_ip: context.ipAddress }),
    ...(context.userAgent === null ? {} : { p_user_agent: context.userAgent }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}
