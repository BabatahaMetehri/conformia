import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { LoginForm } from "@/features/auth/components/login-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Écran de connexion. Aucune inscription libre : les comptes sont créés par
 * invitation administrateur, ce que la page dit explicitement plutôt que de
 * laisser l'utilisateur chercher un lien qui n'existe pas.
 */
export default async function LoginPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-medium">{t("auth.login.title")}</h2>
        <p className="text-sm opacity-80">{t("auth.login.subtitle")}</p>
      </header>

      <LoginForm locale={locale} />

      <footer className="space-y-3 text-sm">
        <Link href={`/${locale}/forgot-password`} className="underline">
          {t("auth.login.forgot")}
        </Link>
        <p className="opacity-70">{t("auth.login.noSignup")}</p>
        <p className="opacity-70">{t("auth.login.invited")}</p>
      </footer>
    </section>
  );
}
