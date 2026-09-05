"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createRegisterAction, updateRegisterAction } from "@/features/registers/actions";
import { useRouter } from "@/i18n/navigation";
import { useActionRunner } from "@/hooks/use-action-runner";
import {
  REGISTER_STATUSES,
  REGISTER_TYPES,
  RegisterSchema,
  type RegisterInput,
} from "@/services/registers/schema";

/**
 * Formulaire d'un registre de commerce.
 *
 * ⚠️ LE MÊME SCHÉMA ZOD qu'au serveur, par le résolveur. Une validation écrite
 * deux fois diverge, et c'est toujours la version cliente qui devient la plus
 * permissive — celle qu'on assouplit pour débloquer une saisie.
 *
 * ⚠️ AUCUN BOUTON DE SUPPRESSION, et un mot le dit à l'écran plutôt que de
 * laisser chercher. Un registre se radie ; son historique doit rester lisible.
 */

export function RegisterForm({
  registerId,
  defaultValues,
}: {
  readonly registerId?: string;
  readonly defaultValues: RegisterInput;
}) {
  const t = useTranslations("registers.form");
  const tType = useTranslations("registers.type");
  const tStatus = useTranslations("registers.status");
  const router = useRouter();
  const [pending, run] = useActionRunner();

  /*
   * ⚠️ RÉSOLVEUR TYPÉ EXPLICITEMENT. Le schéma porte des `.default()` et un
   * `.transform()` : son type d'ENTRÉE tolère l'absence de plusieurs champs, son
   * type de SORTIE ne la tolère plus. L'inférence retombe alors sur leur
   * intersection, et `exactOptionalPropertyTypes` refuse le rapprochement.
   */
  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema) as Resolver<RegisterInput>,
    defaultValues,
    mode: "onBlur",
  });

  const errorOf = (field: keyof RegisterInput): string | undefined => {
    const message = form.formState.errors[field]?.message;
    return typeof message === "string" ? message : undefined;
  };

  function onSubmit(values: RegisterInput): void {
    run(async () => {
      const outcome =
        registerId === undefined
          ? await createRegisterAction(values)
          : await updateRegisterAction(registerId, values);

      if (outcome.status === "success") {
        toast.success(registerId === undefined ? t("created") : t("updated"));
        router.push(`/registres/${outcome.id ?? registerId ?? ""}`);
        return;
      }
      // Le message vient de la clé i18n portée par l'erreur : aucun texte
      // rédigé ne traverse la frontière serveur/client.
      toast.error(outcome.error?.message ?? "errors.internal");
    });
  }

  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit(onSubmit)(event);
      }}
      className="max-w-3xl space-y-6"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="rc_number">{t("rcNumber")}</Label>
          <Input id="rc_number" {...form.register("rc_number")} className="mt-1 tabular-nums" />
          <p className="mt-1 text-xs text-text-muted">{t("rcNumberHint")}</p>
          {errorOf("rc_number") === undefined ? null : (
            <p className="text-danger mt-1 text-xs">{errorOf("rc_number")}</p>
          )}
        </div>

        <div>
          <Label htmlFor="register_type">{t("type")}</Label>
          <Select
            value={form.watch("register_type")}
            onValueChange={(value) => {
              form.setValue("register_type", value as RegisterInput["register_type"], {
                shouldDirty: true,
              });
            }}
          >
            <SelectTrigger id="register_type" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGISTER_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {tType(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="status">{t("status")}</Label>
          <Select
            value={form.watch("status")}
            onValueChange={(value) => {
              form.setValue("status", value as RegisterInput["status"], { shouldDirty: true });
            }}
          >
            <SelectTrigger id="status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGISTER_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {tStatus(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="label">{t("label")}</Label>
          <Input id="label" {...form.register("label")} className="mt-1" />
          {errorOf("label") === undefined ? null : (
            <p className="text-danger mt-1 text-xs">{errorOf("label")}</p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="activity_label">{t("activityLabel")}</Label>
          <Input id="activity_label" {...form.register("activity_label")} className="mt-1" />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="address">{t("address")}</Label>
          <Input id="address" {...form.register("address")} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="wilaya">{t("wilaya")}</Label>
          <Input id="wilaya" {...form.register("wilaya")} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="commune">{t("commune")}</Label>
          <Input id="commune" {...form.register("commune")} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="issued_at">{t("issuedAt")}</Label>
          <Input id="issued_at" type="date" {...form.register("issued_at")} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="expires_at">{t("expiresAt")}</Label>
          <Input id="expires_at" type="date" {...form.register("expires_at")} className="mt-1" />
          {errorOf("expires_at") === undefined ? null : (
            <p className="text-danger mt-1 text-xs">{errorOf("expires_at")}</p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="notes">{t("notes")}</Label>
          <Textarea id="notes" rows={3} {...form.register("notes")} className="mt-1" />
        </div>
      </div>

      <p className="text-xs text-text-muted">{t("noDelete")}</p>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            router.back();
          }}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
