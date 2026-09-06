"use client";

import { CheckCheck, ChevronDown, ChevronRight, Loader2, ShieldCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { DocumentActions } from "@/components/shared/document-actions";
import { EmptyState } from "@/components/shared/states";
import { CriticalityIndicator } from "@/components/shared/status-badge";
import { DueDateIndicator } from "@/components/shared/due-date-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  bulkValidateAction,
  decideAction,
  loadReviewAction,
} from "@/features/workflow/actions/validation";
import type { ReviewOutcome } from "@/features/workflow/actions/types";
import { formatDateFr, formatDateTimeFr } from "@/lib/dates";
import { Link } from "@/i18n/navigation";
import type { ValidationQueueRow } from "@/services/workflow/queue";
import { useActionRunner } from "@/hooks/use-action-runner";

const MIN_REASON_LENGTH = 10;

type Review = Extract<ReviewOutcome, { status: "success" }>["data"];

/**
 * File de validation.
 *
 * ⚠️ Aucune décision de cycle de vie n'est prise ici. Le composant n'énumère
 * aucun statut et ne teste aucun `status === …` : il propose « Valider » et
 * « Rejeter » sur des dossiers que la vue `validation_queue` a déjà retenus, et
 * c'est la base qui tranche à l'envoi. Le seul jugement porté côté client est la
 * criticité admise en validation groupée — et il est REFAIT côté serveur.
 */
export function ValidationQueue({
  rows,
  bulkCriticalities,
}: {
  readonly rows: readonly ValidationQueueRow[];
  readonly bulkCriticalities: readonly string[];
}) {
  const t = useTranslations("workflow.queue");
  const tCommon = useTranslations("common.actions");

  const [pending, run] = useActionRunner();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [rejecting, setRejecting] = useState<ValidationQueueRow | null>(null);
  const [reason, setReason] = useState("");
  const [confirmBulk, setConfirmBulk] = useState(false);

  const selectable = rows.filter((row) => bulkCriticalities.includes(row.criticality));
  const selected = [...selection];

  function toggle(id: string): void {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openReview(row: ValidationQueueRow): void {
    if (expanded === row.id) {
      setExpanded(null);
      setReview(null);
      return;
    }
    setExpanded(row.id);
    setReview(null);
    setLoadingReview(true);

    run(async () => {
      const outcome = await loadReviewAction({ occurrenceId: row.id });
      setLoadingReview(false);
      if (outcome.status === "error") {
        toast.error(t("reviewFailed"));
        return;
      }
      setReview(outcome.data);
    });
  }

  function decide(row: ValidationQueueRow, toStatus: "VALIDATED" | "REJECTED"): void {
    run(async () => {
      const outcome = await decideAction({
        occurrenceId: row.id,
        toStatus,
        expectedVersion: row.version,
        reason: toStatus === "REJECTED" ? reason : null,
      });

      if (outcome.status === "error") {
        toast.error(t("decisionFailed"));
        return;
      }

      // ⚠️ Le serveur peut répondre « première des deux validations » : le dossier
      // reste alors en attente, et le dire est la seule façon d'éviter que le
      // validateur croie son geste sans effet.
      if (outcome.data.outcome === "PARTIALLY_VALIDATED") {
        toast.success(
          t("partiallyValidated", {
            obtained: outcome.data.obtained ?? 1,
            required: outcome.data.required ?? 2,
          }),
        );
      } else if (outcome.data.outcome === "APPLIED") {
        toast.success(toStatus === "VALIDATED" ? t("validated") : t("rejected"));
      } else {
        toast.error(t("decisionRefused"), { description: outcome.data.outcome });
      }

      setRejecting(null);
      setReason("");
    });
  }

  function runBulk(): void {
    run(async () => {
      const outcome = await bulkValidateAction({ occurrenceIds: selected });
      setConfirmBulk(false);

      if (outcome.status === "error") {
        toast.error(t("decisionFailed"));
        return;
      }

      toast.success(t("bulkDone", { count: outcome.data.applied }));
      if (outcome.data.refused.length > 0) {
        toast.error(t("bulkRefused", { count: outcome.data.refused.length }));
      }
      setSelection(new Set());
    });
  }

  if (rows.length === 0) {
    return <EmptyState title={t("empty")} />;
  }

  return (
    <div className="space-y-3">
      {selectable.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
          <p className="text-sm text-text-secondary">{t("bulkHint")}</p>
          <Button
            size="sm"
            disabled={selected.length === 0 || pending}
            onClick={() => {
              setConfirmBulk(true);
            }}
          >
            <CheckCheck aria-hidden="true" className="size-4" />
            {t("bulkValidate", { count: selected.length })}
          </Button>
        </div>
      ) : null}

      <ul className="space-y-2">
        {rows.map((row) => {
          const bulkAllowed = bulkCriticalities.includes(row.criticality);
          const isOpen = expanded === row.id;

          return (
            <li key={row.id} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-start gap-3 p-3">
                {/* ⚠️ Pas de case à cocher sur HIGH ni CRITICAL : la validation
                    groupée n'y est pas admise, et proposer le geste puis le
                    refuser serait pire que ne pas le proposer. */}
                <div className="pt-1">
                  {bulkAllowed ? (
                    <Checkbox
                      checked={selection.has(row.id)}
                      aria-label={t("select", { name: row.obligationName })}
                      onCheckedChange={() => {
                        toggle(row.id);
                      }}
                    />
                  ) : (
                    <span className="block size-4" aria-hidden="true" />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    openReview(row);
                  }}
                  className="flex min-w-0 flex-1 items-start gap-2 text-start"
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown aria-hidden="true" className="mt-0.5 size-4 text-text-muted" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="mt-0.5 size-4 text-text-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text-primary">
                      {row.obligationName}
                    </span>
                    <span className="block text-xs text-text-muted" data-numeric>
                      {row.obligationCode} · {row.periodKey}
                      {row.ownerName === null ? "" : ` · ${row.ownerName}`}
                      {row.authorityName === null ? "" : ` · ${row.authorityName}`}
                    </span>
                  </span>
                </button>

                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  {row.validationLevels > 1 ? (
                    <Badge variant="outline">
                      <ShieldCheck aria-hidden="true" className="size-3" />
                      {t("levels", {
                        obtained: row.validationsObtained,
                        required: row.validationLevels,
                      })}
                    </Badge>
                  ) : null}
                  <CriticalityIndicator criticality={row.criticality} />
                  <DueDateIndicator
                    className="text-sm"
                    formattedDate={formatDateFr(new Date(`${row.internalDueDate}T12:00:00Z`))}
                    isoDate={row.internalDueDate}
                    daysRemaining={row.daysToInternal}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      decide(row, "VALIDATED");
                    }}
                  >
                    {t("validate")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setRejecting(row);
                      setReason("");
                    }}
                  >
                    {t("reject")}
                  </Button>
                </div>
              </div>

              {isOpen ? (
                <div className="border-t border-border p-3">
                  {loadingReview ? (
                    <p className="flex items-center gap-2 text-sm text-text-secondary">
                      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                      {t("loadingReview")}
                    </p>
                  ) : review === null ? null : (
                    <ReviewPanel occurrenceId={row.id} review={review} />
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">{t("reasonLabel")}</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p className="text-xs text-text-muted">{t("reasonMin", { min: MIN_REASON_LENGTH })}</p>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejecting(null);
              }}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < MIN_REASON_LENGTH}
              onClick={() => {
                if (rejecting !== null) decide(rejecting, "REJECTED");
              }}
            >
              {t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bulkConfirmTitle", { count: selected.length })}</DialogTitle>
            {/* La confirmation est EXPLICITE et nomme le nombre : valider en lot
                sans avoir ouvert les dossiers est un geste qui doit peser. */}
            <DialogDescription>
              {t("bulkConfirmBody", { count: selected.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmBulk(false);
              }}
            >
              {tCommon("cancel")}
            </Button>
            <Button disabled={pending} onClick={runBulk}>
              {t("bulkConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewPanel({
  occurrenceId,
  review,
}: {
  readonly occurrenceId: string;
  readonly review: Review;
}) {
  const t = useTranslations("workflow.queue");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
          {t("checklist")}
        </h3>
        <ul className="space-y-1">
          {review.checklist.map((line) => (
            <li key={line.id} className="flex items-center gap-2 text-sm">
              {line.hasDocument ? (
                <ShieldCheck aria-hidden="true" className="size-4 text-status-validated" />
              ) : (
                <X aria-hidden="true" className="size-4 text-destructive" />
              )}
              <span className="min-w-0 flex-1 truncate text-text-primary">{line.label}</span>
              {line.documentId === null ? null : (
                <DocumentActions documentId={line.documentId} compact />
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-muted" data-numeric>
          {t("completeness", {
            provided: review.completeness.provided,
            required: review.completeness.required,
          })}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
          {t("history")}
        </h3>
        <ol className="space-y-1 text-xs">
          {review.timeline.map((step) => (
            <li key={step.id} className="text-text-secondary">
              {formatDateTimeFr(new Date(step.occurredAt))} ·{" "}
              {step.onBehalfOfName === null
                ? (step.actorName ?? "—")
                : t("onBehalfOf", {
                    actor: step.actorName ?? "—",
                    delegator: step.onBehalfOfName,
                  })}
              {step.reason === null ? "" : ` — ${step.reason}`}
            </li>
          ))}
        </ol>
        <Link
          href={`/echeancier/${occurrenceId}`}
          className="mt-2 inline-block text-xs text-primary underline-offset-2 hover:underline"
        >
          {t("openFull")}
        </Link>
      </section>
    </div>
  );
}
