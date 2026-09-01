"use client";

import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import {
  CriticalityIndicator,
  RectificationBadge,
  StatusBadge,
} from "@/components/shared/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { Criticality, OccurrenceStatus } from "@/config/constants";
import { DocumentsCell, DueDatesCell } from "@/features/occurrences/components/due-dates-cell";
import type { OccurrenceRowView } from "@/features/occurrences/components/types";
import { Link } from "@/i18n/navigation";

/**
 * Tableau de l'échéancier.
 *
 * ⚠️ Tri, filtres et pagination sont traités EN BASE. Ce composant reçoit une
 * page de 50 lignes et n'en réordonne aucune : trier en mémoire une page de 50
 * donnerait un ordre faux sur un jeu de 10 000, et l'utilisateur croirait voir
 * les plus urgentes alors qu'il verrait les cinquante premières d'une page.
 *
 * Distinct du tableau du référentiel, et il doit le rester : une règle et un
 * dossier daté portent des métiers différents (cf. CLAUDE.md §3.4).
 */
export function OccurrencesTable({
  rows,
  sorting,
  onSortingChange,
  selection,
  onSelectionChange,
  canAssign,
}: {
  readonly rows: readonly OccurrenceRowView[];
  readonly sorting: SortingState;
  readonly onSortingChange: (sorting: SortingState) => void;
  readonly selection: ReadonlySet<string>;
  readonly onSelectionChange: (selection: ReadonlySet<string>) => void;
  readonly canAssign: boolean;
}) {
  const t = useTranslations("occurrences");

  const allSelected = rows.length > 0 && rows.every((row) => selection.has(row.id));
  const someSelected = rows.some((row) => selection.has(row.id));

  const columns = useMemo<ColumnDef<OccurrenceRowView>[]>(() => {
    const selectColumn: ColumnDef<OccurrenceRowView> = {
      id: "select",
      enableSorting: false,
      header: () => (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          aria-label={t("selectAll")}
          onCheckedChange={(checked) => {
            onSelectionChange(checked === true ? new Set(rows.map((row) => row.id)) : new Set());
          }}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selection.has(row.original.id)}
          // Un dossier verrouillé ou clos ne se réaffecte pas : le proposer
          // ferait échouer l'action sans que l'utilisateur comprenne pourquoi.
          disabled={row.original.isLocked}
          aria-label={t("selectRow", { code: row.original.obligationCode })}
          onCheckedChange={(checked) => {
            const next = new Set(selection);
            if (checked === true) next.add(row.original.id);
            else next.delete(row.original.id);
            onSelectionChange(next);
          }}
        />
      ),
    };

    const dataColumns: ColumnDef<OccurrenceRowView>[] = [
      {
        accessorKey: "obligation_code",
        header: t("obligation"),
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <Link
              href={`/echeancier/${row.original.id}`}
              className="text-sm font-medium text-text-primary underline-offset-2 hover:underline"
            >
              {row.original.obligationName}
            </Link>
            <span className="text-2xs text-text-muted" data-numeric>
              {row.original.obligationCode}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "period_key",
        header: t("period"),
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-sm text-text-primary" data-numeric>
              {row.original.periodKey}
            </span>
            {row.original.rectificationIndex > 0 ? (
              <RectificationBadge index={row.original.rectificationIndex} />
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "internal_due_date",
        // L'intitulé porte l'échéance INTERNE : c'est la colonne d'objectif.
        header: t("internalDueDate"),
        cell: ({ row }) => (
          <DueDatesCell
            internalDueDate={row.original.internalDueDate}
            legalDueDate={row.original.legalDueDate}
            daysToInternal={row.original.daysToInternal}
            isOverdue={row.original.isOverdue}
            isInternallyLate={row.original.isInternallyLate}
          />
        ),
      },
      {
        accessorKey: "status",
        header: t("statusColumn"),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "owner",
        enableSorting: false,
        header: t("owner"),
        cell: ({ row }) => (
          <span className="text-sm text-text-secondary">{row.original.ownerName ?? "—"}</span>
        ),
      },
      {
        id: "validator",
        enableSorting: false,
        header: t("validator"),
        cell: ({ row }) => (
          <span className="text-sm text-text-secondary">{row.original.validatorName ?? "—"}</span>
        ),
      },
      {
        id: "documents",
        enableSorting: false,
        header: t("documents"),
        cell: ({ row }) => (
          <DocumentsCell
            provided={row.original.documentsProvided}
            required={row.original.documentsRequired}
          />
        ),
      },
      {
        accessorKey: "criticality",
        header: t("criticalityColumn"),
        cell: ({ row }) => <CriticalityIndicator criticality={row.original.criticality} />,
      },
    ];

    return canAssign ? [selectColumn, ...dataColumns] : dataColumns;
  }, [t, rows, selection, allSelected, someSelected, onSelectionChange, canAssign]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      caption={t("tableCaption")}
      sorting={sorting}
      onSortingChange={onSortingChange}
      emptyState={<EmptyState title={t("emptyList")} description={t("emptyListHint")} />}
    />
  );
}

export type { Criticality, OccurrenceStatus };
