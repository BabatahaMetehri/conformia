import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { UsersView } from "@/features/admin/components/users-view";
import { requireAuthContext } from "@/services/auth/context";
import { getInvitations, getReferentials, getRoleMatrix, getUsers } from "@/services/admin";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Comptes et habilitations.
 *
 * ⚠️ La matrice des rôles est lue ICI uniquement pour connaître les bornes
 * d'expiration (`max_duration_days`) : c'est elle qui décide si le formulaire
 * exige une date de fin, et non une liste de codes écrite dans l'écran.
 */
export default async function Page() {
  await requireSectionAccess("/admin/users");

  const t = await getTranslations("admin.users");
  const [context, users, invitations, matrix, referentials] = await Promise.all([
    requireAuthContext(),
    getUsers(),
    getInvitations(),
    getRoleMatrix(),
    getReferentials(),
  ]);

  if (!context.ok || !users.ok) {
    return (
      <>
        <SectionHeader titleKey="adminUsers" descriptionKey="adminUsers" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="adminUsers" descriptionKey="adminUsers" />
      <UsersView
        users={users.value}
        invitations={invitations.ok ? invitations.value : []}
        roles={
          matrix.ok
            ? matrix.value.roles.map((role) => ({
                id: role.id,
                label: role.label,
                maxDurationDays: role.maxDurationDays,
              }))
            : []
        }
        domains={
          referentials.ok
            ? referentials.value.domains.map((row) => ({ id: row.id, label: row.name }))
            : []
        }
        departments={
          referentials.ok
            ? referentials.value.departments.map((row) => ({ id: row.id, label: row.name }))
            : []
        }
        currentUserId={context.value.userId}
      />
    </>
  );
}
