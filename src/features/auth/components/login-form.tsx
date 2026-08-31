"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { loginAction } from "@/features/auth/actions";
import { initialActionState } from "@/features/auth/actions/state";
import { FormError, SubmitButton, TextField } from "@/features/auth/components/auth-form";

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(loginAction, initialActionState);

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
      <TextField
        id="password"
        name="password"
        type="password"
        label={t("auth.login.password")}
        autoComplete="current-password"
      />

      {/*
        Le message d'erreur est le même pour une adresse inconnue et un mot de
        passe incorrect : la clé est choisie côté serveur, jamais déduite ici.
      */}
      <FormError message={state.error === undefined ? null : t(state.error.message)} />

      <SubmitButton label={t("auth.login.submit")} pendingLabel={t("common.states.working")} />
    </form>
  );
}
