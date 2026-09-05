import type { Metadata } from "next";
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
import { OccurrenceAssignment } from "@/features/occurrences/components/occurrence-assignment";
import { OccurrenceHeader } from "@/features/occurrences/components/occurrence-header";
import { OccurrencePreviousPeriods } from "@/features/occurrences/components/occurrence-previous-periods";
import { OccurrenceTimeline } from "@/features/occurrences/components/occurrence-timeline";
import { getCurrentAbsences } from "@/services/absences";
import { requireAuthContext } from "@/services/auth/context";
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
/**
 * ⚠️ L'EXISTENCE ET LE DROIT D'ACCÈS SE DÉCIDENT ICI, ET NON DANS LE CORPS DE LA
 * PAGE. Next rend les métadonnées AVANT d'ouvrir la moindre frontière de
 * suspension : un `notFound()` lancé depuis cet endroit produit une vraie
 * réponse 404. Lancé depuis le corps de la page, il arrivait après le premier
 * envoi — le segment porte un `loading.tsx`, donc une frontière — et le
 * navigateur recevait un 200 affichant un écran d'erreur.
 *
 * Ce que coûtait ce 200 : un moteur d'indexation garde la page, un client HTTP
 * la tient pour valide, une sonde de supervision ne voit aucun incident, et un
 * lien mort ne se signale nulle part.
 *
 * La lecture n'est pas dédoublée pour autant : `getOccurrenceDetail` est
 * mémoïsée par requête, et la page réutilise le résultat déjà obtenu ici.
 *
 * ⚠️ LE STREAMING DU RESTE N'EST PAS TOUCHÉ : `loading.tsx` demeure, et la page
 * continue de s'afficher par morceaux.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ occurrenceId: string }>;
}): Promise<Metadata> {
  await requireSectionAccess("/echeancier");
  const { occurrenceId } = await params;

  const detail = await getOccurrenceDetail(occurrenceId);
  // ⚠️ Une fiche interdite et une fiche inexistante prennent la MÊME sortie :
  // les distinguer permettrait d'énumérer les dossiers des autres domaines.
  if (!detail.ok) notFound();

  return { title: `${detail.value.obligation.code} — ${detail.value.periodKey}` };
}

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
  /*
   * Les deux lectures partent ENSEMBLE : l'annuaire sert la réaffectation et les
   * mentions de la discussion, les absences renseignent la disponibilité des
   * trois personnes. Enchaînées, elles ajouteraient leurs latences pour un écran
   * qui ne s'affiche qu'une fois les deux arrivées.
   */
  const [directory, absences, context] = await Promise.all([
    listAssignableProfiles(),
    getCurrentAbsences(),
    requireAuthContext(),
  ]);
  const assignees = directory.ok ? directory.value : [];

  return (
    <>
      <OccurrenceHeader detail={view} />
      <OccurrenceBanners detail={view} />
      <OccurrenceActionBar detail={view} assignees={assignees} />

      {context.ok ? (
        <OccurrenceAssignment
          detail={view}
          assignees={assignees}
          absences={absences.ok ? absences.value : []}
          currentUserId={context.value.userId}
          canAssign={context.value.permissions.has("occurrence.assign")}
        />
      ) : null}

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
