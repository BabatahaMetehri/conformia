"use client";

import { Check, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
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

/**
 * Rythme et plafond des relances de rafraîchissement après un dépôt.
 *
 * ⚠️ CE N'EST PAS UN DÉLAI DE CONFORT, C'EST LA CORRECTION D'UNE COURSE.
 *
 * `router.refresh()` demandé dans la foulée de la Server Action est ANNULÉ :
 * la requête part, et le navigateur l'interrompt (`net::ERR_ABORTED`) avant que
 * le résultat ne soit appliqué — mesuré, dans un build de production, sur une
 * quinzaine d'exécutions. Selon la vitesse de la machine, l'écran se met à jour
 * ou reste figé sur « Aucune pièce déposée » avec « Soumettre à validation »
 * grisé : l'utilisateur croit son dépôt perdu et le recommence.
 *
 * On redemande donc la page jusqu'à ce qu'elle ait VU le dépôt, à intervalle
 * court et en nombre borné. La condition d'arrêt n'est pas un délai mais un
 * fait : la pièce est rattachée côté serveur.
 */
const REFRESH_RETRY_MS = 250;
const MAX_REFRESH_ATTEMPTS = 8;

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
      /*
       * Le dépôt part seul. Le rafraîchissement N'EST PAS déclenché ici : il
       * l'est par l'effet ci-dessous, qui relance tant que la page n'a pas vu la
       * pièce. Enchaîner un `router.refresh()` sur la fin de l'action, dans la
       * même boucle, le fait annuler — voir `REFRESH_RETRY_MS`.
       */
      runInTransition: (run: () => Promise<void>) => {
        void run();
      },
    }),
    [],
  );
  const upload = useDirectUpload(detail.id, ports);

  /**
   * Complétude AFFICHÉE : celle du serveur, augmentée des dépôts que le serveur
   * vient de confirmer mais que cette page n'a pas encore relus.
   *
   * ⚠️ Ce n'est pas de l'optimisme : on ne compte QUE des pièces dont
   * `confirm_document_upload` a rendu un identifiant, donc inscrites en base.
   * L'ajout couvre l'intervalle — quelques centaines de millisecondes — entre la
   * confirmation du dépôt et le moment où la page relit la base. Sans lui, le
   * compteur reculerait visiblement pendant cet intervalle.
   *
   * ⚠️ Ceci ne relâche AUCUNE garantie : la soumission d'un dossier incomplet
   * est refusée par la base, jamais par ce compteur. Il informe, il n'autorise pas.
   */
  const confirmedItemIds = new Set(
    upload.entries
      .filter((entry) => entry.stage === "DONE" && entry.checklistItemId !== null)
      .map((entry) => entry.checklistItemId),
  );

  /**
   * Pièces confirmées par le serveur mais que CETTE page n'a pas encore relues.
   * Tant qu'il en reste, la page est en retard sur la base.
   */
  const unseenDeposits = upload.entries.filter(
    (entry) =>
      entry.stage === "DONE" &&
      entry.checklistItemId !== null &&
      !detail.completeness.satisfiedItemIds.has(entry.checklistItemId),
  ).length;

  const [refreshAttempts, setRefreshAttempts] = useState(0);

  useEffect(() => {
    if (unseenDeposits === 0) {
      // Le serveur a rattrapé : le compteur repart à zéro pour le dépôt suivant.
      setRefreshAttempts((attempts) => (attempts === 0 ? attempts : 0));
      return;
    }
    if (refreshAttempts >= MAX_REFRESH_ATTEMPTS) return;

    const timer = window.setTimeout(() => {
      router.refresh();
      // Incrémenter RELANCE cet effet : c'est ce qui permet de réessayer même
      // quand le rafraîchissement précédent a été annulé sans rien changer.
      setRefreshAttempts((attempts) => attempts + 1);
    }, REFRESH_RETRY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [unseenDeposits, refreshAttempts, router]);

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
