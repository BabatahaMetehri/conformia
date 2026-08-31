import { getTranslations } from "next-intl/server";

import { PasswordForm } from "@/features/auth/components/password-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Première ouverture d'un compte créé par invitation. Techniquement identique à
 * la réinitialisation — même session de récupération, même politique — mais
 * distincte à l'écran : on n'accueille pas quelqu'un comme on le dépanne.
 */
export default async function SetPasswordPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-medium">{t("auth.setPassword.title")}</h2>
        <p className="text-sm opacity-80">{t("auth.setPassword.subtitle")}</p>
      </header>

      <PasswordForm locale={locale} submitLabel={t("auth.setPassword.submit")} />
    </section>
  );
}
