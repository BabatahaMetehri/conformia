import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { DashboardCharts } from "@/features/dashboard/components/dashboard-charts";
import {
  DashboardAlerts,
  DashboardSummary,
  LateReasonPanel,
  WorkloadPanel,
} from "@/features/dashboard/components/dashboard-summary";
import { requireAuthContext } from "@/services/auth/context";
import { getDashboard } from "@/services/dashboard";
import { canAccessPath, firstAccessiblePath } from "@/services/navigation";

/**
 * Tableau de bord — page d'atterrissage après connexion.
 *
 * Elle se comporte différemment des autres sections : un accès refusé n'y rend
 * PAS « introuvable », il REDIRIGE vers la première section ouverte.
 *
 * La raison tient à sa place dans le parcours. ADMIN ne détient ni
 * `dashboard.view_all` ni `occurrence.read` : il ne voit pas cette entrée dans
 * la navigation, mais c'est ici que la connexion le dépose. Lui présenter une
 * page « introuvable » juste après avoir saisi son mot de passe se lit comme une
 * panne. Une redirection ne révèle rien de plus — l'existence du tableau de bord
 * n'est un secret pour personne, contrairement à celle d'un dossier fiscal.
 *
 * ⚠️ TOUS les agrégats affichés viennent de vues matérialisées rafraîchies
 * toutes les quinze minutes. Aucun calcul lourd n'est fait pendant cette
 * requête : c'est la seule façon de tenir le budget sur 50 000 dossiers, et la
 * mesure est dans `tests/integration/dashboard-performance.test.ts`.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const context = await requireAuthContext();
  if (!context.ok) {
    const { locale } = await params;
    redirect(`/${locale}/login`);
  }

  if (!(await canAccessPath("/dashboard"))) {
    const { locale } = await params;
    redirect(`/${locale}${firstAccessiblePath(context.value)}`);
  }

  const t = await getTranslations("dashboard");
  const view = await getDashboard();

  if (!view.ok) {
    return (
      <>
        <SectionHeader titleKey="dashboard" descriptionKey="dashboard" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="dashboard" descriptionKey="dashboard" />

      <div className="space-y-4">
        <DashboardAlerts view={view.value} />
        <DashboardSummary view={view.value} />
        <DashboardCharts view={view.value} />
        <div className="grid gap-4 xl:grid-cols-2">
          <LateReasonPanel view={view.value} />
          <WorkloadPanel view={view.value} />
        </div>
      </div>
    </>
  );
}
