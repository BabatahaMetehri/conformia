import "server-only";

/**
 * Intégrité documentaire, côté consultation.
 *
 * Le RECALCUL n'est pas ici : il relève de `src/server/jobs/`, seul endroit
 * disposant des droits pour lire un objet sans restriction et de l'exécution
 * hors requête que suppose le hachage de plusieurs dizaines de fichiers. Ce
 * module ne fait que lire des constats et permettre de les acquitter.
 *
 * ⚠️ Distinction que l'interface doit rendre fidèlement : une pièce PENDING
 * n'est pas une pièce saine, c'est une pièce JAMAIS VÉRIFIÉE. Son empreinte a
 * été calculée par le navigateur au dépôt et n'a encore été confrontée à rien.
 * Afficher un signe rassurant sur cet état ferait passer une déclaration pour
 * une preuve.
 */

import {
  listIntegrityAlerts,
  listIntegrityChecks,
  type IntegrityAlertRow,
  type IntegrityCheckEntry,
} from "@/data/queries/documents";
import { acknowledgeIntegrityAlert as acknowledge } from "@/data/mutations/documents";
import { AppError } from "@/lib/errors";
import { err, type Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";

export type IntegrityStatus = "PENDING" | "VERIFIED" | "MISMATCH" | "MISSING";

export type { IntegrityAlertRow, IntegrityCheckEntry };

/** Alertes ouvertes — un constat non conforme que personne n'a encore traité. */
export async function getOpenIntegrityAlerts(): Promise<Result<readonly IntegrityAlertRow[]>> {
  return listIntegrityAlerts();
}

export async function getIntegrityHistory(
  documentId: string,
): Promise<Result<readonly IntegrityCheckEntry[]>> {
  return listIntegrityChecks(documentId);
}

/**
 * Acquitte un constat d'écart.
 *
 * Note d'au moins dix caractères : « vu » ne dit pas ce qui a été fait du
 * fichier divergent, et c'est précisément ce que le contrôle suivant aura
 * besoin de savoir. La règle est appliquée en base — elle est répétée ici pour
 * rendre le refus lisible avant l'aller-retour, jamais pour s'y substituer.
 */
export async function acknowledgeIntegrityAlert(
  checkId: number,
  note: string,
): Promise<Result<boolean>> {
  const context = await requirePermission("audit.read");
  if (!context.ok) return context;

  const trimmed = note.trim();
  if (trimmed.length < 10) {
    return err(AppError.validationFailed({ field: "note", reason: "REASON_TOO_SHORT" }));
  }

  return acknowledge(checkId, trimmed);
}
