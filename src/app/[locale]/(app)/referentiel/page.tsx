import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { ObligationFilters } from "@/features/obligations/components/obligation-filters";
import { ObligationsTable } from "@/features/obligations/components/obligations-table";
import { Link } from "@/i18n/navigation";
import {
  currentUserCanManageReferential,
  getFormOptions,
  listObligations,
} from "@/services/obligations";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Liste du référentiel.
 *
 * Server Component : les données arrivent avec le HTML, sans écran de
 * chargement client. Les filtres vivent dans l'URL, ce qui rend chaque vue
 * partageable et navigable au bouton « précédent ».
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionAccess("/referentiel");

  const t = await getTranslations("obligations");
  const params = await searchParams;

  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const active = first("active");

  const [rows, options, canManage] = await Promise.all([
    listObligations({
      search: first("q"),
      domain_id: first("domain"),
      authority_id: first("authority"),
      periodicity: first("periodicity"),
      criticality: first("criticality"),
      ...(active === undefined ? {} : { is_active: active === "true" }),
    }),
    getFormOptions(),
    currentUserCanManageReferential(),
  ]);

  if (!rows.ok || !options.ok) {
    return (
      <>
        <SectionHeader titleKey="obligations" descriptionKey="obligations" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader
        titleKey="obligations"
        descriptionKey="obligations"
        actions={
          // Le bouton n'apparaît qu'avec le droit d'écrire. Ce n'est pas la
          // protection — la Server Action revérifie — c'est de l'hygiène : on ne
          // propose pas un geste qui sera refusé.
          canManage ? (
            <Button asChild size="sm">
              <Link href="/referentiel/nouveau">
                <Plus aria-hidden="true" className="size-4" />
                {t("create")}
              </Link>
            </Button>
          ) : null
        }
      />

      <ObligationFilters
        domains={options.value.domains.map((domain) => ({
          id: domain.id,
          label: domain.label,
        }))}
        authorities={options.value.authorities.map((authority) => ({
          id: authority.id,
          name: authority.name,
        }))}
      />

      <ObligationsTable
        canManage={canManage}
        rows={rows.value.map((row) => ({
          id: row.obligationType.id,
          code: row.obligationType.code,
          name: row.obligationType.name,
          domainLabel: row.domain?.label ?? null,
          authorityName: row.authority?.name ?? null,
          periodicity: row.obligationType.periodicity,
          criticality: row.obligationType.criticality,
          defaultOwnerName: row.defaultOwnerName,
          nextDueDate: row.nextDueDate,
          isActive: row.obligationType.is_active,
        }))}
      />
    </>
  );
}
