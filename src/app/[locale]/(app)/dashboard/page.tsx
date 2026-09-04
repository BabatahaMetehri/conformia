import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { AbsenceIndicator } from "@/features/absences/components/absence-indicator";
import { RegisterScopePanel } from "@/features/dashboard/components/register-scope-panel";
import { RegisterScopeSelect } from "@/features/dashboard/components/register-scope-select";
import { DashboardCharts } from "@/features/dashboard/components/dashboard-charts";
import {
  DashboardAlerts,
  DashboardSummary,
  LateReasonPanel,
  WorkloadPanel,
} from "@/features/dashboard/components/dashboard-summary";
import { requireAuthContext } from "@/services/auth/context";
import { getCurrentAbsences } from "@/services/absences";
import { getDashboard } from "@/services/dashboard";
import { getComplianceByRegister, listCommercialRegisters } from "@/services/registers";
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
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  /*
   * Les deux lectures partent ENSEMBLE. Enchaînées, elles ajouteraient leurs
   * latences pour un écran qui ne s'affiche de toute façon qu'une fois les deux
   * arrivées.
   */
  const query = await searchParams;
  const selected = (() => {
    const raw = query["register"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value === undefined || value.length === 0 ? null : value;
  })();

  const [view, absences, registers, compliance] = await Promise.all([
    getDashboard(),
    getCurrentAbsences(),
    listCommercialRegisters(),
    /*
     * ⚠️ `register_compliance()` est CÂBLÉE, pas réécrite. Elle porte déjà la
     * définition de la conformité — dossiers SANS OBJET hors dénominateur, taux
     * NULL plutôt que 0 % quand il n'y a rien à déclarer — et la recalculer ici
     * en produirait une seconde, vouée à diverger de celle du rapport.
     */
    selected === null ? Promise.resolve(null) : getComplianceByRegister(),
  ]);

  const scoped =
    selected === null || compliance === null || !compliance.ok
      ? null
      : (compliance.value.find((row) => row.registerId === selected) ?? null);

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

      {/*
       * ⚠️ EN TÊTE, avant les agrégats. « Untel est absent » explique pourquoi
       * un dossier n'avance pas ; placé sous les graphiques, il serait lu
       * après qu'on a cherché ailleurs.
       */}
      {absences.ok ? <AbsenceIndicator absences={absences.value} /> : null}

      <RegisterScopeSelect
        registers={
          registers.ok
            ? registers.value.map((r) => ({ id: r.id, label: `${r.rcNumber} — ${r.label}` }))
            : []
        }
      />

      {/*
       * ⚠️ MESURE EXCLUSIVE quand un registre est sélectionné, et l'écran le
       * DIT. Les agrégats qui suivent restent à l'échelle de l'entreprise :
       * les mêler sous un même titre laisserait croire qu'ils portent eux
       * aussi sur l'établissement choisi.
       */}
      {scoped === null ? null : <RegisterScopePanel compliance={scoped} />}

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
