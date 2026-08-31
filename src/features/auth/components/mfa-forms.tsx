"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  completeMfaEnrollmentAction,
  verifyMfaAction,
  initialActionState,
} from "@/features/auth/actions";
import { FormError, SubmitButton, TextField } from "@/features/auth/components/auth-form";

/** Champ commun aux deux formulaires : six chiffres, saisie numérique. */
function TotpField({ label }: { label: string }) {
  return (
    <TextField
      id="code"
      name="code"
      type="text"
      label={label}
      // `one-time-code` laisse le gestionnaire du téléphone proposer le code.
      autoComplete="one-time-code"
      inputMode="numeric"
      pattern="\d{6}"
    />
  );
}

export function MfaVerifyForm({ locale }: { locale: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(verifyMfaAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <TotpField label={t("auth.mfa.code")} />
      <FormError message={state.error === undefined ? null : t(state.error.message)} />
      <SubmitButton label={t("auth.mfa.submit")} pendingLabel={t("common.states.working")} />
    </form>
  );
}

interface MfaEnrollFormProps {
  readonly locale: string;
  readonly factorId: string;
  readonly qrCodeSvg: string;
  readonly secret: string;
}

export function MfaEnrollForm({ locale, factorId, qrCodeSvg, secret }: MfaEnrollFormProps) {
  const t = useTranslations();
  const [state, formAction] = useActionState(completeMfaEnrollmentAction, initialActionState);

  return (
    <div className="space-y-4">
      {/*
        Le QR est un SVG produit par Supabase Auth, pas par une saisie utilisateur.
        Il est rendu via une balise <img> et une URL de données : aucun balisage
        externe n'est injecté dans le document, ce qui serait un vecteur XSS.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- le QR est une
          URI de données produite par Supabase Auth : next/image ne peut ni
          l'optimiser ni la mettre en cache, il n'apporterait qu'un détour. */}
      <img
        src={qrCodeSvg}
        alt={t("auth.mfa.enrollTitle")}
        width={200}
        height={200}
        className="mx-auto"
      />

      <details className="text-sm">
        <summary>{t("auth.mfa.manualSecret")}</summary>
        <code className="mt-2 block rounded border px-2 py-1 break-all">{secret}</code>
      </details>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="factorId" value={factorId} />
        <TotpField label={t("auth.mfa.code")} />
        <FormError message={state.error === undefined ? null : t(state.error.message)} />
        <SubmitButton
          label={t("auth.mfa.submitEnroll")}
          pendingLabel={t("common.states.working")}
        />
      </form>
    </div>
  );
}
