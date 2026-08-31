import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ForgotPasswordPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-medium">{t("auth.forgotPassword.title")}</h2>
        {/* Formulation conditionnelle assumée : « si un compte y correspond ». */}
        <p className="text-sm opacity-80">{t("auth.forgotPassword.subtitle")}</p>
      </header>

      <ForgotPasswordForm locale={locale} />

      <Link href={`/${locale}/login`} className="text-sm underline">
        {t("auth.forgotPassword.backToLogin")}
      </Link>
    </section>
  );
}
