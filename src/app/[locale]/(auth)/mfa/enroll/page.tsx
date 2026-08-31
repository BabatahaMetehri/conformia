import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { MfaEnrollForm } from "@/features/auth/components/mfa-forms";
import { beginTotpEnrollment } from "@/services/auth/credentials";
import { getAuthContext } from "@/services/auth/context";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Enrôlement du second facteur.
 *
 * Deux publics, un seul écran :
 *   • ADMIN et DIRECTION y sont contraints par le middleware et n'ont aucune
 *     sortie — le lien « plus tard » ne leur est pas affiché ;
 *   • les autres rôles y arrivent sur invitation, et peuvent repartir.
 */
export default async function MfaEnrollPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations();

  const context = await getAuthContext();
  const mandatory = context.ok && context.value !== null && context.value.mfa.required;

  const enrollment = await beginTotpEnrollment();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-medium">{t("auth.mfa.enrollTitle")}</h2>
        <p className="text-sm opacity-80">{t("auth.mfa.enrollSubtitle")}</p>
        <p className="text-sm">
          {mandatory ? t("auth.mfa.enrollRequired") : t("auth.mfa.enrollSuggested")}
        </p>
      </header>

      {enrollment.ok ? (
        <MfaEnrollForm
          locale={locale}
          factorId={enrollment.value.factorId}
          qrCodeSvg={enrollment.value.qrCodeSvg}
          secret={enrollment.value.secret}
        />
      ) : (
        <p role="alert" className="rounded border px-3 py-2 text-sm">
          {t("errors.internal")}
        </p>
      )}

      {mandatory ? null : (
        <Link href={`/${locale}/dashboard`} className="text-sm underline">
          {t("auth.mfa.enrollLater")}
        </Link>
      )}
    </section>
  );
}
