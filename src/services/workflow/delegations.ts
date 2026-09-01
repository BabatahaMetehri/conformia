import "server-only";

/**
 * Délégation temporaire du droit de valider.
 *
 * ⚠️ Une délégation est STRICTEMENT SUPÉRIEURE au partage de compte, qui est la
 * pratique que ce projet cherche à éliminer. Elle est datée, motivée, révocable,
 * et surtout : les actions faites sous son couvert portent LES DEUX identités —
 * celle qui a agi et celle pour le compte de qui elle a agi. Un mot de passe
 * prêté ne laisse, lui, qu'une seule trace, et elle est fausse.
 *
 * Les bornes sont en base (0002) : 90 jours maximum, date de fin obligatoire,
 * motif obligatoire, délégant ≠ délégataire. Elles sont rappelées ici pour
 * refuser tôt et lisiblement, jamais pour s'y substituer.
 */

import { MAX_DELEGATION_DAYS } from "@/config/constants";
import { listDelegations, type DelegationRow } from "@/data/queries/workflow";
import { listAssignableProfiles } from "@/data/queries/profiles-directory";
import { getObligationFormOptions } from "@/data/queries/obligations";
import { insertDelegation, revokeDelegation } from "@/data/mutations/workflow";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { requireAuthContext } from "@/services/auth/context";

export type { DelegationRow };

export const MIN_REASON_LENGTH = 10;

export interface CreateDelegationInput {
  readonly delegatorId: string;
  readonly delegateId: string;
  readonly domainId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
}

export async function listAllDelegations(): Promise<Result<readonly DelegationRow[]>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  // La politique de lecture décide de ce qui remonte : ses propres délégations,
  // et toutes pour qui détient le droit d'administration.
  return listDelegations();
}

export async function createDelegation(input: CreateDelegationInput): Promise<Result<string>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    return err(AppError.validationFailed({ field: "reason", reason: "REASON_TOO_SHORT" }));
  }

  if (input.delegatorId === input.delegateId) {
    return err(AppError.validationFailed({ reason: "SAME_PARTIES" }));
  }

  const start = Date.parse(`${input.startsAt}T00:00:00Z`);
  const end = Date.parse(`${input.endsAt}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return err(AppError.validationFailed({ field: "endsAt", reason: "INVALID_DATE" }));
  }
  if (end <= start) {
    return err(AppError.validationFailed({ field: "endsAt", reason: "END_BEFORE_START" }));
  }

  const days = Math.round((end - start) / 86_400_000);
  if (days > MAX_DELEGATION_DAYS) {
    // Une délégation permanente est une réorganisation : elle passe par les rôles.
    return err(
      AppError.validationFailed({ field: "endsAt", reason: "TOO_LONG", max: MAX_DELEGATION_DAYS }),
    );
  }

  return insertDelegation({
    delegatorId: input.delegatorId,
    delegateId: input.delegateId,
    domainId: input.domainId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    reason,
    createdBy: context.value.userId,
  });
}

/**
 * Révocation immédiate.
 *
 * La ligne est CONSERVÉE, jamais supprimée : elle justifie les actions faites
 * sous son couvert. Le contrôle de qualité — délégant ou Direction — est en
 * base, dans `revoke_validation_delegation`.
 */
export async function revoke(delegationId: string, reason: string): Promise<Result<boolean>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    return err(AppError.validationFailed({ field: "reason", reason: "REASON_TOO_SHORT" }));
  }

  return revokeDelegation(delegationId, trimmed);
}

export interface DelegationFormOptions {
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly domains: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Valeurs proposées au formulaire.
 *
 * Chaque source se replie sur une liste vide : un champ que l'utilisateur n'a
 * pas le droit d'alimenter doit disparaître, pas faire tomber l'écran. Rien ici
 * ne conditionne un droit — la politique d'insertion décide seule.
 */
export async function getDelegationFormOptions(): Promise<Result<DelegationFormOptions>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const [people, options] = await Promise.all([
    listAssignableProfiles(),
    getObligationFormOptions(),
  ]);

  return ok({
    people: people.ok ? people.value.map((row) => ({ id: row.id, name: row.fullName })) : [],
    domains: options.ok
      ? options.value.domains.map((row) => ({ id: row.id, label: row.label }))
      : [],
  });
}
