import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { RegisterForm } from "@/features/registers/components/register-form";
import { requireSectionAccess } from "@/services/navigation/guard";
import { currentUserCanManageRegisters, getCommercialRegister } from "@/services/registers";

/** Modification d'un registre. Réservée à `register.manage`. */
export default async function Page({
  params,
}: {
  params: Promise<{ readonly registerId: string }>;
}) {
  await requireSectionAccess("/registres");
  if (!(await currentUserCanManageRegisters())) notFound();

  const { registerId } = await params;
  const [register, t] = await Promise.all([
    getCommercialRegister(registerId),
    getTranslations("registers"),
  ]);

  if (!register.ok) notFound();

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-text-primary">
        {t("edit")} — <span className="tabular-nums">{register.value.rcNumber}</span>
      </h1>
      <RegisterForm
        registerId={registerId}
        defaultValues={{
          rc_number: register.value.rcNumber,
          register_type: register.value.registerType,
          label: register.value.label,
          activity_label: register.value.activityLabel,
          activity_codes: [...register.value.activityCodes],
          address: register.value.address,
          wilaya: register.value.wilaya,
          commune: register.value.commune,
          issued_at: register.value.issuedAt,
          expires_at: register.value.expiresAt,
          status: register.value.status,
          notes: register.value.notes,
        }}
      />
    </>
  );
}
