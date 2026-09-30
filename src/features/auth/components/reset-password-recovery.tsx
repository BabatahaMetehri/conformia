"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  establishPasswordRecoveryAction,
  getPasswordRecoveryStateAction,
  verifyPasswordRecoveryMfaAction,
} from "@/features/auth/actions";
import { initialActionState } from "@/features/auth/actions/state";
import {
  FormError,
  FormNotice,
  SubmitButton,
  TextField,
} from "@/features/auth/components/auth-form";
import { PasswordForm } from "@/features/auth/components/password-form";

type RecoveryState = "checking" | "mfa" | "password" | "error";

export function ResetPasswordRecovery({
  locale,
  submitLabel,
}: {
  locale: string;
  submitLabel: string;
}) {
  const t = useTranslations();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");

  const [mfaState, mfaFormAction] = useActionState(
    verifyPasswordRecoveryMfaAction,
    initialActionState,
  );

  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    let cancelled = false;

    if (code === null || code.length === 0) {
      void getPasswordRecoveryStateAction().then((result) => {
        if (cancelled) return;

        if (!result.ok || !result.active) {
          setRecoveryState("error");
          return;
        }

        setRecoveryState(result.requiresMfa ? "mfa" : "password");
      });

      return () => {
        cancelled = true;
      };
    }

    void establishPasswordRecoveryAction(code).then((result) => {
      if (cancelled) return;

      url.searchParams.delete("code");
      window.history.replaceState(
        window.history.state,
        document.title,
        `${url.pathname}${url.search}${url.hash}`,
      );

      if (!result.ok) {
        setRecoveryState("error");
        return;
      }

      setRecoveryState(result.requiresMfa ? "mfa" : "password");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (recoveryState === "mfa" && mfaState.status === "success") {
      setRecoveryState("password");
    }
  }, [mfaState.status, recoveryState]);

  if (recoveryState === "checking") {
    return <FormNotice message={t("common.states.working")} />;
  }

  if (recoveryState === "error") {
    return <FormError message={t("errors.unauthenticated")} />;
  }

  if (recoveryState === "mfa") {
    return (
      <form action={mfaFormAction} className="space-y-4">
        <TextField
          id="recovery-code"
          name="code"
          type="text"
          label={t("auth.mfa.code")}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="\d{6}"
        />

        <FormError message={mfaState.error === undefined ? null : t(mfaState.error.message)} />

        <SubmitButton label={t("auth.mfa.submit")} pendingLabel={t("common.states.working")} />
      </form>
    );
  }

  return <PasswordForm locale={locale} submitLabel={submitLabel} recovery />;
}
