"use client";

import { Info, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { applyRuleChangeAction, previewRuleChangeAction } from "@/features/obligations/actions";
import type { RecalculationImpact } from "@/services/obligations";
import { formatDateFr } from "@/lib/dates";

/**
 * Confirmation du recalcul après modification d'une règle.
 *
 * ⚠️ COMPORTEMENT ARRÊTÉ. Seules les occurrences au statut TODO sont
 * recalculées. IN_PROGRESS, PENDING_VALIDATION, VALIDATED, SUBMITTED, ARCHIVED
 * et NOT_APPLICABLE ne sont JAMAIS touchées — on ne déplace pas le sol sous les
 * pieds de quelqu'un qui travaille. La fenêtre le DIT explicitement, et compte
 * les dossiers protégés par statut : l'utilisateur doit voir ce qui reste en
 * place autant que ce qui bouge.
 *
 * L'impact est calculé PAR LE SERVEUR, jamais transmis par le formulaire. Et il
 * est recalculé une seconde fois à l'application : la liste affichée ici n'est
 * qu'un affichage, elle n'est pas ce qui sera écrit.
 */
export function RecalculationDialog({
  obligationId,
  rule,
  periodicity,
  open,
  onOpenChange,
  onApplied,
}: {
  readonly obligationId: string;
  readonly rule: unknown;
  readonly periodicity: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApplied: (updated: number) => void;
}) {
  const t = useTranslations("obligations.recalculation");
  const tStatus = useTranslations("occurrences.status");

  const [impact, setImpact] = useState<RecalculationImpact | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setImpact(null);
    setFailed(false);

    void previewRuleChangeAction(obligationId, rule, periodicity).then((outcome) => {
      if (cancelled) return;
      if (outcome.status === "success") setImpact(outcome.data);
      else setFailed(true);
    });

    // La fenêtre peut être refermée pendant que l'impact se calcule : sans ce
    // drapeau, la réponse tardive écrirait dans un composant déjà démonté.
    return () => {
      cancelled = true;
    };
  }, [open, obligationId, rule, periodicity]);

  const changed = impact?.lines.filter((line) => line.changed) ?? [];
  const protectedEntries = Object.entries(impact?.protectedByStatus ?? {});

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>

        {failed ? (
          <p role="alert" className="text-sm text-status-overdue">
            {t("failed")}
          </p>
        ) : impact === null ? (
          <p className="text-sm text-text-muted">{t("loading")}</p>
        ) : impact.blindToOccurrences ? (
          /*
            Annoncer « 0 occurrence concernée » serait exact du point de vue de
            cet utilisateur — la RLS ne lui en montre aucune — et trompeur en
            pratique. On dit la vraie raison.
          */
          <div className="flex items-start gap-2 rounded-md border border-status-pending/40 bg-status-pending-bg px-3 py-2.5">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-status-pending"
            />
            <p className="text-sm text-text-primary">{t("blind")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text-primary">
              {t("summary", { count: changed.length, total: impact.lines.length })}
            </p>

            {changed.length > 0 ? (
              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("caption")}</caption>
                  <thead className="bg-surface-raised text-xs text-text-secondary">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-medium">
                        {t("period")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">
                        {t("before")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">
                        {t("after")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {changed.map((line) => (
                      <tr key={line.occurrenceId} className="border-t border-border">
                        <td className="px-3 py-1.5 font-medium text-text-primary" data-numeric>
                          {line.periodKey}
                        </td>
                        <td className="px-3 py-1.5 text-text-muted line-through" data-numeric>
                          {formatDateFr(new Date(`${line.currentLegalDueDate}T12:00:00Z`))}
                        </td>
                        <td className="px-3 py-1.5 text-text-primary" data-numeric>
                          {formatDateFr(new Date(`${line.nextLegalDueDate}T12:00:00Z`))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {protectedEntries.length > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <div className="space-y-1.5 text-sm">
                  <p className="text-text-primary">{t("protected")}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {protectedEntries.map(([status, count]) => (
                      <li key={status}>
                        <Badge variant="outline" className="text-2xs">
                          {tStatus(status)} · {count}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{t("skip")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={
              pending || impact === null || impact.blindToOccurrences || changed.length === 0
            }
            onClick={(event) => {
              // Le dialogue se referme de lui-même au clic : on l'en empêche
              // pour garder l'état « en cours » visible jusqu'à la réponse.
              event.preventDefault();
              startTransition(async () => {
                const outcome = await applyRuleChangeAction(obligationId, rule, periodicity);
                if (outcome.status === "success") {
                  onApplied(outcome.data.updated);
                  onOpenChange(false);
                } else {
                  setFailed(true);
                }
              });
            }}
          >
            {pending ? t("applying") : t("apply", { count: changed.length })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
