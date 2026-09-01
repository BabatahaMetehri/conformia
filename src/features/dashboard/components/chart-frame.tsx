"use client";

import { Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Cadre commun à tous les graphiques.
 *
 * ⚠️ LA TABLE DE DONNÉES N'EST PAS UNE OPTION. Chaque graphique en porte une,
 * dépliable, contenant EXACTEMENT les valeurs tracées. C'est ce qui rend le
 * tableau de bord lisible au lecteur d'écran, à l'impression, et au lecteur
 * daltonien pour qui deux séries voisines peuvent se confondre — la couleur ne
 * porte donc jamais seule une information.
 *
 * C'est aussi ce qui acquitte l'avertissement de contraste de la palette : trois
 * des cinq teintes passent sous 3:1 sur fond clair, ce qui est admis
 * uniquement si une relève textuelle existe. Elle existe, ici.
 */
export function ChartFrame({
  title,
  description,
  children,
  table,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly table: ReactNode;
  readonly action?: ReactNode;
}) {
  const t = useTranslations("dashboard");
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          {description === undefined ? null : (
            <p className="mt-0.5 text-xs text-text-muted">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showTable}
            aria-controls={tableId}
            onClick={() => {
              setShowTable((current) => !current);
            }}
          >
            <Table2 aria-hidden="true" className="size-4" />
            {showTable ? t("hideTable") : t("showTable")}
          </Button>
        </div>
      </header>

      {children}

      <div id={tableId} hidden={!showTable} className="mt-3 overflow-x-auto">
        {table}
      </div>
    </section>
  );
}

/** Table de données d'un graphique. Sobre, scrollable, jamais tronquée. */
export function DataTable({
  columns,
  rows,
  caption,
}: {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
  readonly caption: string;
}) {
  return (
    <table className="w-full border-collapse text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          {columns.map((column) => (
            <th
              key={column}
              scope="col"
              className="px-2 py-1 text-start font-medium text-text-muted"
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-b border-border last:border-0">
            {row.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className="px-2 py-1 text-text-secondary"
                data-numeric={typeof cell === "number" ? "" : undefined}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
