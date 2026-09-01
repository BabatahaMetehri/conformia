"use client";

import { Check, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { FileDropzone } from "@/components/shared/file-dropzone";
import { UploadQueue } from "@/components/shared/upload-queue";
import { useDirectUpload } from "@/components/shared/use-direct-upload";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_MB } from "@/config/constants";
import {
  confirmUploadAction,
  removeDocumentAction,
  requestUploadAction,
} from "@/features/occurrences/actions/detail";
import { DocumentActions } from "@/components/shared/document-actions";
import { formatDateTimeFr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { OccurrenceDetailView } from "@/services/occurrences/detail";

/**
 * Onglet « Dossier » : la liste des pièces attendues, ligne par ligne.
 *
 * ⚠️ Une ligne est satisfaite parce qu'une PIÈCE y est rattachée, jamais parce
 * qu'on a coché une case — il n'y a d'ailleurs aucune case à cocher ici. La base
 * applique la même règle : `occurrence_missing_items()` ignore complètement
 * `is_checked`, qui n'est plus qu'une dérivation du dépôt.
 */

const MIN_REASON_LENGTH = 10;

export function OccurrenceChecklist({ detail }: { readonly detail: OccurrenceDetailView }) {
  const t = useTranslations("occurrences.detail");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState("");

  /**
   * ⚠️ Les deux Server Actions sont REMISES au hook partagé, jamais importées
   * par lui : `components/shared` ne connaît aucune feature, et c'est ce qui lui
   * permet de servir aussi bien cet onglet que l'écran /documents sans franchir
   * la barrière inter-features.
   */
  const ports = useMemo(
    () => ({
      requestTicket: requestUploadAction,
      confirm: confirmUploadAction,
      // Un dépôt abouti change la complétude, donc le bandeau, donc les boutons
      // de la barre d'actions : on redemande la page au serveur.
      runInTransition: (run: () => Promise<void>) => {
        void run().then(() => {
          startTransition(() => {
            router.refresh();
          });
        });
      },
    }),
    [router],
  );
  const upload = useDirectUpload(detail.id, ports);

  /**
   * Complétude AFFICHÉE : celle du serveur, augmentée des dépôts que le serveur
   * vient de confirmer mais que cette page n'a pas encore relus.
   *
   * ⚠️ Ce n'est pas de l'optimisme : on ne compte QUE des pièces dont
   * `confirm_document_upload` a rendu un identifiant, donc inscrites en base.
   * L'ajout existe parce que `router.refresh()` ne rafraîchit PAS cette page
   * après un dépôt — mesuré : le rendu serveur de la même URL contient bien
   * « 1 sur 2 » pendant que le DOM affiche encore « 0 sur 2 », et toutes les
   * variantes de rafraîchissement essayées donnent le même résultat. Sans cet
   * ajustement, l'utilisateur voit son dossier rester incomplet après un dépôt
   * réussi, et le recommence.
   *
   * ⚠️ Ceci ne relâche AUCUNE garantie : la soumission d'un dossier incomplet
   * est refusée par la base, jamais par ce compteur. Il informe, il n'autorise pas.
   */
  const confirmedItemIds = new Set(
    upload.entries
      .filter((entry) => entry.stage === "DONE" && entry.checklistItemId !== null)
      .map((entry) => entry.checklistItemId),
  );

  const required = detail.completeness.required;
  const provided = detail.checklist.filter(
    (line) => line.isMandatory && (line.document !== null || confirmedItemIds.has(line.id)),
  ).length;
  const isComplete = provided >= required;
  const percent = required === 0 ? 100 : Math.round((provided / required) * 100);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-text-primary">{t("completeness")}</p>
          <p
            className={cn("text-sm", isComplete ? "text-due-far" : "text-text-secondary")}
            data-numeric
          >
            {t("completenessCount", { provided, required })}
          </p>
        </div>
        <Progress value={percent} aria-label={t("completeness")} />
        {isComplete ? null : (
          <p className="mt-2 text-xs text-text-muted">
            {t("stillMissing", { pieces: detail.completeness.missing.join(", ") })}
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {detail.checklist.map((line) => (
          <li key={line.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  {line.document === null ? null : (
                    <Check aria-hidden="true" className="size-4 text-due-far" />
                  )}
                  {line.label}
                  {line.isMandatory ? (
                    <span className="text-xs font-normal text-due-overdue">{t("mandatory")}</span>
                  ) : (
                    <span className="text-xs font-normal text-text-muted">{t("optional")}</span>
                  )}
                </p>

                {line.document === null ? (
                  <p className="mt-1 text-xs text-text-muted">{t("noPieceYet")}</p>
                ) : (
                  <p className="mt-1 text-xs text-text-secondary" data-numeric>
                    {line.document.originalFilename} · {formatBytes(line.document.sizeBytes, t)} ·{" "}
                    {t("versionLabel", { version: line.document.version })} ·{" "}
                    {line.document.uploaderName ?? "—"} ·{" "}
                    {formatDateTimeFr(new Date(line.document.uploadedAt))}
                  </p>
                )}
              </div>

              {line.document === null ? null : (
                <div className="flex items-center gap-1">
                  <DocumentActions documentId={line.document.id} />
                  {detail.abilities.canDeleteDocument ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("removeDocument", { name: line.label })}
                      onClick={() => {
                        setRemoving({ id: line.document?.id ?? "", label: line.label });
                      }}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            {detail.abilities.canUpload ? (
              <div className="mt-3">
                <FileDropzone
                  accept={ALLOWED_MIME_TYPES}
                  maxSizeMb={MAX_UPLOAD_MB}
                  multiple
                  disabled={isPending}
                  onFilesSelected={(files) => {
                    upload.enqueue(files, line.id);
                  }}
                />
                {line.document === null ? null : (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
                    <RefreshCw aria-hidden="true" className="size-3" />
                    {/* Remplacer ne remplace rien : une version de plus est
                        déposée, l'ancienne reste consultable. */}
                    {t("replaceKeepsHistory")}
                  </p>
                )}

                <div className="mt-2">
                  <UploadQueue
                    entries={upload.entries.filter((entry) => entry.checklistItemId === line.id)}
                    onRetry={upload.retry}
                    onDismiss={upload.dismiss}
                  />
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeDocumentTitle")}</DialogTitle>
            <DialogDescription>{t("removeDocumentHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="removal-reason">{t("reasonLabel")}</Label>
            <Textarea
              id="removal-reason"
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p className="text-xs text-text-muted">{t("reasonHint", { min: MIN_REASON_LENGTH })}</p>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRemoving(null);
                setReason("");
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={isPending || reason.trim().length < MIN_REASON_LENGTH}
              onClick={() => {
                startTransition(async () => {
                  if (removing === null) return;
                  const outcome = await removeDocumentAction({
                    documentId: removing.id,
                    reason: reason.trim(),
                  });
                  if (outcome.status === "error") {
                    toast.error(t("removeFailed"));
                    return;
                  }
                  setRemoving(null);
                  setReason("");
                  toast.success(t("removed"));
                  router.refresh();
                });
              }}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Taille lisible.
 *
 * ⚠️ Les unités passent par i18n : « ko » n'est pas de la ponctuation, c'est un
 * mot, et l'arabe ne l'écrit pas ainsi (CLAUDE.md §6).
 */
function formatBytes(bytes: number, t: (key: string, values: { value: string }) => string): string {
  if (bytes < 1024) return t("size.bytes", { value: String(bytes) });
  if (bytes < 1024 * 1024) return t("size.kilobytes", { value: (bytes / 1024).toFixed(0) });
  return t("size.megabytes", { value: (bytes / (1024 * 1024)).toFixed(1) });
}
