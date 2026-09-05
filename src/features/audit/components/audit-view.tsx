"use client";

import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportAuditAction } from "@/features/audit/actions/export";
import { formatDateTimeFr } from "@/lib/dates";
import { useQueryNavigation } from "@/hooks/use-query-navigation";
import type { AuditEntryRow } from "@/services/admin";
import { useActionRunner } from "@/hooks/use-action-runner";

interface Filters {
  readonly from: string;
  readonly to: string;
  readonly action: string;
  readonly entityTable: string;
  readonly ipAddress: string;
}

/**
 * Journal d'audit.
 *
 * ⚠️ La BORNE DE PÉRIODE n'est pas un confort, c'est ce qui rend l'écran tenable.
 * `audit_log` est partitionnée par mois : un filtre sur la date laisse PostgreSQL
 * écarter les partitions hors plage sans les lire. Sans borne, la requête balaie
 * l'historique entier — d'où une fenêtre par défaut, et jamais « tout ».
 *
 * ⚠️ L'EXPORT est journalisé avant d'être rendu. Le seul geste capable de faire
 * sortir l'intégralité de la traçabilité de l'entreprise ne peut pas être le
 * seul à ne pas en laisser.
 */
export function AuditView({
  rows,
  total,
  page,
  pageSize,
  filters,
  actions,
  tables,
}: {
  readonly rows: readonly AuditEntryRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly filters: Filters;
  readonly actions: readonly string[];
  readonly tables: readonly string[];
}) {
  const t = useTranslations("audit");
  const { navigate } = useQueryNavigation();

  const [pending, run] = useActionRunner();
  const [draft, setDraft] = useState<Filters>(filters);
  const [expanded, setExpanded] = useState<number | null>(null);

  function applyFilters(next: Filters): void {
    const params = new URLSearchParams();
    if (next.from !== "") params.set("from", next.from);
    if (next.to !== "") params.set("to", next.to);
    if (next.action !== "") params.set("action", next.action);
    if (next.entityTable !== "") params.set("entity", next.entityTable);
    if (next.ipAddress !== "") params.set("ip", next.ipAddress);
    navigate(params);
  }

  function exportCsv(): void {
    run(async () => {
      const outcome = await exportAuditAction({
        ...(draft.from === "" ? {} : { from: draft.from }),
        ...(draft.to === "" ? {} : { to: draft.to }),
        ...(draft.action === "" ? {} : { action: draft.action }),
        ...(draft.entityTable === "" ? {} : { entityTable: draft.entityTable }),
        ...(draft.ipAddress === "" ? {} : { ipAddress: draft.ipAddress }),
      });

      if (outcome.status === "error") {
        toast.error(t("exportFailed"));
        return;
      }

      // Téléchargement déclenché côté navigateur : le CSV est déjà en mémoire,
      // il n'a pas à repasser par une route.
      const blob = new Blob([outcome.data.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = outcome.data.filename;
      anchor.click();
      URL.revokeObjectURL(url);

      toast.success(t("exported", { count: outcome.data.rowCount }));
    });
  }

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters(draft);
        }}
      >
        <FilterField label={t("from")} htmlFor="audit-from">
          <Input
            id="audit-from"
            type="date"
            value={draft.from}
            onChange={(event) => {
              setDraft({ ...draft, from: event.target.value });
            }}
          />
        </FilterField>
        <FilterField label={t("to")} htmlFor="audit-to">
          <Input
            id="audit-to"
            type="date"
            value={draft.to}
            onChange={(event) => {
              setDraft({ ...draft, to: event.target.value });
            }}
          />
        </FilterField>
        <FilterField label={t("action")} htmlFor="audit-action">
          <select
            id="audit-action"
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
            value={draft.action}
            onChange={(event) => {
              setDraft({ ...draft, action: event.target.value });
            }}
          >
            <option value="">{t("allActions")}</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={t("entity")} htmlFor="audit-entity">
          <select
            id="audit-entity"
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
            value={draft.entityTable}
            onChange={(event) => {
              setDraft({ ...draft, entityTable: event.target.value });
            }}
          >
            <option value="">{t("allEntities")}</option>
            {tables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={t("ip")} htmlFor="audit-ip">
          <Input
            id="audit-ip"
            value={draft.ipAddress}
            onChange={(event) => {
              setDraft({ ...draft, ipAddress: event.target.value });
            }}
          />
        </FilterField>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {t("apply")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={exportCsv}>
            <Download aria-hidden="true" className="size-4" />
            {t("export")}
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="w-8 px-2 py-2" />
                <Th>{t("when")}</Th>
                <Th>{t("actor")}</Th>
                <Th>{t("action")}</Th>
                <Th>{t("entity")}</Th>
                <Th>{t("fields")}</Th>
                <Th>{t("ip")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <>
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        aria-expanded={expanded === row.id}
                        aria-label={t("toggleDiff")}
                        onClick={() => {
                          setExpanded(expanded === row.id ? null : row.id);
                        }}
                      >
                        {expanded === row.id ? (
                          <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
                        ) : (
                          <ChevronRight aria-hidden="true" className="size-4 text-text-muted" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary" data-numeric>
                      {formatDateTimeFr(new Date(row.occurredAt))}
                    </td>
                    <td className="px-3 py-2 text-text-primary">
                      {row.actorEmail ?? t("system")}
                      {/* ⚠️ Action DÉLÉGUÉE : les deux identités, toujours. Une
                          délégation prête des droits, elle n'efface pas l'auteur. */}
                      {row.onBehalfOfId === null ? null : (
                        <Badge variant="outline" className="ms-2">
                          {t("onBehalfOf")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{row.action}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary" data-numeric>
                      {row.entityTable}
                      {row.entityIdRef === null ? "" : ` · ${row.entityIdRef.slice(0, 8)}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {row.changedFields.length === 0 ? "—" : row.changedFields.join(", ")}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary" data-numeric>
                      {row.ipAddress ?? "—"}
                    </td>
                  </tr>
                  {expanded === row.id ? (
                    <tr key={`${String(row.id)}-diff`} className="border-b border-border">
                      <td colSpan={7} className="bg-surface-raised px-3 py-2">
                        <div className="grid gap-3 md:grid-cols-2">
                          <Snapshot title={t("before")} value={row.before} />
                          <Snapshot title={t("after")} value={row.after} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex items-center justify-between" aria-label={t("pagination")}>
        <p className="text-xs text-text-muted" data-numeric>
          {t("range", {
            from: page * pageSize + 1,
            to: Math.min((page + 1) * pageSize, total),
            total,
          })}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => {
              navigate(new URLSearchParams({ page: String(page - 1) }));
            }}
          >
            {t("previous")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= lastPage}
            onClick={() => {
              navigate(new URLSearchParams({ page: String(page + 1) }));
            }}
          >
            {t("next")}
          </Button>
        </div>
      </nav>
    </div>
  );
}

/** État avant / après, tel qu'enregistré — colonnes sensibles déjà occultées. */
function Snapshot({ title, value }: { readonly title: string; readonly value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium tracking-wide text-text-muted uppercase">{title}</p>
      <pre className="max-h-64 overflow-auto rounded border border-border bg-surface p-2 text-xs text-text-secondary">
        {value === null ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-start text-xs font-medium tracking-wide text-text-muted uppercase">
      {children}
    </th>
  );
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
