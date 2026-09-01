import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Markdown } from "@/components/shared/markdown";
import { EmptyState } from "@/components/shared/states";
import { listAssignableProfiles } from "@/data/queries/profiles-directory";
import { OccurrenceActionBar } from "@/features/occurrences/components/occurrence-action-bar";
import { OccurrenceBanners } from "@/features/occurrences/components/occurrence-banners";
import { OccurrenceChecklist } from "@/features/occurrences/components/occurrence-checklist";
import { OccurrenceDetailTabs } from "@/features/occurrences/components/occurrence-detail-tabs";
import { OccurrenceDiscussion } from "@/features/occurrences/components/occurrence-discussion";
import { OccurrenceDocuments } from "@/features/occurrences/components/occurrence-documents";
import { OccurrenceHeader } from "@/features/occurrences/components/occurrence-header";
import { OccurrencePreviousPeriods } from "@/features/occurrences/components/occurrence-previous-periods";
import { OccurrenceTimeline } from "@/features/occurrences/components/occurrence-timeline";
import { requireSectionAccess } from "@/services/navigation/guard";
import { getOccurrenceDetail } from "@/services/occurrences/detail";

/**
 * Fiche d'une occurrence — l'écran de travail effectif.
 *
 * ⚠️ Un dossier invisible rend `notFound()`, jamais « accès refusé ». La RLS
 * cloisonne par domaine ; distinguer les deux cas permettrait d'énumérer les
 * dossiers des autres domaines par simple différence de message.
 *
 * Server Component : tout ce qui n'a pas besoin d'interaction — en-tête,
 * bandeaux, procédure, historique, périodes précédentes — est rendu ici et ne
 * traverse pas le bundle client.
 */
export default async function Page({ params }: { params: Promise<{ occurrenceId: string }> }) {
  await requireSectionAccess("/echeancier");

  const { occurrenceId } = await params;
  const t = await getTranslations("occurrences.detail");

  const detail = await getOccurrenceDetail(occurrenceId);
  if (!detail.ok) notFound();

  const view = detail.value;

  // L'annuaire sert deux usages sur cet écran : la réaffectation et la
  // reconnaissance des mentions @ dans la discussion. Un annuaire vide dégrade
  // ces deux fonctions sans casser l'écran — d'où le repli sur une liste vide.
  const directory = await listAssignableProfiles();
  const assignees = directory.ok ? directory.value : [];

  return (
    <>
      <OccurrenceHeader detail={view} />
      <OccurrenceBanners detail={view} />
      <OccurrenceActionBar detail={view} assignees={assignees} />

      <OccurrenceDetailTabs
        counts={{
          missingPieces: view.completeness.missing.length,
          documents: view.documents.length,
          comments: view.comments.length,
        }}
        procedure={
          view.obligation.procedureMd === null || view.obligation.procedureMd.length === 0 ? (
            <EmptyState title={t("noProcedure")} description={t("noProcedureHint")} />
          ) : (
            <div className="space-y-4">
              <Markdown source={view.obligation.procedureMd} />
              {view.obligation.legalBasis === null ? null : (
                <p className="text-xs text-text-muted">
                  {t("legalBasis", { basis: view.obligation.legalBasis })}
                </p>
              )}
              {view.obligation.portalUrl === null ? null : (
                <a
                  href={view.obligation.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  {t("openPortal")}
                </a>
              )}
            </div>
          )
        }
        dossier={<OccurrenceChecklist detail={view} />}
        documents={<OccurrenceDocuments detail={view} />}
        discussion={<OccurrenceDiscussion detail={view} directory={assignees} />}
        history={<OccurrenceTimeline detail={view} />}
        previousPeriods={<OccurrencePreviousPeriods detail={view} />}
      />
    </>
  );
}
