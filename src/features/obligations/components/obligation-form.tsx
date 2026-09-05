"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CRITICALITIES, PERIODICITIES, type Periodicity } from "@/config/constants";
import { createObligationAction, updateObligationAction } from "@/features/obligations/actions";
import { DueRuleEditor } from "@/features/obligations/components/due-rule-editor";
import { DueRulePreview } from "@/features/obligations/components/due-rule-preview";
import { MarkdownEditor } from "@/features/obligations/components/markdown-editor";
import { RecalculationDialog } from "@/features/obligations/components/recalculation-dialog";
import { RequiredDocumentsEditor } from "@/features/obligations/components/required-documents-editor";
import { useRouter } from "@/i18n/navigation";
import {
  CreateObligationTypeSchema,
  UpdateObligationTypeSchema,
  type CreateObligationTypeInput,
} from "@/services/obligations/schema";
import { defaultDueRule } from "@/services/scheduling";
import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * Formulaire du référentiel : création et modification.
 *
 * `react-hook-form` + `zodResolver`, sur le MÊME schéma que la Server Action.
 * Le client valide pour afficher l'erreur sans aller-retour ; le serveur
 * revalide parce qu'il ne fait aucune confiance au client.
 *
 * ⚠️ Aucun branchement sur un code d'obligation. Ce formulaire ne sait pas ce
 * qu'est un G50 : il édite des champs (cf. CLAUDE.md §3.5).
 */

export interface ObligationFormOptionsView {
  readonly domains: readonly { readonly id: string; readonly label: string }[];
  readonly authorities: readonly { readonly id: string; readonly name: string }[];
  readonly obligations: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  }[];
  readonly holidays: readonly string[];
}

const NONE = "__none__";

export function ObligationForm({
  mode,
  options,
  defaultValues,
  obligationId,
  originalRule,
}: {
  readonly mode: "create" | "edit";
  readonly options: ObligationFormOptionsView;
  readonly defaultValues: CreateObligationTypeInput;
  readonly obligationId?: string | undefined;
  /** Règle enregistrée, pour détecter si la modification en change une. */
  readonly originalRule?: unknown;
}) {
  const t = useTranslations("obligations");
  const tCommon = useTranslations("common.actions");
  const router = useRouter();

  const [pending, run] = useActionRunner();
  const [recalculationOpen, setRecalculationOpen] = useState(false);

  const schema = mode === "create" ? CreateObligationTypeSchema : UpdateObligationTypeSchema;

  const form = useForm<CreateObligationTypeInput>({
    // Le résolveur typé explicitement : les deux schémas diffèrent par `id`, et
    // l'inférence retombe sinon sur leur intersection.
    resolver: zodResolver(schema) as Resolver<CreateObligationTypeInput>,
    defaultValues,
    mode: "onBlur",
  });

  const periodicity = form.watch("periodicity");
  const dueRule = form.watch("due_rule");
  const leadDays = form.watch("internal_lead_days") ?? 0;

  function submit(values: CreateObligationTypeInput): void {
    run(async () => {
      const outcome =
        mode === "create"
          ? await createObligationAction(values)
          : await updateObligationAction({ ...values, id: obligationId });

      if (outcome.status === "error") {
        toast.error(t(`errors.${outcome.error.code}`, { fallback: outcome.error.message }));
        return;
      }

      toast.success(mode === "create" ? t("created") : t("updated"));

      /*
       * Le recalcul n'est proposé QU'APRÈS un enregistrement réussi, et
       * seulement si la règle a changé. Le proposer avant reviendrait à
       * demander de confirmer le déplacement d'échéances qui n'existent pas
       * encore ; le proposer systématiquement en ferait un clic réflexe.
       */
      const ruleChanged =
        mode === "edit" && JSON.stringify(values.due_rule) !== JSON.stringify(originalRule);

      if (ruleChanged && obligationId !== undefined) {
        setRecalculationOpen(true);
        return;
      }

      router.push(`/referentiel/${outcome.data.id}`);
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
        className="space-y-6"
      >
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
            <TabsTrigger value="rule">{t("tabs.rule")}</TabsTrigger>
            <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
          </TabsList>

          {/* ── Général ───────────────────────────────────────────────────── */}
          <TabsContent value="general" className="space-y-5 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("code")}</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="off" />
                    </FormControl>
                    <FormDescription>{t("codeHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("name")}</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <NullableSelect
                control={form.control}
                name="domain_id"
                label={t("domain")}
                placeholder={t("unset")}
                items={options.domains.map((domain) => ({
                  value: domain.id,
                  label: domain.label,
                }))}
              />

              <NullableSelect
                control={form.control}
                name="authority_id"
                label={t("authority")}
                placeholder={t("unset")}
                items={options.authorities.map((authority) => ({
                  value: authority.id,
                  label: authority.name,
                }))}
              />

              <FormField
                control={form.control}
                name="criticality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("criticalityColumn")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CRITICALITIES.map((level) => (
                          <SelectItem key={level} value={level}>
                            {t(`criticality.${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="internal_lead_days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("internalLeadDays")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={field.value ?? 0}
                        onChange={(event) => {
                          field.onChange(Number.parseInt(event.target.value, 10) || 0);
                        }}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormDescription>{t("internalLeadDaysHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="effective_from"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("effectiveFrom")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="effective_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("effectiveTo")}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ?? ""}
                        onChange={(event) => {
                          field.onChange(event.target.value === "" ? null : event.target.value);
                        }}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormDescription>{t("effectiveToHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="legal_basis"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t("legalBasis")}</FormLabel>
                    <FormControl>
                      <Input
                        value={field.value ?? ""}
                        onChange={(event) => {
                          field.onChange(event.target.value === "" ? null : event.target.value);
                        }}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="portal_url"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t("portalUrl")}</FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        inputMode="url"
                        value={field.value ?? ""}
                        onChange={(event) => {
                          field.onChange(event.target.value === "" ? null : event.target.value);
                        }}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <NullableSelect
                control={form.control}
                name="depends_on_obligation_type_id"
                label={t("dependsOn")}
                placeholder={t("unset")}
                description={t("dependsOnHint")}
                items={options.obligations
                  .filter((candidate) => candidate.id !== obligationId)
                  .map((candidate) => ({
                    value: candidate.id,
                    label: `${candidate.code} — ${candidate.name}`,
                  }))}
              />
            </div>

            <FormField
              control={form.control}
              name="procedure_md"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="procedure-md">{t("procedureLabel")}</FormLabel>
                  <MarkdownEditor
                    id="procedure-md"
                    label={t("procedureLabel")}
                    value={field.value ?? ""}
                    onChange={(next) => {
                      field.onChange(next === "" ? null : next);
                    }}
                    onBlur={field.onBlur}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-wrap gap-4">
              <BooleanField
                control={form.control}
                name="requires_validation"
                label={t("requiresValidation")}
              />
              <BooleanField
                control={form.control}
                name="requires_proof"
                label={t("requiresProof")}
              />
              <BooleanField
                control={form.control}
                name="allow_self_validation"
                label={t("allowSelfValidation")}
              />
            </div>
          </TabsContent>

          {/* ── Règle d'échéance ──────────────────────────────────────────── */}
          <TabsContent value="rule" className="space-y-5 pt-4">
            <FormField
              control={form.control}
              name="periodicity"
              render={({ field }) => (
                <FormItem className="max-w-sm">
                  <FormLabel>{t("periodicityColumn")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(next) => {
                      field.onChange(next);
                      // Changer de périodicité rend souvent l'ancre incohérente
                      // (FIXED_DATE en mensuel, PERIOD_END en ON_EVENT). On
                      // repart d'une règle valide plutôt que d'afficher une erreur.
                      form.setValue("due_rule", defaultDueRule(next as Periodicity), {
                        shouldValidate: true,
                      });
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PERIODICITIES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`periodicity.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="due_rule"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("rule.title")}</FormLabel>
                  <DueRuleEditor
                    value={field.value}
                    periodicity={periodicity}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <DueRulePreview
              rule={dueRule}
              periodicity={periodicity}
              holidays={options.holidays}
              internalLeadDays={typeof leadDays === "number" ? leadDays : 0}
            />
          </TabsContent>

          {/* ── Pièces requises ───────────────────────────────────────────── */}
          <TabsContent value="documents" className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="required_documents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("documents.title")}</FormLabel>
                  <FormDescription>{t("documents.hint")}</FormDescription>
                  <RequiredDocumentsEditor value={field.value ?? []} onChange={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? tCommon("save") : tCommon("save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              router.back();
            }}
          >
            {tCommon("cancel")}
          </Button>
        </div>
      </form>

      {obligationId === undefined ? null : (
        <RecalculationDialog
          obligationId={obligationId}
          rule={dueRule}
          periodicity={periodicity}
          open={recalculationOpen}
          onOpenChange={setRecalculationOpen}
          onApplied={(updated) => {
            toast.success(t("recalculation.done", { count: updated }));
            router.push(`/referentiel/${obligationId}`);
          }}
        />
      )}
    </Form>
  );
}

// ─── Champs réutilisés ───────────────────────────────────────────────────────

/**
 * Select dont la valeur peut être nulle.
 *
 * Radix refuse une `SelectItem` de valeur vide : elle est réservée à l'état
 * « rien de sélectionné ». On passe donc par une valeur sentinelle traduite en
 * `null` à la sortie, plutôt que de laisser une chaîne vide atteindre la base.
 */
function NullableSelect({
  control,
  name,
  label,
  placeholder,
  description,
  items,
}: {
  readonly control: ReturnType<typeof useForm<CreateObligationTypeInput>>["control"];
  readonly name: "domain_id" | "authority_id" | "depends_on_obligation_type_id";
  readonly label: string;
  readonly placeholder: string;
  readonly description?: string;
  readonly items: readonly { readonly value: string; readonly label: string }[];
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value ?? NONE}
            onValueChange={(next) => {
              field.onChange(next === NONE ? null : next);
            }}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={NONE}>{placeholder}</SelectItem>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description === undefined ? null : <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function BooleanField({
  control,
  name,
  label,
}: {
  readonly control: ReturnType<typeof useForm<CreateObligationTypeInput>>["control"];
  readonly name: "requires_validation" | "requires_proof" | "allow_self_validation";
  readonly label: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center gap-2 space-y-0">
          <FormControl>
            <Checkbox
              checked={field.value === true}
              onCheckedChange={(checked) => {
                field.onChange(checked === true);
              }}
            />
          </FormControl>
          <FormLabel className="font-normal">{label}</FormLabel>
        </FormItem>
      )}
    />
  );
}
