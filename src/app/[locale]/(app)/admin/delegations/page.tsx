import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { DelegationsView } from "@/features/workflow";
import { requireAuthContext, requirePermission } from "@/services/auth/context";
import { getDelegationFormOptions, listAllDelegations } from "@/services/workflow/delegations";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Délégations de validation.
 *
 * ⚠️ Déléguer POUR AUTRUI est réservé à qui administre les utilisateurs ; chacun
 * peut déléguer ses propres droits. La distinction est appliquée par la
 * politique d'insertion de 0002 — le formulaire ne fait qu'éviter de proposer un
 * geste qui serait refusé.
 */
export default async function Page() {
  await requireSectionAccess("/admin/delegations");

  const t = await getTranslations("workflow.delegations");

  const [context, delegations, options, canDelegateForOthers] = await Promise.all([
    requireAuthContext(),
    listAllDelegations(),
    getDelegationFormOptions(),
    requirePermission("user.manage"),
  ]);

  if (!context.ok || !delegations.ok) {
    return (
      <>
        <SectionHeader titleKey="adminDelegations" descriptionKey="adminDelegations" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminDelegations" descriptionKey="adminDelegations" />
      <DelegationsView
        delegations={delegations.value}
        people={options.ok ? options.value.people : []}
        domains={options.ok ? options.value.domains : []}
        currentUserId={context.value.userId}
        canDelegateForOthers={canDelegateForOthers.ok}
      />
    </>
  );
}
