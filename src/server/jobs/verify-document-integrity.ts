/**
 * CONTRÔLE D'INTÉGRITÉ DOCUMENTAIRE — tâche mensuelle.
 *
 * Recalcule l'empreinte SHA-256 d'un échantillon de pièces à partir des octets
 * RÉELLEMENT STOCKÉS, et la confronte à celle enregistrée au dépôt.
 *
 * ⚠️ C'est ici, et nulle part ailleurs, que `documents.sha256` cesse d'être une
 * déclaration pour devenir une vérification. Depuis 0009 le fichier ne transite
 * plus par le serveur applicatif : l'empreinte est calculée par le NAVIGATEUR au
 * moment du dépôt, elle n'engage donc que lui. Une divergence constatée ici
 * signifie l'une de deux choses, et le constat ne permet pas de les distinguer :
 *   • le fichier a été altéré dans le stockage depuis son dépôt ;
 *   • l'empreinte annoncée à l'origine était fausse.
 * Les deux justifient une alerte, et aucune ne se referme sans intervention.
 *
 * Cette tâche est le SEUL endroit du projet qui lit un document en entier :
 * calculer une empreinte suppose de parcourir tous les octets. Elle s'exécute
 * hors requête, avec la clé de service — usage n° 5 de la liste fermée de
 * `src/lib/supabase/admin.ts`.
 *
 * ⚠️ ELLE NE SUPPRIME RIEN, JAMAIS. Un fichier divergent est signalé, pas effacé :
 * une pièce dont l'intégrité est douteuse reste une pièce, et c'est encore plus
 * vrai quand elle est douteuse.
 */

import { randomUUID } from "node:crypto";

// ⚠️ EN PREMIER, avant le client de service : ce module pose le marqueur
// que la garde d'emplacement attend (cf. admin-guard.ts).
import "@/server/jobs/_job-context";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/files";
import { sampleSize } from "@/lib/integrity-sampling";
import { logger } from "@/lib/logger";

type IntegrityStatus = "VERIFIED" | "MISMATCH" | "MISSING";

export interface IntegrityRunReport {
  readonly runId: string;
  readonly examined: number;
  readonly verified: number;
  readonly mismatched: number;
  readonly missing: number;
  readonly mismatchedDocumentIds: readonly string[];
}

async function readSetting(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  fallback: number,
): Promise<number> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();

  const raw: unknown = data?.value;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

export async function verifyDocumentIntegrity(): Promise<IntegrityRunReport> {
  const supabase = createSupabaseAdminClient();
  const runId = randomUUID();

  const [ratio, minimum] = await Promise.all([
    readSetting(supabase, "integrity_sample_ratio_percent", 10),
    readSetting(supabase, "integrity_sample_minimum", 50),
  ]);

  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  const target = sampleSize(count ?? 0, ratio, minimum);
  if (target === 0) {
    logger.info("Contrôle d'intégrité : aucun document à vérifier", { runId });
    return {
      runId,
      examined: 0,
      verified: 0,
      mismatched: 0,
      missing: 0,
      mismatchedDocumentIds: [],
    };
  }

  const { data: sample, error } = await supabase.rpc("sample_documents_for_integrity", {
    p_sample_size: target,
  });

  if (error !== null) {
    throw new Error(`Échantillonnage impossible : ${error.message}`);
  }

  let verified = 0;
  let mismatched = 0;
  let missing = 0;
  const mismatchedDocumentIds: string[] = [];

  for (const document of sample) {
    const { status, actual, size } = await inspectOne(supabase, document);

    if (status === "VERIFIED") verified += 1;
    if (status === "MISSING") missing += 1;
    if (status === "MISMATCH") {
      mismatched += 1;
      mismatchedDocumentIds.push(document.id);
    }

    const { error: recordError } = await supabase.rpc("record_document_integrity_check", {
      p_run_id: runId,
      p_document_id: document.id,
      p_status: status,
      ...(actual === null ? {} : { p_actual_sha256: actual }),
      ...(size === null ? {} : { p_observed_size: size }),
    });

    // Un constat qu'on ne parvient pas à écrire est un contrôle qui n'a pas eu
    // lieu : on le signale bruyamment plutôt que de compter un succès.
    if (recordError !== null) {
      logger.error("Constat d'intégrité non enregistré", {
        runId,
        documentId: document.id,
        message: recordError.message,
      });
    }
  }

  const report: IntegrityRunReport = {
    runId,
    examined: sample.length,
    verified,
    mismatched,
    missing,
    mismatchedDocumentIds,
  };

  if (mismatched > 0 || missing > 0) {
    // ⚠️ ALERTE CRITIQUE. Elle est PERSISTÉE — chaque constat non conforme est une
    // ligne non acquittée de `document_integrity_alerts`, affichée en bandeau à
    // la Direction et à l'administrateur tant que personne ne l'a traitée.
    // Il n'existe pas encore de canal de notification sortant (courriel, message
    // interne) : quand la phase qui l'introduira arrivera, c'est cette vue
    // qu'elle devra lire. Rien ici ne doit être dupliqué à ce moment-là.
    logger.error("ALERTE INTÉGRITÉ — divergence détectée", {
      runId,
      mismatched,
      missing,
      documentIds: mismatchedDocumentIds,
    });
  } else {
    logger.info("Contrôle d'intégrité terminé sans écart", { runId, examined: report.examined });
  }

  return report;
}

async function inspectOne(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  document: {
    readonly id: string;
    readonly bucket: string;
    readonly storage_path: string;
    readonly sha256: string;
  },
): Promise<{ status: IntegrityStatus; actual: string | null; size: number | null }> {
  const { data, error } = await supabase.storage
    .from(document.bucket)
    .download(document.storage_path);

  // L'objet a disparu du stockage alors que la ligne existe toujours : ce n'est
  // pas une panne de la tâche, c'est un constat, et il vaut alerte.
  if (error !== null) {
    return { status: "MISSING", actual: null, size: null };
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  const actual = await sha256Hex(bytes);

  return {
    status: actual === document.sha256 ? "VERIFIED" : "MISMATCH",
    actual,
    size: bytes.length,
  };
}
