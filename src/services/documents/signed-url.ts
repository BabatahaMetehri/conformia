import "server-only";

/**
 * Émission d'une URL signée de lecture.
 *
 * Aucun document n'est accessible autrement : le bucket est privé et ne sert
 * aucune URL publique. Chaque émission est journalisée avant d'être rendue —
 * si la trace ne peut pas être écrite, l'URL n'est pas délivrée.
 */

import { SIGNED_URL_TTL_SECONDS } from "@/config/constants";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DocumentAccessAction = "SIGNED_URL_ISSUED" | "VIEW" | "DOWNLOAD";

export interface SignedUrlRequest {
  readonly documentId: string;
  readonly action: DocumentAccessAction;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** `true` force le téléchargement plutôt que l'affichage en ligne. */
  readonly asAttachment: boolean;
}

export interface SignedDocumentUrl {
  readonly url: string;
  readonly expiresInSeconds: number;
  readonly filename: string;
}

/** Lit le TTL en base ; le repli évite qu'une clé effacée ne bloque les lectures. */
async function resolveTtlSeconds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "signed_url_ttl_seconds")
    .maybeSingle();

  const raw: unknown = data?.value;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : SIGNED_URL_TTL_SECONDS;
}

export async function issueSignedDocumentUrl(
  request: SignedUrlRequest,
): Promise<Result<SignedDocumentUrl>> {
  const supabase = await createSupabaseServerClient();

  // La RLS fait le contrôle d'accès : un document d'un autre domaine ne remonte
  // pas. On ne distingue donc pas « absent » de « interdit » — c'est voulu, la
  // réponse ne doit pas révéler l'existence d'une pièce qu'on n'a pas le droit de voir.
  const { data: document, error: readError } = await supabase
    .from("documents")
    .select("id, bucket, storage_path, normalized_filename")
    .eq("id", request.documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError !== null) {
    return err(AppError.storageFailed("read-document", { cause: readError }));
  }
  if (document === null) {
    return err(AppError.notFound("document", request.documentId));
  }

  const ttlSeconds = await resolveTtlSeconds(supabase);

  // Journaliser AVANT de délivrer : une URL remise sans trace serait un accès
  // invisible. Mieux vaut refuser la lecture que de la rendre inauditable.
  // Les paramètres facultatifs sont omis plutôt que passés à `null` :
  // `exactOptionalPropertyTypes` distingue « absent » de « présent et nul ».
  const { error: logError } = await supabase.rpc("log_document_access", {
    p_document_id: request.documentId,
    p_action: request.action,
    ...(request.ipAddress === null ? {} : { p_ip: request.ipAddress }),
    ...(request.userAgent === null ? {} : { p_user_agent: request.userAgent }),
  });

  if (logError !== null) {
    return err(AppError.storageFailed("log-document-access", { cause: logError }));
  }

  // `bucket` est NOT NULL avec valeur par défaut en base : la colonne fait foi,
  // la constante applicative ne sert qu'à l'écriture initiale.
  const { data: signed, error: signError } = await supabase.storage
    .from(document.bucket)
    .createSignedUrl(
      document.storage_path,
      ttlSeconds,
      request.asAttachment ? { download: document.normalized_filename } : undefined,
    );

  if (signError !== null) {
    return err(AppError.storageFailed("create-signed-url", { cause: signError }));
  }

  return ok({
    url: signed.signedUrl,
    expiresInSeconds: ttlSeconds,
    filename: document.normalized_filename,
  });
}
