"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { DocumentActions } from "@/components/shared/document-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { removeDocumentAction } from "@/features/documents/actions/upload";
import { formatDateFr } from "@/lib/dates";
import type { PurgeCandidateRow } from "@/services/documents/search";
import { useActionRunner } from "@/hooks/use-action-runner";

const MIN_REASON_LENGTH = 10;

/**
 * File de purge.
 *
 * Le seul geste destructif proposé ici reste un retrait LOGIQUE, motivé, et
 * refusé par la base sur un dossier archivé. L'objet, lui, demeure dans le
 * stockage : la suppression physique relève de la politique de rétention et
 * d'une opération d'exploitation, jamais d'un clic dans l'application.
 */
export function PurgeQueueTable({ rows }: { readonly rows: readonly PurgeCandidateRow[] }) {
  const t = useTranslations("documents.purge");
  const tDocuments = useTranslations("documents");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("common.actions");

  const [pending, run] = useActionRunner();
  const [target, setTarget] = useState<PurgeCandidateRow | null>(null);
  const [reason, setReason] = useState("");

  function submit(): void {
    const candidate = target;
    if (candidate === null) return;

    run(async () => {
      const outcome = await removeDocumentAction({ documentId: candidate.id, reason });
      if (outcome.status === "error") {
        toast.error(tDocuments("actions.remove"));
        return;
      }
      setTarget(null);
      setReason("");
    });
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <Th>{tDocuments("columns.document")}</Th>
              <Th>{tDocuments("columns.obligation")}</Th>
              <Th>{tDocuments("columns.period")}</Th>
              <Th>{t("retention")}</Th>
              <Th>{t("eligibleOn")}</Th>
              <Th>{tDocuments("columns.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-text-primary">{row.originalFilename}</td>
                <td className="px-3 py-2" data-numeric>
                  {row.obligationCode}
                </td>
                <td className="px-3 py-2" data-numeric>
                  {row.periodKey}
                </td>
                <td className="px-3 py-2 text-text-secondary">
                  {t("retentionYears", { years: row.retentionYears })}
                </td>
                <td className="px-3 py-2 text-text-secondary" data-numeric>
                  {formatDateFr(new Date(`${row.purgeEligibleOn}T12:00:00Z`))}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <DocumentActions documentId={row.id} compact />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${tDocuments("actions.remove")} — ${row.originalFilename}`}
                      onClick={() => {
                        setTarget(row);
                        setReason("");
                      }}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tDocuments("actions.remove")}</DialogTitle>
            <DialogDescription>{t("intro")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="purge-reason">{tCommon("reason")}</Label>
            <Textarea
              id="purge-reason"
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setTarget(null);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < MIN_REASON_LENGTH}
              onClick={submit}
            >
              {tDocuments("actions.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-start text-xs font-medium tracking-wide text-text-muted uppercase">
      {children}
    </th>
  );
}
