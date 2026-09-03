"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RegisterRow } from "@/services/registers";
import { Link } from "@/i18n/navigation";
import { formatDateFr } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Liste des registres.
 *
 * ⚠️ LE COMPTE À REBOURS VIENT DE LA BASE. Il n'est pas recalculé ici : une
 * échéance lue à l'heure du poste client donnerait un nombre de jours différent
 * selon le fuseau de qui regarde, et l'expiration d'un registre algérien ne
 * dépend pas du fuseau de son lecteur.
 */

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

function StatusBadge({ status }: { readonly status: RegisterRow["status"] }) {
  const t = useTranslations("registers.status");

  const tone =
    status === "ACTIF"
      ? "border-success/30 bg-success/10 text-success"
      : status === "SUSPENDU"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-border bg-surface-muted text-text-muted";

  return (
    <Badge variant="outline" className={tone}>
      {t(status)}
    </Badge>
  );
}

function Expiry({ row }: { readonly row: RegisterRow }) {
  const t = useTranslations("registers.expiry");

  if (row.expiresAt === null) {
    return <span className="text-text-muted">{t("never")}</span>;
  }

  const days = row.daysToExpiry ?? 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        row.expired ? "text-danger" : row.expiresSoon ? "text-warning" : undefined,
      )}
    >
      {row.expiresSoon || row.expired ? (
        <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
      ) : null}
      <span className="tabular-nums">{formatDateFr(calendarDate(row.expiresAt))}</span>
      <span className="text-xs">
        {row.expired
          ? t("expired", { days: Math.abs(days) })
          : days === 0
            ? t("today")
            : t("inDays", { days })}
      </span>
    </span>
  );
}

export function RegistersTable({ rows }: { readonly rows: readonly RegisterRow[] }) {
  const t = useTranslations("registers");
  const tType = useTranslations("registers.type");

  if (rows.length === 0) {
    return <EmptyState title={t("empty")} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.rcNumber")}</TableHead>
            <TableHead>{t("columns.type")}</TableHead>
            <TableHead>{t("columns.label")}</TableHead>
            <TableHead>{t("columns.activity")}</TableHead>
            <TableHead>{t("columns.wilaya")}</TableHead>
            <TableHead>{t("columns.issuedAt")}</TableHead>
            <TableHead>{t("columns.expiresAt")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead className="text-end">{t("columns.obligations")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/registres/${row.id}`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {row.rcNumber}
                </Link>
              </TableCell>
              <TableCell>{tType(row.registerType)}</TableCell>
              <TableCell>{row.label}</TableCell>
              <TableCell className="max-w-[18rem] truncate text-text-secondary">
                {row.activityLabel ?? "—"}
              </TableCell>
              <TableCell>{row.wilaya ?? "—"}</TableCell>
              <TableCell className="tabular-nums">
                {row.issuedAt === null ? "—" : formatDateFr(calendarDate(row.issuedAt))}
              </TableCell>
              <TableCell>
                <Expiry row={row} />
              </TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-end tabular-nums">{row.occurrenceCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
