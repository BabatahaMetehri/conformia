"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { forgotPasswordAction } from "@/features/auth/actions";
import { initialActionState } from "@/features/auth/actions/state";
import { FormNotice, SubmitButton, TextField } from "@/features/auth/components/auth-form";

export function ForgotPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(forgotPasswordAction, initialActionState);

  // Confirmation identique qu'un compte existe ou non : ce formulaire ne doit
  // pas pouvoir servir à énumérer les adresses valides.
  if (state.status === "success" && state.message !== undefined) {
    return <FormNotice message={t(state.message)} />;
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <TextField
        id="email"
        name="email"
        type="email"
        label={t("auth.login.email")}
        autoComplete="username"
      />
      <SubmitButton
        label={t("auth.forgotPassword.submit")}
        pendingLabel={t("common.states.working")}
      />
    </form>
  );
}
