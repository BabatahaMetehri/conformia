import { getTranslations } from "next-intl/server";

import { MfaVerifyForm } from "@/features/auth/components/mfa-forms";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Présentation du second facteur après vérification du mot de passe. */
export default async function MfaPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-medium">{t("auth.mfa.title")}</h2>
        <p className="text-sm opacity-80">{t("auth.mfa.subtitle")}</p>
      </header>

      <MfaVerifyForm locale={locale} />
    </section>
  );
}
