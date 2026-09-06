"use client";

import { CalendarClock, Info, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
import {
  deleteHolidayAction,
  importHolidaysAction,
  previewHolidayDeleteAction,
  previewHolidayImportAction,
  previewHolidaySaveAction,
  saveHolidayAction,
} from "@/features/admin/actions/admin";
import type { HolidayImportOutcome } from "@/features/admin/actions/types";
import { useActionRunner } from "@/hooks/use-action-runner";

/** Le changement proposé, tant qu'il n'est pas appliqué. */
export type HolidayIntent =
  | {
      readonly kind: "save";
      readonly holiday: {
        readonly date: string;
        readonly label: string;
        readonly isRecurring: boolean;
      };
    }
  | { readonly kind: "import"; readonly content: string }
  | { readonly kind: "delete"; readonly holidayId: string; readonly label: string };

interface Impact {
  readonly moved: number;
  readonly examined: number;
  readonly importable: number;
  readonly rejectedLines: readonly number[];
}

/**
 * Confirmation d'un changement de calendrier, IMPACT ANNONCÉ D'ABORD.
 *
 * ⚠️ CE QUI MANQUAIT. L'écran rendait compte APRÈS coup — « 12 échéances
 * déplacées » — quand il n'était plus temps de dire non. Or un jour férié ajouté
 * ou retiré décale des dates que des gens ont notées ailleurs : dans un agenda,
 * sur un tableau, dans leur tête. Le nombre doit être connu pendant qu'il est
 * encore possible de renoncer.
 *
 * ⚠️ COMPORTEMENT ARRÊTÉ. Seules les occurrences au statut TODO sont
 * recalculées. IN_PROGRESS, PENDING_VALIDATION, VALIDATED, SUBMITTED, ARCHIVED
 * et NOT_APPLICABLE ne bougent JAMAIS — on ne déplace pas le sol sous les pieds
 * de quelqu'un qui travaille. La fenêtre le DIT, plutôt que de le laisser
 * découvrir.
 *
 * L'impact est calculé PAR LE SERVEUR ; ce qui sera écrit est recalculé une
 * seconde fois à l'application. L'aperçu est un affichage, jamais une promesse.
 */
export function HolidayImpactDialog({
  intent,
  onOpenChange,
  onApplied,
}: {
  readonly intent: HolidayIntent | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApplied: (outcome: HolidayImportOutcome) => void;
}) {
  const t = useTranslations("admin.referentials.impact");

  const [impact, setImpact] = useState<Impact | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, run] = useActionRunner();

  useEffect(() => {
    if (intent === null) return;

    let cancelled = false;
    setImpact(null);
    setFailed(false);

    void previewFor(intent).then((outcome) => {
      if (cancelled) return;
      if (outcome.status === "success") setImpact(outcome.data);
      else setFailed(true);
    });

    // La fenêtre peut être refermée pendant le calcul : sans ce drapeau, la
    // réponse tardive écrirait dans un composant déjà démonté.
    return () => {
      cancelled = true;
    };
  }, [intent]);

  return (
    <AlertDialog
      open={intent !== null}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(intent === null ? "title" : `title_${intent.kind}`)}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>

        {failed ? (
          <p role="alert" className="text-sm text-status-overdue">
            {t("failed")}
          </p>
        ) : impact === null ? (
          <p className="text-sm text-text-muted">{t("loading")}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5">
              <CalendarClock
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-text-muted"
              />
              <p className="text-sm text-text-primary">
                {t("summary", { moved: impact.moved, examined: impact.examined })}
              </p>
            </div>

            {impact.rejectedLines.length > 0 ? (
              /*
                ⚠️ Les lignes illisibles sont montrées AVANT l'import, pas après :
                un fichier à moitié avalé produit un calendrier faux que personne
                ne saura faux, et c'est maintenant qu'on peut encore le corriger.
              */
              <div className="flex items-start gap-2 rounded-md border border-status-pending/40 bg-status-pending-bg px-3 py-2.5">
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-status-pending"
                />
                <p className="text-sm text-text-primary">
                  {t("rejected", {
                    count: impact.rejectedLines.length,
                    lines: impact.rejectedLines.slice(0, 10).join(", "),
                  })}
                </p>
              </div>
            ) : null}

            <div className="flex items-start gap-2 text-sm text-text-muted">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{t("protected")}</p>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || impact === null || intent === null}
            onClick={(event) => {
              // Le dialogue se referme de lui-même au clic : on l'en empêche
              // pour garder l'état « en cours » visible jusqu'à la réponse.
              event.preventDefault();
              if (intent === null) return;
              run(async () => {
                const outcome = await applyFor(intent);
                if (outcome.status === "error") {
                  setFailed(true);
                  return;
                }
                onApplied(outcome);
                onOpenChange(false);
              });
            }}
          >
            {pending ? t("applying") : t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function previewFor(intent: HolidayIntent) {
  switch (intent.kind) {
    case "save":
      return previewHolidaySaveAction(intent.holiday);
    case "import":
      return previewHolidayImportAction({ content: intent.content });
    case "delete":
      return previewHolidayDeleteAction({ holidayId: intent.holidayId });
  }
}

function applyFor(intent: HolidayIntent): Promise<HolidayImportOutcome> {
  switch (intent.kind) {
    case "save":
      return saveHolidayAction(intent.holiday);
    case "import":
      return importHolidaysAction({ content: intent.content });
    case "delete":
      return deleteHolidayAction({ holidayId: intent.holidayId, label: intent.label });
  }
}
