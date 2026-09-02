"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

/**
 * Enveloppe TanStack Table, générique et typée.
 *
 * Purement présentationnelle : elle reçoit des lignes, jamais une requête.
 * Le tri et la pagination sont pilotés PAR L'APPELANT (`onSortingChange`) et
 * exécutés côté serveur — trier en mémoire une page de 50 lignes donnerait un
 * ordre faux sur un jeu de 4 000.
 */

interface DataTableProps<TData> {
  readonly columns: readonly ColumnDef<TData>[];
  readonly data: readonly TData[];
  /** Légende annoncée aux lecteurs d'écran : de quoi ce tableau est-il la liste ? */
  readonly caption: string;
  readonly sorting?: SortingState;
  readonly onSortingChange?: (sorting: SortingState) => void;
  readonly emptyState?: React.ReactNode;
  readonly className?: string;
}

export function DataTable<TData>({
  columns,
  data,
  caption,
  sorting,
  onSortingChange,
  emptyState,
  className,
}: DataTableProps<TData>) {
  const t = useTranslations("common.table");
  const hydrated = useHydrated();

  const table = useReactTable({
    data: data as TData[],
    columns: columns as ColumnDef<TData>[],
    getCoreRowModel: getCoreRowModel(),
    // Le tri est délégué : la table affiche l'état, elle ne réordonne rien.
    manualSorting: true,
    state: sorting === undefined ? {} : { sorting },
    onSortingChange: (updater) => {
      if (onSortingChange === undefined) return;
      onSortingChange(typeof updater === "function" ? updater(sorting ?? []) : updater);
    },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <Table>
        {/* La légende est lue par les lecteurs d'écran, masquée visuellement. */}
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const direction = header.column.getIsSorted();

                return (
                  <TableHead
                    key={header.id}
                    // `aria-sort` : l'ordre courant est annoncé, pas seulement dessiné.
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : canSort
                            ? "none"
                            : undefined
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        /*
                         * ⚠️ DÉSACTIVÉ TANT QUE REACT N'A PAS REPRIS LA MAIN.
                         * Avant l'hydratation, ce bouton a son apparence finale
                         * et son gestionnaire n'existe pas : le clic disparaît
                         * en silence. Mieux vaut un contrôle visiblement inerte
                         * pendant quelques centaines de millisecondes qu'un
                         * contrôle qui ment sur sa disponibilité.
                         */
                        disabled={!hydrated}
                        aria-disabled={!hydrated}
                        className="inline-flex items-center gap-1.5 rounded-sm hover:text-text-primary disabled:cursor-wait"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {direction === "asc" ? (
                          <ArrowUp aria-hidden="true" className="size-3.5" />
                        ) : direction === "desc" ? (
                          <ArrowDown aria-hidden="true" className="size-3.5" />
                        ) : (
                          <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-50" />
                        )}
                        <span className="sr-only">{t("sortBy")}</span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-32 p-0">
                {emptyState ?? (
                  <p className="py-10 text-center text-sm text-text-muted">{t("empty")}</p>
                )}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
