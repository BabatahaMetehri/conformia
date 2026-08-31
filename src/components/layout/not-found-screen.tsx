import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * Écran « introuvable ».
 *
 * ⚠️ IL SERT AUSSI D'ÉCRAN « ACCÈS REFUSÉ », ET C'EST DÉLIBÉRÉ.
 *
 * Distinguer « cette occurrence n'existe pas » de « cette occurrence existe mais
 * ne vous est pas accessible » revient à répondre à la question « existe-t-il un
 * dossier fiscal identifié 4f2a… ? ». Un utilisateur du domaine social pourrait
 * alors énumérer les dossiers des autres domaines par simple différence de
 * message, sans jamais en lire un seul. Le cloisonnement établi par la RLS
 * serait contourné par le texte de l'interface.
 *
 * Les deux cas rendent donc exactement le même écran, avec exactement le même
 * texte. La RLS applique déjà ce principe côté base : une ligne interdite est
 * indistinguable d'une ligne absente.
 */
export async function NotFoundScreen() {
  const t = await getTranslations("routing");

  return (
    <div className="mx-auto max-w-lg py-16">
      <EmptyState
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/my-tasks">{t("backHome")}</Link>
          </Button>
        }
      />
    </div>
  );
}
