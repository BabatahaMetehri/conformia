"use server";

/**
 * Server Actions du parcours d'authentification.
 *
 * Chaque action valide son entrée avec Zod, appelle un service, et rend un
 * `ClientError` sérialisable — jamais l'`AppError` brute, dont la `cause` porte
 * l'erreur Postgres d'origine.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { DEFAULT_LOCALE } from "@/config/constants";
import { toClientError, type ClientError } from "@/lib/errors";
import { login, logout } from "@/services/auth/login";
import {
  beginTotpEnrollment,
  completeTotpEnrollment,
  submitTotpChallenge,
  startPasswordReset,
  choosePassword,
} from "@/services/auth/credentials";

export interface ActionState {
  readonly status: "idle" | "success" | "error";
  readonly error?: ClientError;
  /** Renseigné par les actions dont l'écran affiche une confirmation. */
  readonly message?: string;
}

const IDLE: ActionState = { status: "idle" };

const emailSchema = z.email().max(320);
/** 12 caractères minimum, aucune exigence de composition (cf. décisions §2). */
const passwordSchema = z.string().min(12).max(200);
const totpCodeSchema = z.string().regex(/^\d{6}$/);

/** L'IP réelle derrière le proxy de l'hébergeur : elle sert à la limitation et à l'audit. */
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const headerBag = await headers();
  const forwarded = headerBag.get("x-forwarded-for");
  const ip =
    forwarded !== null && forwarded.length > 0
      ? (forwarded.split(",")[0]?.trim() ?? null)
      : headerBag.get("x-real-ip");
  return { ip, userAgent: headerBag.get("user-agent") };
}

function failed(error: unknown): ActionState {
  return { status: "error", error: toClientError(error as never) };
}

export async function loginAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      email: emailSchema,
      password: passwordSchema,
      locale: z.string().default(DEFAULT_LOCALE),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    // Une entrée malformée reçoit le MÊME message qu'un identifiant erroné :
    // distinguer les deux permettrait de sonder l'existence des comptes.
    return {
      status: "error",
      error: {
        code: "UNAUTHENTICATED",
        message: "auth.errors.invalidCredentials",
        httpStatus: 401,
      },
    };
  }

  const { ip, userAgent } = await requestContext();
  const result = await login({
    email: parsed.data.email,
    password: parsed.data.password,
    ipAddress: ip,
    userAgent,
  });

  if (!result.ok) {
    return {
      status: "error",
      error: {
        code: result.error.code,
        message:
          result.error.code === "RATE_LIMITED"
            ? "auth.errors.rateLimited"
            : "auth.errors.invalidCredentials",
        httpStatus: result.error.httpStatus,
      },
    };
  }

  redirect(
    result.value.requiresMfaChallenge
      ? `/${parsed.data.locale}/mfa`
      : `/${parsed.data.locale}/dashboard`,
  );
}

export async function logoutAction(locale: string): Promise<void> {
  const { ip, userAgent } = await requestContext();
  await logout({ email: "", ipAddress: ip, userAgent });
  redirect(`/${locale}/login`);
}

export async function forgotPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({ email: emailSchema, locale: z.string().default(DEFAULT_LOCALE) })
    .safeParse(Object.fromEntries(formData));

  // Réponse identique dans tous les cas, y compris sur une adresse invalide :
  // ce formulaire ne doit jamais confirmer qu'un compte existe.
  if (!parsed.success) return { status: "success", message: "auth.forgotPassword.sent" };

  await startPasswordReset(parsed.data.email, parsed.data.locale);
  return { status: "success", message: "auth.forgotPassword.sent" };
}

export async function setPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      password: passwordSchema,
      confirmation: z.string(),
      locale: z.string().default(DEFAULT_LOCALE),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "auth.password.tooShort", httpStatus: 422 },
    };
  }
  if (parsed.data.password !== parsed.data.confirmation) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "auth.password.mismatch", httpStatus: 422 },
    };
  }

  const result = await choosePassword(parsed.data.password);
  if (!result.ok) return failed(result.error);

  redirect(`/${parsed.data.locale}/dashboard`);
}

export async function startMfaEnrollmentAction(): Promise<ActionState> {
  const result = await beginTotpEnrollment();
  return result.ok ? { status: "success" } : failed(result.error);
}

export async function completeMfaEnrollmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      factorId: z.string().min(1),
      code: totpCodeSchema,
      locale: z.string().default(DEFAULT_LOCALE),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "auth.errors.invalidCode", httpStatus: 422 },
    };
  }

  const result = await completeTotpEnrollment(parsed.data.factorId, parsed.data.code);
  if (!result.ok) {
    return {
      status: "error",
      error: {
        code: result.error.code,
        message: "auth.errors.invalidCode",
        httpStatus: result.error.httpStatus,
      },
    };
  }

  redirect(`/${parsed.data.locale}/dashboard`);
}

export async function verifyMfaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({ code: totpCodeSchema, locale: z.string().default(DEFAULT_LOCALE) })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: "error",
      error: { code: "VALIDATION_FAILED", message: "auth.errors.invalidCode", httpStatus: 422 },
    };
  }

  const result = await submitTotpChallenge(parsed.data.code);
  if (!result.ok) {
    return {
      status: "error",
      error: {
        code: result.error.code,
        message: "auth.errors.invalidCode",
        httpStatus: result.error.httpStatus,
      },
    };
  }

  redirect(`/${parsed.data.locale}/dashboard`);
}

export { IDLE as initialActionState };
