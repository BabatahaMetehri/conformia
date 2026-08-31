import { getTranslations } from "next-intl/server";

import { PasswordForm } from "@/features/auth/components/password-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Atteinte depuis le lien reçu par courriel. Supabase y dépose une session de
 * récupération ; c'est le seul contexte où un nouveau mot de passe est accepté.
 */
export default async function ResetPasswordPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-medium">{t("auth.resetPassword.title")}</h2>
        <p className="text-sm opacity-80">{t("auth.resetPassword.subtitle")}</p>
      </header>

      <PasswordForm locale={locale} submitLabel={t("auth.resetPassword.submit")} />
    </section>
  );
}
