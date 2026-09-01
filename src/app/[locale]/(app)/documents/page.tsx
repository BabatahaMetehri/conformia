import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { DocumentFilters } from "@/features/documents/components/document-filters";
import { DocumentsTable } from "@/features/documents/components/documents-table";
import { IntegrityAlerts } from "@/features/documents/components/integrity-alerts";
import { requirePermission } from "@/services/auth/context";
import { getOpenIntegrityAlerts } from "@/services/documents/integrity";
import {
  DOCUMENTS_PAGE_SIZE,
  findDocuments,
  getDocumentFilterOptions,
} from "@/services/documents/search";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Recherche transverse des pièces.
 *
 * Server Component : les résultats arrivent avec le HTML. Les filtres vivent
 * dans l'URL, ce qui rend chaque recherche partageable et navigable au bouton
 * « précédent ».
 *
 * ⚠️ Aucun filtrage de confidentialité n'est fait ici. La vue interrogée est en
 * `security_invoker` : elle applique la politique de `documents`, donc le
 * cloisonnement par domaine, ligne à ligne. Ajouter un filtre ici créerait une
 * seconde règle d'accès, qui finirait par diverger de la première.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionAccess("/documents");

  const t = await getTranslations("documents");
  const params = await searchParams;

  const first = (key: string): string | undefined => {
    const value = params[key];
    const resolved = Array.isArray(value) ? value[0] : value;
    return resolved === undefined || resolved.length === 0 ? undefined : resolved;
  };

  const page = Number.parseInt(first("page") ?? "1", 10);

  const [results, options, alerts, canAcknowledge] = await Promise.all([
    findDocuments({
      search: first("q"),
      obligationTypeId: first("obligation"),
      authorityId: first("authority"),
      documentKind: first("kind"),
      uploadedBy: first("uploader"),
      from: first("from"),
      to: first("to"),
      page: Number.isInteger(page) && page > 0 ? page : 1,
    }),
    getDocumentFilterOptions(),
    getOpenIntegrityAlerts(),
    // Le droit d'acquitter une alerte : on n'affiche pas un geste qui serait
    // refusé. Ce n'est pas la protection — la Server Action revérifie.
    requirePermission("audit.read"),
  ]);

  if (!results.ok) {
    return (
      <>
        <SectionHeader titleKey="documents" descriptionKey="documents" />
        <ErrorState title={t("search.loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="documents" descriptionKey="documents" />

      <IntegrityAlerts alerts={alerts.ok ? alerts.value : []} canAcknowledge={canAcknowledge.ok} />

      <DocumentFilters
        obligations={options.ok ? options.value.obligations : []}
        authorities={options.ok ? options.value.authorities : []}
        uploaders={options.ok ? options.value.uploaders : []}
      />

      <DocumentsTable
        rows={results.value.rows}
        total={results.value.total}
        page={Number.isInteger(page) && page > 0 ? page : 1}
        pageSize={DOCUMENTS_PAGE_SIZE}
      />
    </>
  );
}
