"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExportForm } from "@/features/reports/components/export-form";
import { loadHistoryAction } from "@/features/reports/actions/exports";
import type { ExportRunView } from "@/features/reports/actions/types";
import { cn } from "@/lib/utils";

/**
 * Écran Rapports : produire, puis relire ce qui a été produit.
 *
 * ⚠️ L'historique est la moitié utile de cet écran. Un export fait SORTIR de la
 * donnée — c'est le seul geste de l'application dont l'effet survit à
 * l'application. Savoir qui a exporté quoi, et combien de dossiers sont
 * réellement sortis, est ce qui distingue un outil d'export d'une fuite outillée.
 */

function humanSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${String(bytes)} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const STATUS_TONE: Readonly<Record<string, string>> = {
  SUCCEEDED: "text-status-validated",
  FAILED: "text-status-overdue",
  PARTIAL: "text-status-warning",
  RUNNING: "text-text-secondary",
};

export function ReportsView({
  domains,
  authorities,
}: {
  readonly domains: readonly { readonly id: string; readonly label: string }[];
  readonly authorities: readonly { readonly id: string; readonly name: string }[];
}) {
  const t = useTranslations();
  /*
   * ⚠️ Le formatage se fait ICI, pas côté serveur. Une fonction ne franchit pas
   * la frontière entre Server et Client Component — Next refuse de la sérialiser,
   * et la page entière échoue au rendu. Le fuseau reste celui d'Alger : il est
   * imposé globalement par `src/i18n/request.ts`, donc `useFormatter` l'applique
   * sans que ce composant ait à le savoir.
   */
  const format = useFormatter();
  const [history, setHistory] = useState<readonly ExportRunView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    void loadHistoryAction().then((outcome) => {
      if (outcome.status === "success") {
        setHistory(outcome.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
  }, []);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-6">
      <ExportForm domains={domains} authorities={authorities} onProduced={load} />

      <section className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-text-primary">{t("exports.page.history")}</h2>
        </div>

        {failed ? (
          <div className="p-4">
            <ErrorState
              title={t("exports.page.failed")}
              action={
                <Button variant="outline" size="sm" onClick={load}>
                  {t("common.actions.retry")}
                </Button>
              }
            />
          </div>
        ) : history === null ? (
          <div className="p-4">
            <LoadingState label={t("common.states.loading")} />
          </div>
        ) : history.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t("exports.page.noHistory")} className="border-0 py-8" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("exports.page.when")}</TableHead>
                  <TableHead>{t("exports.page.type")}</TableHead>
                  <TableHead>{t("exports.page.author")}</TableHead>
                  <TableHead className="text-end">{t("exports.page.rows")}</TableHead>
                  <TableHead className="text-end">{t("exports.page.size")}</TableHead>
                  <TableHead>{t("exports.page.statusLabel")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell data-numeric>
                      {format.dateTime(new Date(run.startedAt), {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell>{t(`exports.page.kinds.${run.kind}`)}</TableCell>
                    <TableCell>{run.requestedByName ?? "—"}</TableCell>
                    {/*
                      Le nombre de dossiers RÉELLEMENT sortis, après filtrage par
                      la RLS de l'auteur — pas ce qui a été demandé.
                    */}
                    <TableCell data-numeric className="text-end">
                      {String(run.occurrenceCount)}
                    </TableCell>
                    <TableCell data-numeric className="text-end">
                      {humanSize(run.sizeBytes)}
                    </TableCell>
                    <TableCell className={cn(STATUS_TONE[run.status] ?? "")}>
                      {t(`exports.page.statuses.${run.status}`)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
