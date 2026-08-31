"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Copy, MoreHorizontal, Pencil, Power, PowerOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useTransition } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import { CriticalityIndicator, PeriodicityBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Criticality, Periodicity } from "@/config/constants";
import {
  duplicateObligationAction,
  toggleObligationActiveAction,
} from "@/features/obligations/actions";
import { Link, useRouter } from "@/i18n/navigation";
import { formatDateFr } from "@/lib/dates";

/**
 * Tableau du référentiel.
 *
 * Distinct du tableau des occurrences, et il doit le rester : les deux portent
 * des métiers différents (une règle contre un dossier daté). Les factoriser
 * derrière une abstraction commune coûterait plus cher que la ressemblance
 * visuelle ne rapporte (cf. CLAUDE.md §3.4).
 *
 * ⚠️ Les actions d'écriture ne sont rendues QUE si `canManage`. Ce n'est pas la
 * protection : les Server Actions revérifient la permission, et la RLS refuse en
 * dernier ressort. C'est de l'hygiène d'interface — on ne propose pas un geste
 * qui sera refusé.
 */

export interface ObligationRowView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly domainLabel: string | null;
  readonly authorityName: string | null;
  readonly periodicity: Periodicity;
  readonly criticality: Criticality;
  readonly defaultOwnerName: string | null;
  readonly nextDueDate: string | null;
  readonly isActive: boolean;
}

export function ObligationsTable({
  rows,
  canManage,
}: {
  readonly rows: readonly ObligationRowView[];
  readonly canManage: boolean;
}) {
  const t = useTranslations("obligations");
  const [pending, startTransition] = useTransition();

  const columns = useMemo<ColumnDef<ObligationRowView>[]>(
    () => [
      {
        accessorKey: "code",
        header: t("code"),
        cell: ({ row }) => (
          <Link
            href={`/referentiel/${row.original.id}`}
            className="font-medium text-text-primary underline-offset-2 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorKey: "name",
        header: t("name"),
        cell: ({ row }) => <span className="text-text-primary">{row.original.name}</span>,
      },
      {
        accessorKey: "domainLabel",
        header: t("domain"),
        cell: ({ row }) => (
          <span className="text-text-secondary">{row.original.domainLabel ?? "—"}</span>
        ),
      },
      {
        accessorKey: "authorityName",
        header: t("authority"),
        cell: ({ row }) => (
          <span className="text-text-secondary">{row.original.authorityName ?? "—"}</span>
        ),
      },
      {
        accessorKey: "periodicity",
        header: t("periodicityColumn"),
        cell: ({ row }) => <PeriodicityBadge periodicity={row.original.periodicity} />,
      },
      {
        accessorKey: "criticality",
        header: t("criticalityColumn"),
        cell: ({ row }) => <CriticalityIndicator criticality={row.original.criticality} />,
      },
      {
        accessorKey: "defaultOwnerName",
        header: t("defaultOwner"),
        cell: ({ row }) => (
          <span className="text-text-secondary">{row.original.defaultOwnerName ?? "—"}</span>
        ),
      },
      {
        accessorKey: "nextDueDate",
        header: t("nextDueDate"),
        cell: ({ row }) =>
          row.original.nextDueDate === null ? (
            // « — » et non « aucune » : la RLS peut masquer les occurrences d'un
            // autre domaine, l'absence d'affichage ne prouve pas l'absence de dossier.
            <span className="text-text-muted">—</span>
          ) : (
            <time dateTime={row.original.nextDueDate} className="text-text-primary" data-numeric>
              {formatDateFr(new Date(`${row.original.nextDueDate}T12:00:00Z`))}
            </time>
          ),
      },
      {
        accessorKey: "isActive",
        header: t("status"),
        cell: ({ row }) => (
          // Couleur + texte : un statut ne se lit jamais à la seule couleur.
          <Badge variant={row.original.isActive ? "default" : "outline"}>
            {row.original.isActive ? t("active") : t("inactive")}
          </Badge>
        ),
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">{t("actions")}</span>,
              cell: ({ row }) => (
                <RowActions row={row.original} pending={pending} onRun={startTransition} />
              ),
            } satisfies ColumnDef<ObligationRowView>,
          ]
        : []),
    ],
    [t, canManage, pending],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      caption={t("tableCaption")}
      emptyState={<EmptyState title={t("emptyList")} description={t("emptyListHint")} />}
    />
  );
}

function RowActions({
  row,
  pending,
  onRun,
}: {
  readonly row: ObligationRowView;
  readonly pending: boolean;
  readonly onRun: (action: () => void) => void;
}) {
  const t = useTranslations("obligations");
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("actionsFor", { code: row.code })}>
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/referentiel/${row.id}/modifier`}>
            <Pencil aria-hidden="true" className="size-4" />
            {t("edit")}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={pending}
          onSelect={() => {
            onRun(() => {
              void duplicateObligationAction({
                id: row.id,
                // Suffixe explicite : une copie doit se repérer dans la liste
                // sans avoir à l'ouvrir. Le code reste modifiable ensuite.
                code: `${row.code}-COPIE`,
                name: `${row.name} (copie)`,
              }).then((outcome) => {
                if (outcome.status === "success") {
                  toast.success(t("duplicated"));
                  router.push(`/referentiel/${outcome.data.id}/modifier`);
                } else {
                  toast.error(t(`errors.${outcome.error.code}`));
                }
              });
            });
          }}
        >
          <Copy aria-hidden="true" className="size-4" />
          {t("duplicate")}
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={pending}
          onSelect={() => {
            onRun(() => {
              void toggleObligationActiveAction({ id: row.id, is_active: !row.isActive }).then(
                (outcome) => {
                  if (outcome.status === "success") {
                    toast.success(row.isActive ? t("deactivated") : t("reactivated"));
                    router.refresh();
                  } else {
                    // Le refus le plus fréquent est « une obligation active en
                    // dépend » : le message doit le dire, pas parler d'erreur.
                    toast.error(t(`errors.${outcome.error.code}`));
                  }
                },
              );
            });
          }}
        >
          {row.isActive ? (
            <PowerOff aria-hidden="true" className="size-4" />
          ) : (
            <Power aria-hidden="true" className="size-4" />
          )}
          {row.isActive ? t("deactivate") : t("reactivate")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
