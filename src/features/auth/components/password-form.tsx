"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { setPasswordAction } from "@/features/auth/actions";
import { initialActionState } from "@/features/auth/actions/state";
import {
  FormError,
  FormNotice,
  SubmitButton,
  TextField,
} from "@/features/auth/components/auth-form";

/** Longueur minimale, alignée sur la politique serveur. */
const MIN_LENGTH = 12;

export function PasswordForm({ locale, submitLabel }: { locale: string; submitLabel: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(setPasswordAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      <TextField
        id="password"
        name="password"
        type="password"
        label={t("auth.resetPassword.password")}
        autoComplete="new-password"
        minLength={MIN_LENGTH}
        hint={t("auth.password.hint")}
      />
      <TextField
        id="confirmation"
        name="confirmation"
        type="password"
        label={t("auth.resetPassword.confirmation")}
        autoComplete="new-password"
        minLength={MIN_LENGTH}
      />

      <FormNotice message={t("auth.password.noExpiry")} />
      <FormError message={state.error === undefined ? null : t(state.error.message)} />

      <SubmitButton label={submitLabel} pendingLabel={t("common.states.working")} />
    </form>
  );
}
