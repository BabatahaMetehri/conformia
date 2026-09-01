import "server-only";

/**
 * Écritures du circuit de validation.
 *
 * Les délégations s'insèrent sous RLS : la politique de 0002 exige que l'auteur
 * soit le délégant lui-même ou la Direction. La révocation, elle, passe par une
 * fonction — elle doit refermer la ligne sans jamais la supprimer.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface NewDelegation {
  readonly delegatorId: string;
  readonly delegateId: string;
  readonly domainId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
  readonly createdBy: string;
}

export async function insertDelegation(delegation: NewDelegation): Promise<Result<string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("validation_delegations")
    .insert({
      delegator_id: delegation.delegatorId,
      delegate_id: delegation.delegateId,
      domain_id: delegation.domainId,
      starts_at: delegation.startsAt,
      ends_at: delegation.endsAt,
      reason: delegation.reason,
      created_by: delegation.createdBy,
    })
    .select("id")
    .single();

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data.id);
}

export async function revokeDelegation(
  delegationId: string,
  reason: string,
): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("revoke_validation_delegation", {
    p_delegation_id: delegationId,
    p_reason: reason,
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}

export async function markNotificationRead(notificationId: number): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}
