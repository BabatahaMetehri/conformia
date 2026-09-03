import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { RegisterForm } from "@/features/registers/components/register-form";
import { requireSectionAccess } from "@/services/navigation/guard";
import { currentUserCanManageRegisters } from "@/services/registers";

/** Création d'un registre de commerce. Réservée à `register.manage`. */
export default async function Page() {
  await requireSectionAccess("/registres");

  // ⚠️ `notFound()` plutôt qu'un écran de refus : la même règle que partout, une
  // page interdite est indistinguable d'une page inexistante.
  if (!(await currentUserCanManageRegisters())) notFound();

  const t = await getTranslations("registers");

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold tracking-tight text-text-primary">{t("new")}</h1>
      <RegisterForm
        defaultValues={{
          rc_number: "",
          register_type: "SECONDAIRE",
          label: "",
          activity_label: null,
          activity_codes: [],
          address: null,
          wilaya: null,
          commune: null,
          issued_at: null,
          expires_at: null,
          status: "ACTIF",
          notes: null,
        }}
      />
    </>
  );
}
