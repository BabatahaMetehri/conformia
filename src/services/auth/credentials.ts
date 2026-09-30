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
  exchangePasswordRecoveryCode,
  listTotpFactors,
  logAuthEvent,
  requestPasswordReset,
  unenrollFactor,
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

export async function establishPasswordRecoverySession(code: string): Promise<Result<null>> {
  return exchangePasswordRecoveryCode(code);
}

export async function choosePassword(password: string): Promise<Result<null>> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return err(AppError.validationFailed({ password: "TOO_SHORT" }));
  }
  // La vérification contre les bases de mots de passe compromis est faite par
  // Supabase (HaveIBeenPwned) : elle rejette la mise à jour, et l'erreur remonte ici.
  return updatePassword(password);
}

/** Nom convivial du facteur. Unique par compte côté Supabase — d'où la reprise ci-dessous. */
const FACTOR_NAME = "CONFORMIA";

/**
 * Ouvre un enrôlement TOTP, en reprenant celui laissé en plan s'il y en a un.
 *
 * ⚠️ CE N'EST PAS UNE PRÉCAUTION DÉCORATIVE. Supabase refuse un second facteur
 * portant un nom convivial déjà pris, y compris par un enrôlement JAMAIS
 * TERMINÉ. Or l'écran d'enrôlement en ouvre un à chaque affichage : un simple
 * rafraîchissement, un retour arrière, une seconde visite suffisaient à rendre
 * l'écran définitivement inutilisable — et pour un ADMIN, que le middleware
 * enferme sur cet écran, à verrouiller le compte hors de l'application.
 *
 * ⚠️ Seuls les facteurs NON VÉRIFIÉS sont retirés. Retirer un facteur vérifié
 * priverait l'utilisateur de son second facteur en activité au seul motif qu'il
 * a ouvert l'écran d'enrôlement.
 */
export async function beginTotpEnrollment(): Promise<Result<TotpEnrollment>> {
  const factors = await listTotpFactors();
  if (factors.ok) {
    for (const factor of factors.value) {
      if (factor.verified || factor.friendlyName !== FACTOR_NAME) continue;
      await unenrollFactor(factor.id);
    }
  }

  return enrollTotpFactor(FACTOR_NAME);
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
