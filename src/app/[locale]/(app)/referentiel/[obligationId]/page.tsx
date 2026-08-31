import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ObligationDetailTabs } from "@/features/obligations/components/obligation-detail-tabs";
import { Link } from "@/i18n/navigation";
import { listObligationAuditEntries } from "@/data/queries/obligations";
import { requireAuthContext } from "@/services/auth/context";
import { requireSectionAccess } from "@/services/navigation/guard";
import {
  currentUserCanManageReferential,
  getFormOptions,
  getObligation,
  listObligationOccurrences,
} from "@/services/obligations";
import { toObligationTypeId } from "@/types/domain";

/**
 * Fiche d'une obligation.
 *
 * ⚠️ Une obligation invisible rend `notFound()`, jamais « accès refusé ». La RLS
 * cloisonne le référentiel par domaine ; distinguer les deux cas permettrait
 * d'énumérer les obligations des autres domaines par simple différence de
 * message.
 */
export default async function Page({ params }: { params: Promise<{ obligationId: string }> }) {
  await requireSectionAccess("/referentiel");

  const t = await getTranslations("obligations");
  const { obligationId } = await params;

  const detail = await getObligation(obligationId);
  if (!detail.ok) notFound();

  const [occurrences, options, audit, context, canManage] = await Promise.all([
    listObligationOccurrences(obligationId),
    getFormOptions(),
    listObligationAuditEntries(toObligationTypeId(obligationId)),
    requireAuthContext(),
    currentUserCanManageReferential(),
  ]);

  const row = detail.value.obligationType;
  const canReadAudit = context.ok && context.value.permissions.has("audit.read");

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">{row.name}</h1>
            <Badge variant={row.is_active ? "default" : "outline"}>
              {row.is_active ? t("active") : t("inactive")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text-secondary" data-numeric>
            {row.code}
          </p>
        </div>

        {canManage ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/referentiel/${obligationId}/modifier`}>
              <Pencil aria-hidden="true" className="size-4" />
              {t("edit")}
            </Link>
          </Button>
        ) : null}
      </div>

      <ObligationDetailTabs
        holidays={options.ok ? options.value.holidays : []}
        detail={{
          id: row.id,
          code: row.code,
          name: row.name,
          domainLabel: detail.value.domain?.label ?? null,
          authorityName: detail.value.authority?.name ?? null,
          authorityPortalUrl: detail.value.authority?.portal_url ?? null,
          periodicity: row.periodicity,
          criticality: row.criticality,
          internalLeadDays: row.internal_lead_days,
          legalBasis: row.legal_basis,
          portalUrl: row.portal_url,
          procedureMd: row.procedure_md,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          isActive: row.is_active,
          requiresValidation: row.requires_validation,
          requiresProof: row.requires_proof,
          defaultOwnerName: detail.value.defaultOwnerName,
          defaultValidatorName: detail.value.defaultValidatorName,
          dueRule: row.due_rule,
          dependsOn:
            detail.value.dependsOn === null
              ? null
              : {
                  id: detail.value.dependsOn.id,
                  code: detail.value.dependsOn.code,
                  name: detail.value.dependsOn.name,
                  isActive: detail.value.dependsOn.is_active,
                },
          requiredDocuments: detail.value.requiredDocuments.map((document) => ({
            id: document.id,
            label: document.label,
            description: document.description,
            isMandatory: document.is_mandatory,
            kind: document.document_kind,
            maxSizeMb: document.max_size_mb,
          })),
          occurrences: occurrences.ok
            ? occurrences.value.map((occurrence) => ({
                id: occurrence.id,
                periodKey: occurrence.period_key,
                status: occurrence.status,
                legalDueDate: occurrence.legal_due_date,
              }))
            : [],
          auditEntries: audit.ok
            ? audit.value.map((entry) => ({
                id: entry.id,
                action: entry.action,
                actorEmail: entry.actorEmail,
                changedFields: entry.changedFields,
                occurredAt: entry.occurredAt,
              }))
            : [],
          canReadAudit,
        }}
      />
    </>
  );
}
