import { notFound } from "next/navigation";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { Criticality, DueAnchor, Periodicity } from "@/config/constants";
import { ObligationForm } from "@/features/obligations/components/obligation-form";
import { formatISODateInAppTz } from "@/lib/dates";
import { currentUserCanManageReferential, getFormOptions } from "@/services/obligations";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Création d'une obligation.
 *
 * ⚠️ La garde de permission est ICI, pas seulement sur le bouton qui mène à
 * cette page. Sans `referential.manage`, l'URL saisie à la main rend
 * « introuvable » — pas un formulaire qui échouera à l'enregistrement.
 */
export default async function Page() {
  await requireSectionAccess("/referentiel");

  const canManage = await currentUserCanManageReferential();
  if (!canManage) notFound();

  const options = await getFormOptions();
  if (!options.ok) {
    return (
      <>
        <SectionHeader titleKey="obligations" />
        <ErrorState title="—" />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="obligationCreate" descriptionKey="obligationCreate" />

      <ObligationForm
        mode="create"
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
          code: "",
          name: "",
          domain_id: null,
          authority_id: null,
          periodicity: Periodicity.MONTHLY,
          // Règle DÉJÀ VALIDE : un formulaire qui s'ouvre en erreur apprend à
          // l'utilisateur à ignorer les messages d'erreur.
          due_rule: { anchor: DueAnchor.PERIOD_END, offset_days: 20 },
          internal_lead_days: 0,
          procedure_md: null,
          legal_basis: null,
          portal_url: null,
          default_owner_id: null,
          default_validator_id: null,
          criticality: Criticality.MEDIUM,
          requires_validation: true,
          validation_levels: 1,
          requires_proof: true,
          allow_self_validation: false,
          depends_on_obligation_type_id: null,
          generation_horizon_months: 18,
          retention_years: 10,
          effective_from: formatISODateInAppTz(),
          effective_to: null,
          required_documents: [],
        }}
      />
    </>
  );
}
