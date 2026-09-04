import "server-only";

/**
 * Recherche transverse sur les pièces (/documents).
 *
 * ⚠️ AUCUN filtrage de confidentialité n'est fait ici, et c'est délibéré. La vue
 * `documents_search` est en `security_invoker` : elle applique la politique de
 * `documents`, donc le cloisonnement par domaine, à chaque ligne. Reproduire ce
 * filtrage en TypeScript créerait une seconde règle d'accès, qui divergerait de
 * la première le jour où l'une des deux serait modifiée — et c'est toujours la
 * plus permissive qui gagne ce genre de divergence.
 *
 * Conséquence à assumer : un utilisateur qui ne voit rien ici ne voit rien parce
 * que la base le lui refuse, pas parce qu'un `if` l'a décidé.
 */

import {
  listPurgeCandidates,
  searchDocuments,
  type DocumentSearchPage,
  type DocumentSearchRow,
  type PurgeCandidateRow,
} from "@/data/queries/documents";
import { listAssignableProfiles } from "@/data/queries/profiles-directory";
import { getFormOptions, listObligations } from "@/services/obligations";
import { ok, type Result } from "@/lib/result";
import { requirePermission } from "@/services/auth/context";

export type { DocumentSearchPage, DocumentSearchRow, PurgeCandidateRow };

export const DOCUMENTS_PAGE_SIZE = 25;

export interface DocumentSearchInput {
  readonly search?: string | undefined;
  readonly obligationTypeId?: string | undefined;
  readonly authorityId?: string | undefined;
  readonly documentKind?: string | undefined;
  readonly uploadedBy?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly currentOnly?: boolean | undefined;
  readonly registerId?: string | undefined;
  readonly page: number;
}

export async function findDocuments(
  input: DocumentSearchInput,
): Promise<Result<DocumentSearchPage>> {
  const context = await requirePermission("document.read");
  if (!context.ok) return context;

  const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1;

  return searchDocuments({
    search: input.search,
    obligationTypeId: input.obligationTypeId,
    authorityId: input.authorityId,
    documentKind: input.documentKind,
    uploadedBy: input.uploadedBy,
    from: input.from,
    // Une borne haute saisie au jour doit inclure ce jour entier : `2026-03-31`
    // sans heure exclurait tout ce qui a été déposé après minuit.
    to: input.to === undefined ? undefined : `${input.to}T23:59:59.999Z`,
    currentOnly: input.currentOnly,
    /*
     * ⚠️ FILTRE INCLUSIF. /documents est un écran de CONSULTATION : la question
     * posée est « qu'est-ce qui concerne cet établissement ? », et les pièces
     * d'une déclaration valant pour toute l'entreprise le concernent aussi.
     * L'écran ANNONCE le mode — un chiffre dont on ignore le périmètre finit
     * mal interprété en réunion.
     */
    registerId: input.registerId,
    limit: DOCUMENTS_PAGE_SIZE,
    offset: (page - 1) * DOCUMENTS_PAGE_SIZE,
  });
}

export interface DocumentFilterOptions {
  readonly obligations: readonly { readonly id: string; readonly label: string }[];
  readonly authorities: readonly { readonly id: string; readonly name: string }[];
  readonly uploaders: readonly { readonly id: string; readonly name: string }[];
}

/** Valeurs proposées dans les filtres. Toutes lues en base, aucune en dur. */
export async function getDocumentFilterOptions(): Promise<Result<DocumentFilterOptions>> {
  // ⚠️ Chaque source est facultative et se replie sur une liste vide. Un filtre
  // que l'utilisateur n'a pas le droit d'alimenter — le référentiel exige
  // `obligation.read`, l'annuaire un autre droit encore — doit disparaître de
  // l'écran, pas faire échouer la recherche entière. Rien ici ne conditionne
  // l'accès aux pièces : ce sont des valeurs proposées, le filtrage reste celui
  // de la vue `security_invoker`.
  const [options, directory, obligations] = await Promise.all([
    getFormOptions(),
    listAssignableProfiles(),
    listObligations({}),
  ]);

  return ok({
    obligations: obligations.ok
      ? obligations.value.map((row) => ({
          id: row.obligationType.id,
          label: `${row.obligationType.code} — ${row.obligationType.name}`,
        }))
      : [],
    authorities: options.ok
      ? options.value.authorities.map((authority) => ({
          id: authority.id,
          name: authority.name,
        }))
      : [],
    uploaders: directory.ok
      ? directory.value.map((profile) => ({ id: profile.id, name: profile.fullName }))
      : [],
  });
}

/**
 * File « Purge à examiner ».
 *
 * ⚠️ Cette fonction ne supprime rien et n'appelle rien qui supprime. Elle liste
 * des pièces ayant dépassé leur durée de conservation, pour qu'un humain
 * décide. Un paramètre de rétention mal réglé ne peut donc pas détruire de
 * donnée : il ne peut qu'allonger une liste.
 */
export async function listPurgeQueue(): Promise<Result<readonly PurgeCandidateRow[]>> {
  const context = await requirePermission("document.read");
  if (!context.ok) return context;

  return listPurgeCandidates();
}
