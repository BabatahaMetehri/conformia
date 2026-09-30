import "server-only";

/**
 * Écritures du parcours d'authentification.
 *
 * ⚠️ Aucune fonction de ce module ne transmet le mot de passe saisi ailleurs qu'à
 * Supabase Auth. Ni la journalisation, ni la limitation de débit ne le reçoivent :
 * il ne peut donc structurellement pas atteindre audit_log.
 *
 * Les jetons de session vivent dans des cookies httpOnly posés par @supabase/ssr.
 * Rien n'est écrit en localStorage.
 */

import { AppError, mapPostgrestError } from "@/lib/errors";
import { err, ok, tryCatch, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileId } from "@/types/domain";

export type AuthEventAction = "LOGIN" | "LOGIN_FAILED" | "LOGOUT" | "MFA_RESET";

export interface AuthAttemptContext {
  readonly email: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** Comptabilise une tentative, réussie ou non. Ne lève jamais : c'est une trace. */
export async function recordAuthAttempt(
  context: AuthAttemptContext,
  succeeded: boolean,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("record_auth_attempt", {
    p_email: context.email,
    p_succeeded: succeeded,
    ...(context.ipAddress === null ? {} : { p_ip: context.ipAddress }),
    ...(context.userAgent === null ? {} : { p_user_agent: context.userAgent }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

/** Trace durable dans audit_log. LOGIN_FAILED y figure avec l'IP, jamais le secret. */
export async function logAuthEvent(
  action: AuthEventAction,
  context: AuthAttemptContext,
  actorId: ProfileId | null = null,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("log_auth_event", {
    p_action: action,
    p_email: context.email,
    ...(context.ipAddress === null ? {} : { p_ip: context.ipAddress }),
    ...(context.userAgent === null ? {} : { p_user_agent: context.userAgent }),
    ...(actorId === null ? {} : { p_actor_id: actorId }),
  });

  if (error !== null) return err(mapPostgrestError(error));
  return ok(null);
}

export interface SignInResult {
  readonly userId: ProfileId;
  /** `true` si Supabase exige un second facteur avant d'élever la session. */
  readonly requiresMfaChallenge: boolean;
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<Result<SignInResult>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error !== null) {
    // Un seul code d'erreur, quelle qu'en soit la cause : identifiant inconnu et
    // mot de passe incorrect doivent être indiscernables (cf. §2).
    return err(AppError.unauthenticated({ cause: error }));
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  return ok({
    userId: data.user.id as ProfileId,
    requiresMfaChallenge: aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2",
  });
}

export async function signOut(): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error !== null) return err(AppError.internal({ cause: error }));
  return ok(null);
}

/**
 * Envoie un lien de réinitialisation. Rend toujours un succès : signaler qu'une
 * adresse est inconnue transformerait ce formulaire en énumérateur de comptes.
 */
export async function requestPasswordReset(
  email: string,
  redirectTo: string,
): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return ok(null);
}

export async function updatePassword(password: string): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error !== null)
    return err(AppError.validationFailed({ password: "REJECTED" }, { cause: error }));
  return ok(null);
}

// ─── Second facteur (TOTP) ───────────────────────────────────────────────────

export interface TotpEnrollment {
  readonly factorId: string;
  readonly qrCodeSvg: string;
  readonly secret: string;
}

export async function enrollTotpFactor(friendlyName: string): Promise<Result<TotpEnrollment>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });

  if (error !== null) return err(AppError.internal({ cause: error }));

  return ok({
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    secret: data.totp.secret,
  });
}

/** Vérifie un code TOTP : sert aussi bien à finaliser l'enrôlement qu'à ouvrir la session. */
export async function verifyTotpFactor(factorId: string, code: string): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();

  const challenge = await tryCatch(() => supabase.auth.mfa.challenge({ factorId }));
  if (!challenge.ok) return challenge;
  if (challenge.value.error !== null) {
    return err(AppError.unauthenticated({ cause: challenge.value.error }));
  }

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.value.data.id,
    code,
  });

  if (error !== null) return err(AppError.unauthenticated({ cause: error }));
  return ok(null);
}

export interface MfaFactorSummary {
  readonly id: string;
  readonly friendlyName: string | null;
  readonly verified: boolean;
}

export async function listTotpFactors(): Promise<Result<readonly MfaFactorSummary[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error !== null) return err(AppError.internal({ cause: error }));

  /*
   * ⚠️ `data.all` ET NON `data.totp` : le second ne rend que les facteurs
   * VÉRIFIÉS, ce qui rend les enrôlements inachevés invisibles. Or ce sont
   * précisément eux qu'il faut voir — un enrôlement laissé en plan occupe le
   * nom convivial et fait échouer toute tentative suivante.
   */
  return ok(
    data.all
      .filter((factor) => factor.factor_type === "totp")
      .map((factor) => ({
        id: factor.id,
        friendlyName: factor.friendly_name ?? null,
        verified: factor.status === "verified",
      })),
  );
}

/** Retire un facteur. Sert à reprendre un enrôlement inachevé, jamais à en défaire un vérifié. */
export async function unenrollFactor(factorId: string): Promise<Result<null>> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error !== null) return err(AppError.internal({ cause: error }));
  return ok(null);
}
