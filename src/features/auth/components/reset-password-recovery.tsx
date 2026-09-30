"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { establishPasswordRecoveryAction } from "@/features/auth/actions";
import { FormError, FormNotice } from "@/features/auth/components/auth-form";
import { PasswordForm } from "@/features/auth/components/password-form";

type RecoveryState = "checking" | "ready" | "error";

export function ResetPasswordRecovery({
  locale,
  submitLabel,
}: {
  locale: string;
  submitLabel: string;
}) {
  const t = useTranslations();
  const [state, setState] = useState<RecoveryState>("checking");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (code === null || code.length === 0) {
      setState("error");
      return;
    }

    let cancelled = false;

    void establishPasswordRecoveryAction(code).then((result) => {
      if (cancelled) return;

      if (!result.ok) {
        setState("error");
        return;
      }

      url.searchParams.delete("code");

      window.history.replaceState(
        window.history.state,
        document.title,
        `${url.pathname}${url.search}${url.hash}`,
      );

      setState("ready");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return <FormNotice message={t("common.states.working")} />;
  }

  if (state === "error") {
    return (
      <div className="space-y-4">
        <FormError message={t("errors.unauthenticated")} />
        <Link href={`/${locale}/login`} className="text-sm underline">
          {t("auth.forgotPassword.backToLogin")}
        </Link>
      </div>
    );
  }

  return <PasswordForm locale={locale} submitLabel={submitLabel} />;
}
