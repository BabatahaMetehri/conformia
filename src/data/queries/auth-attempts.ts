import "server-only";

/**
 * Lecture de la limitation de débit.
 *
 * Appelée AVANT toute session : le client est alors `anon`. La fonction SQL
 * sous-jacente est SECURITY DEFINER et ne rend qu'un booléen — ni compteur, ni
 * délai restant, ni indication de l'existence du compte.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function isAuthThrottled(
  email: string,
  ipAddress: string | null,
): Promise<Result<boolean>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("is_auth_throttled", {
    p_email: email,
    ...(ipAddress === null ? {} : { p_ip: ipAddress }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(data);
}
