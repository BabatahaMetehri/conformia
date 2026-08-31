"use client";

import { ExternalLink, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Markdown } from "@/components/shared/markdown";
import { EmptyState } from "@/components/shared/states";
import {
  CriticalityIndicator,
  PeriodicityBadge,
  StatusBadge,
} from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Criticality, OccurrenceStatus, Periodicity } from "@/config/constants";
import { DueRulePreview } from "@/features/obligations/components/due-rule-preview";
import {
  ObligationHistory,
  type ObligationHistoryEntry,
} from "@/features/obligations/components/obligation-history";
import { Link } from "@/i18n/navigation";
import { formatDateFr } from "@/lib/dates";

/**
 * Fiche d'une obligation, en cinq onglets.
 *
 * L'onglet « Règle d'échéance » porte la MÊME prévisualisation que le
 * formulaire : la fiche n'affiche pas une règle, elle montre ce qu'elle produit.
 * Lire `{"anchor":"PERIOD_END","offset_days":20}` ne dit rien à personne ; voir
 * six dates dit tout.
 */

export interface ObligationDetailView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly domainLabel: string | null;
  readonly authorityName: string | null;
  readonly authorityPortalUrl: string | null;
  readonly periodicity: Periodicity;
  readonly criticality: Criticality;
  readonly internalLeadDays: number;
  readonly legalBasis: string | null;
  readonly portalUrl: string | null;
  readonly procedureMd: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly isActive: boolean;
  readonly requiresValidation: boolean;
  readonly requiresProof: boolean;
  readonly defaultOwnerName: string | null;
  readonly defaultValidatorName: string | null;
  readonly dueRule: unknown;
  readonly dependsOn: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly isActive: boolean;
  } | null;
  readonly requiredDocuments: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string | null;
    readonly isMandatory: boolean;
    readonly kind: string | null;
    readonly maxSizeMb: number;
  }[];
  readonly occurrences: readonly {
    readonly id: string;
    readonly periodKey: string;
    readonly status: OccurrenceStatus;
    readonly legalDueDate: string;
  }[];
  readonly auditEntries: readonly ObligationHistoryEntry[];
  readonly canReadAudit: boolean;
}

export function ObligationDetailTabs({
  detail,
  holidays,
}: {
  readonly detail: ObligationDetailView;
  readonly holidays: readonly string[];
}) {
  const t = useTranslations("obligations");

  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
        <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
        <TabsTrigger value="rule">{t("tabs.rule")}</TabsTrigger>
        <TabsTrigger value="occurrences">{t("tabs.occurrences")}</TabsTrigger>
        <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
      </TabsList>

      {/* ── Général ─────────────────────────────────────────────────────── */}
      <TabsContent value="general" className="space-y-6 pt-4">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("domain")} value={detail.domainLabel} />
          <Field label={t("authority")} value={detail.authorityName} />
          <Field label={t("periodicityColumn")}>
            <PeriodicityBadge periodicity={detail.periodicity} />
          </Field>
          <Field label={t("criticalityColumn")}>
            <CriticalityIndicator criticality={detail.criticality} />
          </Field>
          <Field label={t("defaultOwner")} value={detail.defaultOwnerName} />
          <Field label={t("defaultValidator")} value={detail.defaultValidatorName} />
          <Field label={t("internalLeadDays")} value={String(detail.internalLeadDays)} />
          <Field
            label={t("effectiveFrom")}
            value={formatDateFr(new Date(`${detail.effectiveFrom}T12:00:00Z`))}
          />
          <Field
            label={t("effectiveTo")}
            value={
              detail.effectiveTo === null
                ? null
                : formatDateFr(new Date(`${detail.effectiveTo}T12:00:00Z`))
            }
          />
          <Field label={t("legalBasis")} value={detail.legalBasis} className="sm:col-span-2" />

          {detail.portalUrl === null ? null : (
            <Field label={t("portalUrl")}>
              <a
                href={detail.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-2"
              >
                {t("openPortal")}
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            </Field>
          )}

          {detail.dependsOn === null ? null : (
            <Field label={t("dependsOn")}>
              <Link
                href={`/referentiel/${detail.dependsOn.id}`}
                className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-2"
              >
                <Link2 aria-hidden="true" className="size-3.5" />
                {detail.dependsOn.code} — {detail.dependsOn.name}
              </Link>
              {detail.dependsOn.isActive ? null : (
                <Badge variant="outline" className="ms-2 text-2xs">
                  {t("inactive")}
                </Badge>
              )}
            </Field>
          )}
        </dl>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-primary">{t("procedureLabel")}</h2>
          {detail.procedureMd === null || detail.procedureMd.trim().length === 0 ? (
            <p className="text-sm text-text-muted">{t("noProcedure")}</p>
          ) : (
            <div className="rounded-lg border border-border bg-surface p-4">
              <Markdown source={detail.procedureMd} />
            </div>
          )}
        </section>
      </TabsContent>

      {/* ── Pièces requises ─────────────────────────────────────────────── */}
      <TabsContent value="documents" className="pt-4">
        {detail.requiredDocuments.length === 0 ? (
          <EmptyState title={t("documents.emptyDetail")} />
        ) : (
          <ol className="space-y-2">
            {detail.requiredDocuments.map((document, index) => (
              <li
                key={document.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <span
                  aria-hidden="true"
                  data-numeric
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-medium text-text-secondary"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{document.label}</p>
                  {document.description === null ? null : (
                    <p className="mt-0.5 text-sm text-text-muted">{document.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant={document.isMandatory ? "default" : "outline"}>
                      {document.isMandatory ? t("documents.required") : t("documents.optional")}
                    </Badge>
                    {document.kind === null ? null : (
                      <Badge variant="secondary">{document.kind}</Badge>
                    )}
                    <Badge variant="outline">
                      {t("documents.maxSizeValue", { mb: document.maxSizeMb })}
                    </Badge>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </TabsContent>

      {/* ── Règle d'échéance ────────────────────────────────────────────── */}
      <TabsContent value="rule" className="pt-4">
        <DueRulePreview
          rule={detail.dueRule}
          periodicity={detail.periodicity}
          holidays={holidays}
          internalLeadDays={detail.internalLeadDays}
        />
      </TabsContent>

      {/* ── Occurrences ─────────────────────────────────────────────────── */}
      <TabsContent value="occurrences" className="pt-4">
        {detail.occurrences.length === 0 ? (
          // « Aucune VISIBLE » : la RLS cloisonne par domaine, l'absence
          // d'affichage ne prouve pas l'absence de dossier.
          <EmptyState title={t("noOccurrences")} description={t("noOccurrencesHint")} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("occurrencesCaption")}</caption>
              <thead className="bg-surface-raised text-xs text-text-secondary">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("period")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("status")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t("legalDueDate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.occurrences.map((occurrence) => (
                  <tr key={occurrence.id} className="border-t border-border">
                    <td className="px-3 py-2" data-numeric>
                      <Link
                        href={`/occurrences/${occurrence.id}`}
                        className="font-medium text-text-primary underline-offset-2 hover:underline"
                      >
                        {occurrence.periodKey}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={occurrence.status} />
                    </td>
                    <td className="px-3 py-2 text-text-secondary" data-numeric>
                      {formatDateFr(new Date(`${occurrence.legalDueDate}T12:00:00Z`))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>

      {/* ── Historique ──────────────────────────────────────────────────── */}
      <TabsContent value="history" className="pt-4">
        <ObligationHistory entries={detail.auditEntries} canReadAudit={detail.canReadAudit} />
      </TabsContent>
    </Tabs>
  );
}

function Field({
  label,
  value,
  children,
  className,
}: {
  readonly label: string;
  readonly value?: string | null;
  readonly children?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-primary">
        {children ?? (value === null || value === undefined || value.length === 0 ? "—" : value)}
      </dd>
    </div>
  );
}
