import { redirect } from "next/navigation";

import { SectionHeader, SectionPlaceholder } from "@/components/layout/section";
import { requireAuthContext } from "@/services/auth/context";
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

  return (
    <>
      <SectionHeader titleKey="dashboard" descriptionKey="dashboard" />
      <SectionPlaceholder />
    </>
  );
}
