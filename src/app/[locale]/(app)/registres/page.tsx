import { AlertTriangle, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { RegisterFilters } from "@/features/registers/components/register-filters";
import { RegistersTable } from "@/features/registers/components/registers-table";
import { Link } from "@/i18n/navigation";
import { requireSectionAccess } from "@/services/navigation/guard";
import {
  currentUserCanManageRegisters,
  getRegisterWilayas,
  listCommercialRegisters,
} from "@/services/registers";

/**
 * Liste des registres de commerce.
 *
 * Server Component : les données arrivent avec le HTML. Les filtres vivent dans
 * l'URL, ce qui rend chaque vue partageable et navigable au bouton « précédent ».
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionAccess("/registres");

  const t = await getTranslations("registers");
  const params = await searchParams;

  const first = (key: string): string | undefined => {
    const value = params[key];
    const raw = Array.isArray(value) ? value[0] : value;
    return raw === undefined || raw.length === 0 ? undefined : raw;
  };

  const [rows, wilayas, canManage] = await Promise.all([
    listCommercialRegisters({
      search: first("q"),
      registerType: first("type"),
      status: first("status"),
      wilaya: first("wilaya"),
    }),
    getRegisterWilayas(),
    currentUserCanManageRegisters(),
  ]);

  if (!rows.ok) {
    return (
      <>
        <SectionHeader titleKey="registers" descriptionKey="registers" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  /*
   * ⚠️ L'AVERTISSEMENT SE CALCULE SUR LA LISTE AFFICHÉE, et c'est voulu : il
   * décrit ce que l'utilisateur a sous les yeux. Le calculer sur l'ensemble des
   * registres annoncerait « trois expirent bientôt » au-dessus d'une liste
   * filtrée qui n'en montre aucun — un signal qu'on ne peut ni vérifier ni
   * atteindre.
   */
  const expiring = rows.value.filter((row) => row.expiresSoon).length;

  return (
    <>
      <SectionHeader
        titleKey="registers"
        descriptionKey="registers"
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/registres/nouveau">
                <Plus aria-hidden="true" className="size-4" />
                {t("new")}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {expiring > 0 ? (
        <div className="border-warning/30 bg-warning/10 text-warning mb-6 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <span>{t("expiry.warning", { count: expiring })}</span>
        </div>
      ) : null}

      <div className="mb-6">
        <RegisterFilters wilayas={wilayas.ok ? wilayas.value : []} />
      </div>

      {rows.value.length === 0 && Object.keys(params).length === 0 ? (
        <EmptyState title={t("emptyAll")} />
      ) : (
        <RegistersTable rows={rows.value} />
      )}
    </>
  );
}
