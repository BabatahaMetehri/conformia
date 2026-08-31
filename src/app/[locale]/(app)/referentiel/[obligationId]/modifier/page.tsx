import { notFound } from "next/navigation";

import { SectionHeader } from "@/components/layout/section";
import { ObligationForm } from "@/features/obligations/components/obligation-form";
import { requireSectionAccess } from "@/services/navigation/guard";
import {
  currentUserCanManageReferential,
  getFormOptions,
  getObligation,
} from "@/services/obligations";
import type { DueRuleInput } from "@/services/scheduling";

/**
 * Modification d'une obligation.
 *
 * ⚠️ DEUX niveaux de contrôle, et le second est celui qui protège. Le bouton
 * « Modifier » n'apparaît qu'avec `referential.manage` ; cette page rend
 * « introuvable » sans lui ; et la Server Action refuse de toute façon. Un
 * utilisateur qui tape l'URL n'obtient donc pas un formulaire inutilisable, il
 * n'obtient pas de formulaire du tout.
 */
export default async function Page({ params }: { params: Promise<{ obligationId: string }> }) {
  await requireSectionAccess("/referentiel");

  const canManage = await currentUserCanManageReferential();
  if (!canManage) notFound();

  const { obligationId } = await params;

  const [detail, options] = await Promise.all([getObligation(obligationId), getFormOptions()]);
  if (!detail.ok || !options.ok) notFound();

  const row = detail.value.obligationType;

  return (
    <>
      <SectionHeader titleKey="obligationEdit" descriptionKey="obligationEdit" />

      <ObligationForm
        mode="edit"
        obligationId={obligationId}
        // Règle enregistrée : le formulaire s'en sert pour savoir si la
        // modification en change une, et donc s'il faut proposer le recalcul.
        originalRule={row.due_rule}
        options={{
          domains: options.value.domains.map((domain) => ({
            id: domain.id,
            label: domain.label,
          })),
          authorities: options.value.authorities.map((authority) => ({
            id: authority.id,
            name: authority.name,
          })),
          obligations: options.value.obligations,
          holidays: options.value.holidays,
        }}
        defaultValues={{
          code: row.code,
          name: row.name,
          domain_id: row.domain_id,
          authority_id: row.authority_id,
          periodicity: row.periodicity,
          due_rule: row.due_rule as DueRuleInput,
          internal_lead_days: row.internal_lead_days,
          procedure_md: row.procedure_md,
          legal_basis: row.legal_basis,
          portal_url: row.portal_url,
          default_owner_id: row.default_owner_id,
          default_validator_id: row.default_validator_id,
          criticality: row.criticality,
          requires_validation: row.requires_validation,
          validation_levels: row.validation_levels,
          requires_proof: row.requires_proof,
          allow_self_validation: row.allow_self_validation,
          depends_on_obligation_type_id: row.depends_on_obligation_type_id,
          generation_horizon_months: row.generation_horizon_months,
          retention_years: row.retention_years,
          effective_from: row.effective_from,
          effective_to: row.effective_to,
          required_documents: detail.value.requiredDocuments.map((document) => ({
            id: document.id,
            label: document.label,
            description: document.description,
            is_mandatory: document.is_mandatory,
            document_kind: document.document_kind as never,
            max_size_mb: document.max_size_mb,
          })),
        }}
      />
    </>
  );
}
