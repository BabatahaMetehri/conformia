"use client";

import { AlertTriangle, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OccurrenceStatus } from "@/config/constants";
import type { OccurrenceListRow, RegisterRow, RegisterTimelineEntry } from "@/services/registers";
import { Link } from "@/i18n/navigation";
import { formatDateFr, formatDateTimeFr } from "@/lib/dates";

/**
 * Fiche d'un registre, en cinq onglets.
 *
 * ⚠️ L'ONGLET « HISTORIQUE COMPLET » EST LA RAISON D'ÊTRE DE CET ÉCRAN. Un
 * établissement se juge sur ce qu'il a déposé au fil des années, pas sur la
 * période en cours : c'est ce que demande un contrôle, et c'est ce qu'un
 * échéancier centré sur le mois ne montre jamais.
 *
 * ⚠️ UN REGISTRE RADIÉ GARDE TOUT. La radiation arrête la génération à venir ;
 * elle ne réécrit pas le passé. C'est précisément quand un établissement ferme
 * qu'on a besoin de prouver ce qu'il a déclaré.
 */

export interface RegisterObligationSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly periodicity: string;
  readonly isActive: boolean;
}

export interface RegisterDocumentSummary {
  readonly id: string;
  readonly filename: string;
  readonly occurrenceId: string;
  readonly obligationName: string;
  readonly periodKey: string;
  readonly uploadedAt: string;
  readonly uploaderName: string | null;
}

/**
 * Une date de calendrier (`2026-01-15`) formatée à l'heure d'Alger.
 *
 * ⚠️ MIDI UTC, ET C'EST PORTANT. `new Date("2026-01-15")` vaut minuit UTC :
 * converti en heure d'Alger (UTC+1) il reste le 15, mais la même conversion
 * dans l'autre sens — ou un fuseau négatif — ferait afficher le 14. Midi place
 * l'instant assez loin des deux bornes pour qu'aucun décalage de fuseau ne
 * change le jour.
 */
function calendarDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-text-primary">{children}</dd>
    </div>
  );
}

export function RegisterDetailTabs({
  register,
  obligations,
  history,
  documents,
  timeline,
}: {
  readonly register: RegisterRow;
  readonly obligations: readonly RegisterObligationSummary[];
  readonly history: readonly OccurrenceListRow[];
  readonly documents: readonly RegisterDocumentSummary[];
  readonly timeline: readonly RegisterTimelineEntry[];
}) {
  const t = useTranslations("registers");
  const tType = useTranslations("registers.type");
  const tStatus = useTranslations("registers.status");
  const dash = t("general.none");

  return (
    <Tabs defaultValue="general" className="mt-6">
      <TabsList>
        <TabsTrigger value="general">{t("tabs.general")}</TabsTrigger>
        <TabsTrigger value="obligations">{t("tabs.obligations")}</TabsTrigger>
        <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
        <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
        <TabsTrigger value="timeline">{t("tabs.timeline")}</TabsTrigger>
      </TabsList>

      {/* ── Général ────────────────────────────────────────────────────────── */}
      <TabsContent value="general" className="mt-6 space-y-8">
        {register.status === "RADIE" ? (
          <div className="bg-surface-muted flex gap-3 rounded-lg border border-border p-4">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-muted" />
            <div>
              <p className="font-medium text-text-primary">{t("radiated.title")}</p>
              <p className="mt-1 text-sm text-text-secondary">{t("radiated.body")}</p>
            </div>
          </div>
        ) : null}

        <section>
          <h2 className="text-sm font-semibold text-text-primary">{t("general.identity")}</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("columns.rcNumber")}>
              <span className="font-medium tabular-nums">{register.rcNumber}</span>
            </Field>
            <Field label={t("columns.type")}>{tType(register.registerType)}</Field>
            <Field label={t("columns.label")}>{register.label}</Field>
            <Field label={t("columns.status")}>{tStatus(register.status)}</Field>
          </dl>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-primary">{t("general.activity")}</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={t("columns.activity")}>{register.activityLabel ?? dash}</Field>
            <Field label={t("general.activityCodes")}>
              {register.activityCodes.length === 0 ? (
                dash
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {register.activityCodes.map((code) => (
                    <Badge key={code} variant="outline" className="tabular-nums">
                      {code}
                    </Badge>
                  ))}
                </span>
              )}
            </Field>
          </dl>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-primary">{t("general.location")}</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label={t("general.address")}>{register.address ?? dash}</Field>
            <Field label={t("columns.wilaya")}>{register.wilaya ?? dash}</Field>
            <Field label={t("general.commune")}>{register.commune ?? dash}</Field>
          </dl>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-primary">{t("general.validity")}</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={t("columns.issuedAt")}>
              {register.issuedAt === null ? dash : formatDateFr(calendarDate(register.issuedAt))}
            </Field>
            <Field label={t("columns.expiresAt")}>
              {register.expiresAt === null ? (
                t("expiry.never")
              ) : (
                <span className={register.expiresSoon || register.expired ? "text-warning" : ""}>
                  {formatDateFr(calendarDate(register.expiresAt))}
                </span>
              )}
            </Field>
          </dl>
        </section>

        {register.notes === null ? null : (
          <section>
            <h2 className="text-sm font-semibold text-text-primary">{t("general.notes")}</h2>
            <p className="mt-2 text-sm whitespace-pre-line text-text-secondary">{register.notes}</p>
          </section>
        )}
      </TabsContent>

      {/* ── Obligations ────────────────────────────────────────────────────── */}
      <TabsContent value="obligations" className="mt-6">
        <p className="text-sm text-text-secondary">{t("obligations.description")}</p>
        {obligations.length === 0 ? (
          <EmptyState className="mt-4" title={t("obligations.empty")} />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.rcNumber")}</TableHead>
                  <TableHead>{t("columns.label")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {obligations.map((obligation) => (
                  <TableRow key={obligation.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/referentiel/${obligation.id}`}
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        {obligation.code}
                      </Link>
                    </TableCell>
                    <TableCell>{obligation.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      {/* ── Historique complet ─────────────────────────────────────────────── */}
      <TabsContent value="history" className="mt-6">
        <p className="text-sm text-text-secondary">{t("history.description")}</p>
        <p className="mt-1 text-xs text-text-muted">
          {t("history.count", { count: history.length })}
        </p>

        {history.length === 0 ? (
          <EmptyState className="mt-4" title={t("history.empty")} />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("history.filterObligation")}</TableHead>
                  <TableHead>{t("history.filterPeriod")}</TableHead>
                  <TableHead>{t("columns.expiresAt")}</TableHead>
                  <TableHead>{t("history.filterStatus")}</TableHead>
                  <TableHead>{t("history.owner")}</TableHead>
                  <TableHead className="text-end">{t("history.documents")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/echeancier/${row.id}`}
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        {row.obligationCode}
                      </Link>
                      <span className="ms-2 text-text-secondary">{row.obligationName}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.periodKey}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateFr(calendarDate(row.legalDueDate))}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status as OccurrenceStatus} />
                    </TableCell>
                    <TableCell>{row.ownerName ?? dash}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {row.documentsProvided}/{row.documentsRequired}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      {/* ── Documents ──────────────────────────────────────────────────────── */}
      <TabsContent value="documents" className="mt-6">
        <p className="text-sm text-text-secondary">{t("documents.description")}</p>
        {documents.length === 0 ? (
          <EmptyState className="mt-4" title={t("documents.empty")} />
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-start gap-3 p-4">
                <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/documents/${doc.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {doc.filename}
                  </Link>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {doc.obligationName} · {doc.periodKey} ·{" "}
                    {formatDateTimeFr(new Date(doc.uploadedAt))}
                    {doc.uploaderName === null ? null : ` · ${doc.uploaderName}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      {/* ── Chronologie du registre ────────────────────────────────────────── */}
      <TabsContent value="timeline" className="mt-6">
        <p className="text-sm text-text-secondary">{t("timeline.description")}</p>
        {timeline.length === 0 ? (
          <EmptyState className="mt-4" title={t("timeline.empty")} />
        ) : (
          <ol className="mt-4 space-y-4 border-s border-border ps-6">
            {timeline.map((entry, index) => (
              <li key={`${entry.occurredAt}-${String(index)}`} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -start-[1.8rem] top-1.5 size-2 rounded-full bg-border"
                />
                <p className="text-sm font-medium text-text-primary">
                  {entry.action === "INSERT" ? t("timeline.created") : t("timeline.updated")}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {formatDateTimeFr(new Date(entry.occurredAt))}
                  {entry.actorName === null ? null : ` · ${entry.actorName}`}
                </p>
                {entry.changedFields.length === 0 ? null : (
                  <p className="mt-1 text-xs text-text-secondary">
                    {t("timeline.fields")}{" "}
                    <span className="font-mono">{entry.changedFields.join(", ")}</span>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </TabsContent>
    </Tabs>
  );
}
