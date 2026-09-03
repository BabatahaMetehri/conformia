import "server-only";

/**
 * Orchestration de la connexion.
 *
 * Trois garanties portées ici, et vérifiables en lisant ce seul fichier :
 *   1. la limitation de débit est évaluée AVANT toute vérification d'identifiants ;
 *   2. tout échec produit un LOGIN_FAILED daté et localisé dans audit_log ;
 *   3. l'erreur rendue est la MÊME quelle qu'en soit la cause — adresse inconnue et
 *      mot de passe incorrect sont indiscernables, sinon le formulaire devient un
 *      énumérateur de comptes.
 */

import { hasVerifiedMfa, isMfaRequiredFor } from "@/data/queries/auth";
import { isAuthThrottled } from "@/data/queries/auth-attempts";
import {
  logAuthEvent,
  recordAuthAttempt,
  signInWithPassword,
  signOut,
  type AuthAttemptContext,
} from "@/data/mutations/auth";
import { touchLastLogin } from "@/data/mutations/profiles";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";

/** Fenêtre de limitation, alignée sur `is_auth_throttled` en base. */
const THROTTLE_WINDOW_SECONDS = 900;

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface LoginOutcome {
  /** `true` si un second facteur doit être présenté avant d'élever la session. */
  readonly requiresMfaChallenge: boolean;
  /**
   * `true` si le second facteur est EXIGÉ pour ce compte mais n'a jamais été
   * enrôlé — l'enrôlement devient alors la seule destination admissible.
   *
   * ⚠️ POURQUOI CE CHAMP EXISTE ALORS QUE LE MIDDLEWARE POSE DÉJÀ LA GARDE.
   * La redirection d'une Server Action n'est pas une navigation : Next rend la
   * destination DANS la réponse de l'action, sans nouvelle requête, donc sans
   * middleware. Un porteur d'ADMIN sans second facteur voyait ainsi le tableau
   * de bord une fois — la garde ne se refermait qu'au clic suivant. La
   * destination doit donc être décidée ici, au moment où la session naît.
   */
  readonly requiresMfaEnrollment: boolean;
}

export async function login(request: LoginRequest): Promise<Result<LoginOutcome>> {
  const context: AuthAttemptContext = {
    email: request.email,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
  };

  const throttled = await isAuthThrottled(request.email, request.ipAddress);
  if (!throttled.ok) return throttled;
  if (throttled.value) {
    // Tracé comme un échec : une salve bloquée est précisément ce qu'un auditeur
    // doit pouvoir retrouver.
    await recordAuthAttempt(context, false);
    await logAuthEvent("LOGIN_FAILED", context);
    return err(AppError.rateLimited(THROTTLE_WINDOW_SECONDS));
  }

  const signedIn = await signInWithPassword(request.email, request.password);

  if (!signedIn.ok) {
    await recordAuthAttempt(context, false);
    await logAuthEvent("LOGIN_FAILED", context);
    // Message unique, volontairement muet sur la cause. Aucun `details` non plus :
    // un champ « emailExists » suffirait à rétablir l'énumération.
    return err(AppError.unauthenticated());
  }

  await recordAuthAttempt(context, true);
  await logAuthEvent("LOGIN", context, signedIn.value.userId);
  await touchLastLogin(signedIn.value.userId);

  // Exigé pour ce compte, mais jamais enrôlé : la session est valide et ne mène
  // nulle part ailleurs qu'à l'enrôlement. Un verdict indisponible est traité
  // comme une exigence — se tromper dans ce sens ne coûte qu'un écran de trop.
  const required = await isMfaRequiredFor(signedIn.value.userId);
  const enrolled = await hasVerifiedMfa(signedIn.value.userId);
  const requiresMfaEnrollment =
    (!required.ok || required.value) && (!enrolled.ok || !enrolled.value);

  return ok({
    requiresMfaChallenge: signedIn.value.requiresMfaChallenge,
    requiresMfaEnrollment,
  });
}

export async function logout(context: AuthAttemptContext): Promise<Result<null>> {
  await logAuthEvent("LOGOUT", context);
  return signOut();
}
