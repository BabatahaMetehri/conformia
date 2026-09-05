"use client";

import { AlertTriangle, ShieldCheck, UserRound, Users } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countPropagableAction, saveAssignmentAction } from "@/features/obligations/actions";
import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * Onglet « Affectations » du référentiel : qui prend en charge cette obligation
 * par défaut.
 *
 * ⚠️ LA CONFIRMATION ANNONCE UN NOMBRE, PAS UNE INTENTION.
 *
 * « Des occurrences seront modifiées » ne permet de décider de rien. Le nombre
 * exact — obtenu de `count_propagable_occurrences()`, la même fonction que celle
 * qui borne la propagation — permet de mesurer ce qu'on s'apprête à faire. Et il
 * dit AUSSI ce qui ne bougera pas : les dossiers en cours de traitement gardent
 * leur responsable.
 *
 * ⚠️ ON NE PROPOSE JAMAIS DE PROPAGER AUX DOSSIERS ENGAGÉS. Un dossier commencé
 * a un responsable qui l'a commencé : le lui retirer parce que le référentiel a
 * changé casserait la séparation des pouvoirs — la trace dirait qu'il l'a
 * préparé, la ligne dirait qu'il ne s'en occupe pas — et ferait disparaître un
 * dossier de la liste de quelqu'un qui y travaillait. La règle vit dans
 * `propagate_default_assignment` ; l'écran ne fait que la refléter.
 */

const NOBODY = "__none__";

export interface AssignmentDefaults {
  readonly ownerId: string | null;
  readonly deputyId: string | null;
  readonly validatorId: string | null;
}

export function ObligationAssignmentTab({
  obligationTypeId,
  defaults,
  assignees,
  canManage,
}: {
  readonly obligationTypeId: string;
  readonly defaults: AssignmentDefaults;
  readonly assignees: readonly { readonly id: string; readonly fullName: string }[];
  readonly canManage: boolean;
}) {
  const t = useTranslations("obligations.assignment");
  const tQuality = useTranslations("occurrences.actedAs");
  const [pending, run] = useActionRunner();

  const [ownerId, setOwnerId] = useState(defaults.ownerId ?? NOBODY);
  const [deputyId, setDeputyId] = useState(defaults.deputyId ?? NOBODY);
  const [validatorId, setValidatorId] = useState(defaults.validatorId ?? NOBODY);

  const [confirming, setConfirming] = useState(false);
  const [propagable, setPropagable] = useState<number | null>(null);

  const chosen = [ownerId, deputyId, validatorId].filter((value) => value !== NOBODY);
  const distinct = new Set(chosen).size === chosen.length;
  /*
   * ⚠️ AVERTISSEMENT NON BLOQUANT. Une obligation sans suppléant fonctionne ; le
   * jour où le responsable est absent, personne ne reprend. On le signale, on ne
   * l'interdit pas : imposer un suppléant obligerait à en inventer un.
   */
  const missingDeputy = deputyId === NOBODY;

  const payload = {
    obligationTypeId,
    ownerId: ownerId === NOBODY ? null : ownerId,
    deputyId: deputyId === NOBODY ? null : deputyId,
    validatorId: validatorId === NOBODY ? null : validatorId,
  };

  /** Première étape : compter, puis demander. Jamais l'inverse. */
  function askConfirmation(): void {
    run(async () => {
      const counted = await countPropagableAction(obligationTypeId);
      // Un comptage indisponible ne doit pas empêcher d'enregistrer sans
      // propager : on ouvre la fenêtre en le disant plutôt qu'en le taisant.
      setPropagable(counted.status === "success" ? counted.data.count : null);
      setConfirming(true);
    });
  }

  function save(propagate: boolean): void {
    run(async () => {
      const outcome = await saveAssignmentAction({ ...payload, propagate });

      if (outcome.status === "success") {
        toast.success(
          propagate ? t("savedWithPropagation", { count: outcome.data.propagated }) : t("saved"),
        );
        setConfirming(false);
        // ⚠️ Aucun `router.refresh()` : la Server Action appelle
        // `revalidatePath`, ce qui suffit.
        return;
      }
      toast.error(outcome.error.message);
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-text-secondary">{t("description")}</p>

      <div className="space-y-4">
        <Field
          id="default-owner"
          icon={<UserRound aria-hidden="true" className="size-3.5" />}
          label={tQuality("RESPONSABLE")}
          value={ownerId}
          onChange={setOwnerId}
          assignees={assignees}
          noneLabel={t("unassigned")}
          disabled={!canManage || pending}
        />
        <Field
          id="default-deputy"
          icon={<Users aria-hidden="true" className="size-3.5" />}
          label={tQuality("SUPPLEANT")}
          value={deputyId}
          onChange={setDeputyId}
          assignees={assignees}
          noneLabel={t("unassigned")}
          disabled={!canManage || pending}
        />
        <Field
          id="default-validator"
          icon={<ShieldCheck aria-hidden="true" className="size-3.5" />}
          label={tQuality("SUPERVISEUR")}
          value={validatorId}
          onChange={setValidatorId}
          assignees={assignees}
          noneLabel={t("unassigned")}
          disabled={!canManage || pending}
        />
      </div>

      {distinct ? null : (
        <p className="border-danger/30 bg-danger/10 text-danger flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("notDistinct")}
        </p>
      )}

      {missingDeputy ? (
        <p className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("noDeputy")}
        </p>
      ) : null}

      {canManage ? (
        <Button disabled={pending || !distinct} onClick={askConfirmation}>
          {t("save")}
        </Button>
      ) : null}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>
              {propagable === null ? t("confirmUnknown") : t("confirmBody", { count: propagable })}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-text-secondary">{t("confirmUntouched")}</p>

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t("cancel")}
            </Button>
            {/*
             * Deux issues explicites : enregistrer seulement, ou enregistrer ET
             * propager. Un bouton unique obligerait à deviner lequel des deux on
             * déclenche.
             */}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                save(false);
              }}
            >
              {t("saveOnly")}
            </Button>
            <Button
              disabled={pending || propagable === null || propagable === 0}
              onClick={() => {
                save(true);
              }}
            >
              {t("saveAndPropagate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  id,
  icon,
  label,
  value,
  onChange,
  assignees,
  noneLabel,
  disabled,
}: {
  readonly id: string;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly assignees: readonly { readonly id: string; readonly fullName: string }[];
  readonly noneLabel: string;
  readonly disabled: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="mt-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NOBODY}>{noneLabel}</SelectItem>
          {assignees.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
