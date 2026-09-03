import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RegisterDetailTabs } from "@/features/registers/components/register-detail-tabs";
import { Link } from "@/i18n/navigation";
import { requireSectionAccess } from "@/services/navigation/guard";
import {
  currentUserCanManageRegisters,
  getCommercialRegister,
  getRegisterChangelog,
  getRegisterDocuments,
  getRegisterHistory,
  getRegisterObligations,
} from "@/services/registers";

/**
 * Fiche d'un registre de commerce.
 *
 * ⚠️ C'EST L'ÉCRAN D'HISTORIQUE. Un établissement se juge sur ce qu'il a déposé
 * au fil des années — c'est ce qu'un contrôle demande, et c'est ce qu'un
 * échéancier centré sur la période en cours ne montre jamais.
 *
 * Les cinq lectures partent EN PARALLÈLE. Enchaînées, elles ajouteraient leurs
 * latences ; l'écran ne s'affiche de toute façon qu'une fois toutes arrivées.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ readonly registerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionAccess("/registres");

  const { registerId } = await params;
  const query = await searchParams;
  const t = await getTranslations("registers");
  const tType = await getTranslations("registers.type");

  const [register, history, documents, obligations, timeline, canManage] = await Promise.all([
    getCommercialRegister(registerId),
    getRegisterHistory(registerId, query),
    getRegisterDocuments(registerId),
    getRegisterObligations(),
    getRegisterChangelog(registerId),
    currentUserCanManageRegisters(),
  ]);

  /*
   * ⚠️ `notFound()`, PAS un écran « accès refusé ». Un registre que l'appelant
   * ne peut pas voir doit être indistinguable d'un registre qui n'existe pas :
   * la nuance renseignerait sur l'existence de ce qu'on cherche à cacher. C'est
   * la même règle que celle de `requireSectionAccess`.
   */
  if (!register.ok) notFound();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text-primary tabular-nums">
              {register.value.rcNumber}
            </h1>
            <Badge variant="outline">{tType(register.value.registerType)}</Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary">{register.value.label}</p>
        </div>

        {canManage ? (
          <Button asChild variant="outline">
            <Link href={`/registres/${registerId}/modifier`}>
              <Pencil aria-hidden="true" className="size-4" />
              {t("edit")}
            </Link>
          </Button>
        ) : null}
      </div>

      <RegisterDetailTabs
        register={register.value}
        obligations={obligations.ok ? obligations.value : []}
        history={history.ok ? history.value.items : []}
        documents={documents.ok ? documents.value : []}
        timeline={timeline.ok ? timeline.value : []}
      />
    </>
  );
}
