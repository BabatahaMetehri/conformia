"use client";

import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { acknowledgeIntegrityAlertAction } from "@/features/documents/actions/upload";
import { formatDateTimeFr } from "@/lib/dates";
import type { IntegrityAlertRow } from "@/services/documents/integrity";
import { useActionRunner } from "@/hooks/use-action-runner";

const MIN_NOTE_LENGTH = 10;

/**
 * Bandeau d'alerte d'intégrité.
 *
 * ⚠️ Il ne disparaît PAS tout seul. Un écart entre l'empreinte enregistrée et
 * celle recalculée depuis le stockage reste affiché jusqu'à ce qu'une personne
 * l'acquitte en disant ce qui a été fait. Une alerte qui s'efface au bout de
 * quelques jours n'est pas une alerte, c'est un décor.
 *
 * Il n'existe pas encore de canal de notification sortant : ce bandeau, la vue
 * `document_integrity_alerts` qui l'alimente et la ligne de journal du contrôle
 * mensuel sont, pour l'instant, la totalité de l'alerte.
 */
export function IntegrityAlerts({
  alerts,
  canAcknowledge,
}: {
  readonly alerts: readonly IntegrityAlertRow[];
  readonly canAcknowledge: boolean;
}) {
  const t = useTranslations("documents.integrity");
  const tCommon = useTranslations("common.actions");
  const [pending, run] = useActionRunner();
  const [target, setTarget] = useState<IntegrityAlertRow | null>(null);
  const [note, setNote] = useState("");

  if (alerts.length === 0) return null;

  function submit(): void {
    const alert = target;
    if (alert === null) return;

    run(async () => {
      const outcome = await acknowledgeIntegrityAlertAction({ checkId: alert.id, note });
      if (outcome.status === "error") {
        toast.error(t("alertsTitle"));
        return;
      }
      toast.success(t("acknowledged"));
      setTarget(null);
      setNote("");
    });
  }

  return (
    <section
      // `alert` : un écart d'intégrité doit être annoncé aux lecteurs d'écran
      // dès l'arrivée sur la page, pas seulement dessiné en rouge.
      role="alert"
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-destructive">
        <ShieldAlert aria-hidden="true" className="size-4" />
        {t("alertsTitle")}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {t("alertsBody", { count: alerts.length })}
      </p>

      <ul className="mt-2 space-y-1">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-text-primary">{alert.originalFilename}</span>
            <span className="text-text-muted" data-numeric>
              {alert.obligationCode} · {alert.periodKey} ·{" "}
              {formatDateTimeFr(new Date(alert.checkedAt))}
            </span>
            <span className="text-destructive">
              {t(alert.status === "MISSING" ? "MISSING" : "MISMATCH")}
            </span>

            {canAcknowledge ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setTarget(alert);
                  setNote("");
                }}
              >
                {t("acknowledge")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("acknowledgeTitle")}</DialogTitle>
            <DialogDescription>{t("acknowledgeHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="integrity-note">{t("noteLabel")}</Label>
            <Textarea
              id="integrity-note"
              rows={3}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <p className="text-xs text-text-muted">{t("noteHint", { min: MIN_NOTE_LENGTH })}</p>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setTarget(null);
              }}
            >
              {tCommon("cancel")}
            </Button>
            <Button disabled={pending || note.trim().length < MIN_NOTE_LENGTH} onClick={submit}>
              {t("acknowledge")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
