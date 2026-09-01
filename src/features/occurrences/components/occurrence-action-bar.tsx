"use client";

import { AlertTriangle, CopyPlus, Loader2, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OccurrenceStatus } from "@/config/constants";
import {
  createRectificationAction,
  reassignSingleAction,
  transitionOccurrenceAction,
} from "@/features/occurrences/actions/detail";
import type { AssignableProfile } from "@/features/occurrences/components/types";
import type { OccurrenceDetailView } from "@/services/occurrences/detail";

/**
 * Barre d'actions du dossier.
 *
 * ⚠️ Les actions proposées viennent de `detail.abilities.transitions`, elle-même
 * issue de `status_transition_rules`. AUCUNE transition n'est écrite ici : ajouter
 * un chemin de workflow reste une ligne de données, sans redéploiement d'écran.
 *
 * La mise à jour est OPTIMISTE : le nouveau statut s'affiche immédiatement, et
 * revient à l'ancien si le serveur refuse. Le retour arrière n'est pas décoratif —
 * un dossier qui semblerait validé alors qu'il ne l'est pas serait un mensonge
 * dans un outil de conformité.
 */

const MIN_REASON_LENGTH = 10;

const LATE_REASON_CODES = [
  "MISSING_DOCUMENT",
  "VALIDATOR_UNAVAILABLE",
  "LATE_EXTERNAL_INFORMATION",
  "OVERSIGHT",
  "OTHER",
] as const;

type LateReasonCode = (typeof LATE_REASON_CODES)[number];

interface PendingTransition {
  readonly toStatus: OccurrenceStatus;
  readonly requiresReason: boolean;
}

export function OccurrenceActionBar({
  detail,
  assignees,
}: {
  readonly detail: OccurrenceDetailView;
  readonly assignees: readonly AssignableProfile[];
}) {
  const t = useTranslations("occurrences.detail");
  const tStatus = useTranslations("occurrences.status");
  const tErrors = useTranslations("occurrences.detail.outcomes");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [optimisticStatus, setOptimisticStatus] = useOptimistic(detail.status);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState(detail.referenceNumber ?? "");
  const [lateCode, setLateCode] = useState<LateReasonCode | null>(null);
  const [lateNote, setLateNote] = useState("");
  const [rectifying, setRectifying] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [newOwner, setNewOwner] = useState<string | null>(detail.ownerId);

  const permitted = detail.abilities.transitions.filter((transition) => transition.permitted);

  /** Le dépôt est-il déjà hors délai ? Le motif devient alors obligatoire. */
  const submissionIsLate = detail.isOverdue;

  function reset(): void {
    setPending(null);
    setReason("");
    setLateCode(null);
    setLateNote("");
  }

  function needsDialog(transition: PendingTransition): boolean {
    if (transition.requiresReason) return true;
    if (transition.toStatus !== "SUBMITTED") return false;
    return detail.obligation.requiresProof || submissionIsLate;
  }

  function run(transition: PendingTransition, extra: Record<string, unknown> = {}): void {
    startTransition(async () => {
      setOptimisticStatus(transition.toStatus);

      const outcome = await transitionOccurrenceAction({
        occurrenceId: detail.id,
        toStatus: transition.toStatus,
        expectedVersion: detail.version,
        ...extra,
      });

      if (outcome.status === "error") {
        // Le retour arrière est implicite : `useOptimistic` restaure la valeur du
        // serveur dès la fin de la transition, et rien n'a été écrit.
        toast.error(tErrors("failed"), { description: tErrors("retry") });
        return;
      }

      const result = outcome.data;
      if (result.outcome === "APPLIED" || result.outcome === "NO_CHANGE") {
        toast.success(t("transitionApplied", { status: tStatus(transition.toStatus) }));
        reset();
        router.refresh();
        return;
      }

      // Issues ATTENDUES : elles nomment ce que l'utilisateur peut corriger.
      if (result.outcome === "INCOMPLETE") {
        toast.error(tErrors("incomplete"), { description: result.missing.join(" · ") });
      } else if (result.outcome === "VERSION_CONFLICT") {
        toast.error(tErrors("versionConflict"), { description: tErrors("versionConflictHint") });
        router.refresh();
      } else if (result.outcome === "LATE_REASON_REQUIRED") {
        setPending(transition);
        toast.error(tErrors("lateReasonRequired"));
      } else if (result.outcome === "PROOF_REQUIRED") {
        toast.error(tErrors("proofRequired"), { description: tErrors("proofRequiredHint") });
      } else if (result.outcome === "REFERENCE_REQUIRED") {
        setPending(transition);
        toast.error(tErrors("referenceRequired"));
      } else {
        toast.error(tErrors("notFound"));
      }
    });
  }

  const missing = detail.completeness.missing;
  const blocksValidationSubmission = (status: OccurrenceStatus): boolean =>
    status === "PENDING_VALIDATION" && !detail.completeness.isComplete;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
      <StatusBadge status={optimisticStatus} />
      <span aria-hidden="true" className="h-5 w-px bg-border" />

      {permitted.map((transition) => {
        const blocked = blocksValidationSubmission(transition.toStatus);
        return (
          <Button
            key={transition.toStatus}
            size="sm"
            variant={transition.toStatus === "REJECTED" ? "outline" : "default"}
            disabled={isPending || blocked}
            // ⚠️ Le bouton bloqué DIT pourquoi, et nomme les pièces manquantes.
            // « Action indisponible » renverrait l'utilisateur chercher lui-même.
            title={blocked ? t("blockedByMissing", { pieces: missing.join(", ") }) : undefined}
            onClick={() => {
              const next = {
                toStatus: transition.toStatus,
                requiresReason: transition.requiresReason,
              };
              if (needsDialog(next)) setPending(next);
              else run(next);
            }}
          >
            {isPending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t(`actions.${transition.toStatus}`)}
          </Button>
        );
      })}

      {blocksValidationSubmission("PENDING_VALIDATION") && missing.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-due-overdue">
          <AlertTriangle aria-hidden="true" className="size-3.5" />
          {t("blockedByMissing", { pieces: missing.join(", ") })}
        </p>
      ) : null}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        {detail.abilities.canReassign ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              setReassigning(true);
            }}
          >
            <UserCog aria-hidden="true" className="size-4" />
            {t("actions.reassign")}
          </Button>
        ) : null}

        {detail.abilities.canCreateRectification ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              setRectifying(true);
            }}
          >
            <CopyPlus aria-hidden="true" className="size-4" />
            {t("actions.rectify")}
          </Button>
        ) : null}
      </div>

      {/* ── Dialogue de transition ─────────────────────────────────────────── */}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending === null ? "" : t(`actions.${pending.toStatus}`)}</DialogTitle>
            <DialogDescription>
              {pending === null ? "" : t(`actionHints.${pending.toStatus}`)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {pending?.requiresReason === true ? (
              <div className="space-y-1.5">
                <Label htmlFor="transition-reason">{t("reasonLabel")}</Label>
                <Textarea
                  id="transition-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                  aria-describedby="transition-reason-hint"
                />
                <p id="transition-reason-hint" className="text-xs text-text-muted">
                  {t("reasonHint", { min: MIN_REASON_LENGTH })}
                </p>
              </div>
            ) : null}

            {pending?.toStatus === "SUBMITTED" && detail.obligation.requiresProof ? (
              <div className="space-y-1.5">
                <Label htmlFor="reference-number">{t("referenceLabel")}</Label>
                <Input
                  id="reference-number"
                  value={reference}
                  data-numeric
                  onChange={(event) => {
                    setReference(event.target.value);
                  }}
                  aria-describedby="reference-hint"
                />
                <p id="reference-hint" className="text-xs text-text-muted">
                  {t("referenceHint")}
                </p>
              </div>
            ) : null}

            {pending?.toStatus === "SUBMITTED" && submissionIsLate ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-text-primary">
                  {t("lateReasonLegend")}
                </legend>
                {/* ⚠️ Ce champ est la seule source de la donnée « pourquoi les
                    retards se produisent ». Réclamé plus tard, il serait
                    reconstruit de mémoire, donc faux. */}
                <p className="text-xs text-text-muted">{t("lateReasonHint")}</p>
                <RadioGroup
                  value={lateCode ?? ""}
                  onValueChange={(value) => {
                    setLateCode(value as LateReasonCode);
                  }}
                  className="gap-1.5"
                >
                  {LATE_REASON_CODES.map((code) => (
                    <div key={code} className="flex items-center gap-2">
                      <RadioGroupItem value={code} id={`late-${code}`} />
                      <Label htmlFor={`late-${code}`} className="font-normal">
                        {t(`lateReasons.${code}`)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                <Textarea
                  rows={2}
                  value={lateNote}
                  placeholder={t("lateNotePlaceholder")}
                  aria-label={t("lateNoteLabel")}
                  onChange={(event) => {
                    setLateNote(event.target.value);
                  }}
                />
              </fieldset>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                reset();
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={
                isPending ||
                (pending?.requiresReason === true && reason.trim().length < MIN_REASON_LENGTH) ||
                (pending?.toStatus === "SUBMITTED" && submissionIsLate && lateCode === null) ||
                (pending?.toStatus === "SUBMITTED" &&
                  submissionIsLate &&
                  lateCode === "OTHER" &&
                  lateNote.trim().length === 0)
              }
              onClick={() => {
                if (pending === null) return;
                run(pending, {
                  ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}),
                  ...(reference.trim().length > 0 ? { referenceNumber: reference.trim() } : {}),
                  ...(lateCode === null ? {} : { lateReasonCode: lateCode }),
                  ...(lateNote.trim().length > 0 ? { lateReason: lateNote.trim() } : {}),
                });
              }}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rectificative ──────────────────────────────────────────────────── */}
      <Dialog open={rectifying} onOpenChange={setRectifying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("actions.rectify")}</DialogTitle>
            <DialogDescription>{t("rectifyHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="rectify-reason">{t("reasonLabel")}</Label>
            <Textarea
              id="rectify-reason"
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
                setRectifying(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={isPending || reason.trim().length < MIN_REASON_LENGTH}
              onClick={() => {
                startTransition(async () => {
                  const outcome = await createRectificationAction({
                    occurrenceId: detail.id,
                    reason: reason.trim(),
                  });
                  if (outcome.status === "error") {
                    toast.error(tErrors("failed"));
                    return;
                  }
                  setRectifying(false);
                  setReason("");
                  toast.success(t("rectificationCreated"));
                  router.push(`/echeancier/${outcome.data.id}`);
                });
              }}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Réaffectation ──────────────────────────────────────────────────── */}
      <Dialog open={reassigning} onOpenChange={setReassigning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("actions.reassign")}</DialogTitle>
            <DialogDescription>{t("reassignHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="new-owner">{t("newOwner")}</Label>
            <Select value={newOwner ?? ""} onValueChange={setNewOwner}>
              <SelectTrigger id="new-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignees.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setReassigning(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={isPending || newOwner === null || newOwner === detail.ownerId}
              onClick={() => {
                startTransition(async () => {
                  if (newOwner === null) return;
                  const outcome = await reassignSingleAction({
                    occurrenceId: detail.id,
                    ownerId: newOwner,
                  });
                  if (outcome.status === "error" || outcome.data.updated === 0) {
                    toast.error(tErrors("failed"));
                    return;
                  }
                  setReassigning(false);
                  toast.success(t("reassigned"));
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
