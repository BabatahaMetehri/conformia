import "server-only";

/**
 * Mots de passe et second facteur.
 *
 * Rappel des décisions portées ici :
 *   • 12 caractères minimum, aucune exigence de composition ;
 *   • aucun renouvellement périodique — l'expiration forcée produit des variantes
 *     prévisibles où seul le dernier caractère change ;
 *   • la réinitialisation ne confirme jamais qu'une adresse correspond à un compte.
 */

import {
  enrollTotpFactor,
  listTotpFactors,
  logAuthEvent,
  requestPasswordReset,
  updatePassword,
  verifyTotpFactor,
  type MfaFactorSummary,
  type TotpEnrollment,
} from "@/data/mutations/auth";
import { setMfaEnrolled } from "@/data/mutations/profiles";
import { getAuthenticatedUser } from "@/data/queries/auth";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { env } from "@/config/env";

/** Longueur minimale, alignée sur `minimum_password_length` de config.toml. */
export const MIN_PASSWORD_LENGTH = 12;

export async function startPasswordReset(email: string, locale: string): Promise<Result<null>> {
  // Le lien retombe sur /reset-password : c'est là que Supabase dépose la session
  // de récupération, et le seul endroit d'où un nouveau mot de passe est accepté.
  return requestPasswordReset(email, `${env.NEXT_PUBLIC_APP_URL}/${locale}/reset-password`);
}

export async function choosePassword(password: string): Promise<Result<null>> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return err(AppError.validationFailed({ password: "TOO_SHORT" }));
  }
  // La vérification contre les bases de mots de passe compromis est faite par
  // Supabase (HaveIBeenPwned) : elle rejette la mise à jour, et l'erreur remonte ici.
  return updatePassword(password);
}

export async function beginTotpEnrollment(): Promise<Result<TotpEnrollment>> {
  return enrollTotpFactor("CONFORMIA");
}

/**
 * Finalise l'enrôlement. `profiles.mfa_enrolled` n'est qu'un reflet de confort :
 * l'autorité reste `auth.mfa_factors`, lue par `has_verified_mfa()`.
 */
export async function completeTotpEnrollment(
  factorId: string,
  code: string,
): Promise<Result<null>> {
  const verified = await verifyTotpFactor(factorId, code);
  if (!verified.ok) return verified;

  const user = await getAuthenticatedUser();
  if (user.ok && user.value !== null) {
    await setMfaEnrolled(user.value.id, true);
    await logAuthEvent(
      "MFA_RESET",
      { email: user.value.email ?? "", ipAddress: null, userAgent: null },
      user.value.id,
    );
  }
  return ok(null);
}

/** Vérifie le code à la connexion, sur le premier facteur enrôlé. */
export async function submitTotpChallenge(code: string): Promise<Result<null>> {
  const factors = await listTotpFactors();
  if (!factors.ok) return factors;

  const verified = factors.value.find((factor: MfaFactorSummary) => factor.verified);
  if (verified === undefined) {
    return err(AppError.unauthenticated({ details: { reason: "NO_VERIFIED_FACTOR" } }));
  }

  return verifyTotpFactor(verified.id, code);
}

export async function listEnrolledFactors(): Promise<Result<readonly MfaFactorSummary[]>> {
  return listTotpFactors();
}
