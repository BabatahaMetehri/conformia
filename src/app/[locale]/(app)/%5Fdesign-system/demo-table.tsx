"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { DataTable } from "@/components/shared/data-table";
import { DueDateIndicator } from "@/components/shared/due-date-indicator";
import { StatusBadge } from "@/components/shared/status-badge";
import type { OccurrenceStatus } from "@/config/constants";

interface DemoRow {
  readonly obligation: string;
  readonly status: OccurrenceStatus;
  readonly formattedDate: string;
  readonly isoDate: string;
  readonly daysRemaining: number;
}

const ROWS: readonly DemoRow[] = [
  {
    obligation: "G50 — janvier 2026",
    status: "TODO",
    formattedDate: "20/02/2026",
    isoDate: "2026-02-20",
    daysRemaining: 42,
  },
  {
    obligation: "CNAS — 1er trimestre 2026",
    status: "IN_PROGRESS",
    formattedDate: "30/04/2026",
    isoDate: "2026-04-30",
    daysRemaining: 5,
  },
  {
    obligation: "Bilan comptable 2025",
    status: "PENDING_VALIDATION",
    formattedDate: "30/04/2026",
    isoDate: "2026-04-30",
    daysRemaining: 1,
  },
  {
    obligation: "Déclaration TAP — décembre 2025",
    status: "REJECTED",
    formattedDate: "20/01/2026",
    isoDate: "2026-01-20",
    daysRemaining: -12,
  },
];

/** Table de démonstration. Données figées : aucun appel réseau. */
export function DemoTable() {
  const t = useTranslations("designSystem");

  const columns = useMemo<ColumnDef<DemoRow>[]>(
    () => [
      {
        accessorKey: "obligation",
        header: t("columnObligation"),
        enableSorting: true,
      },
      {
        accessorKey: "status",
        header: t("columnStatus"),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        enableSorting: false,
      },
      {
        accessorKey: "isoDate",
        header: t("columnDue"),
        cell: ({ row }) => (
          <DueDateIndicator
            formattedDate={row.original.formattedDate}
            isoDate={row.original.isoDate}
            daysRemaining={row.original.daysRemaining}
          />
        ),
        enableSorting: true,
      },
    ],
    [t],
  );

  return <DataTable columns={columns} data={ROWS} caption={t("sampleTableCaption")} />;
}
