"use client";

import { CalendarOff, ShieldCheck, UserRound, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/shared/user-avatar";
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
import { Textarea } from "@/components/ui/textarea";
import { reassignTriadAction } from "@/features/occurrences/actions/detail";
import { formatDateFr } from "@/lib/dates";
import type { AbsenceRow } from "@/services/absences";
import type { OccurrenceDetailView } from "@/services/occurrences/detail";

/**
 * Bloc d'affectation d'un dossier : les trois personnes et leur qualité.
 *
 * ⚠️ LE BANDEAU SUPPLÉANT N'EST PAS DÉCORATIF.
 *
 * Une personne désignée suppléante d'un dossier agit avec les mêmes droits que
 * le responsable — c'est le sens de sa fonction. Mais la TRACE portera
 * « suppléant », et la séparation des pouvoirs s'appuiera sur cette qualité :
 * qui a préparé ne peut pas valider. Agir sans le savoir, c'est se retrouver
 * bloqué plus tard sans comprendre pourquoi, ou pire, croire avoir agi à un
 * titre qu'on n'avait pas.
 *
 * ⚠️ LA DISPONIBILITÉ EST INDICATIVE, JAMAIS BLOQUANTE. « Absent jusqu'au 14/03 »
 * explique pourquoi un dossier n'avance pas ; cela ne retire aucun droit, et le
 * suppléant peut agir en permanence, absence déclarée ou non.
 */

const NOBODY = "__none__";

interface Assignee {
  readonly id: string | null;
  readonly name: string | null;
  readonly role: "RESPONSABLE" | "SUPPLEANT" | "SUPERVISEUR";
}

export function OccurrenceAssignment({
  detail,
  assignees,
  absences,
  currentUserId,
  canAssign,
}: {
  readonly detail: OccurrenceDetailView;
  readonly assignees: readonly { readonly id: string; readonly fullName: string }[];
  /** Absences EN COURS, toutes personnes confondues : le bloc y pioche les siennes. */
  readonly absences: readonly AbsenceRow[];
  readonly currentUserId: string;
  readonly canAssign: boolean;
}) {
  const t = useTranslations("occurrences.assignment");
  const tQuality = useTranslations("occurrences.actedAs");
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [ownerId, setOwnerId] = useState(detail.ownerId ?? NOBODY);
  const [deputyId, setDeputyId] = useState(detail.deputyId ?? NOBODY);
  const [validatorId, setValidatorId] = useState(detail.validatorId ?? NOBODY);
  const [reason, setReason] = useState("");

  const people: readonly Assignee[] = [
    { id: detail.ownerId, name: detail.ownerName, role: "RESPONSABLE" },
    { id: detail.deputyId, name: detail.deputyName, role: "SUPPLEANT" },
    { id: detail.validatorId, name: detail.validatorName, role: "SUPERVISEUR" },
  ];

  /*
   * ⚠️ SUPPLÉANT **ET PAS** RESPONSABLE. Le responsable qui est aussi son propre
   * suppléant — cas qu'une saisie ancienne peut avoir produit — agit en tant que
   * responsable : c'est ce que `resolve_acted_as()` décide en base, et le
   * bandeau doit dire la même chose que la trace, sans quoi il ment.
   */
  const actingAsDeputy = detail.deputyId === currentUserId && detail.ownerId !== currentUserId;

  function absenceOf(userId: string | null): AbsenceRow | undefined {
    if (userId === null) return undefined;
    return absences.find((absence) => absence.userId === userId);
  }

  function submit(): void {
    startTransition(async () => {
      const outcome = await reassignTriadAction({
        occurrenceId: detail.id,
        ownerId: ownerId === NOBODY ? null : ownerId,
        deputyId: deputyId === NOBODY ? null : deputyId,
        validatorId: validatorId === NOBODY ? null : validatorId,
        reason,
      });

      if (outcome.status === "success") {
        toast.success(t("saved"));
        setOpen(false);
        setReason("");
        // ⚠️ Aucun `router.refresh()` : la Server Action appelle
        // `revalidatePath`, ce qui suffit et évite le motif de navigation
        // interrompue que la suite doit corriger ailleurs.
        return;
      }
      toast.error(outcome.error.message);
    });
  }

  return (
    <section
      aria-labelledby="assignment-heading"
      className="mb-4 rounded-lg border border-border bg-surface p-4"
    >
      {actingAsDeputy ? (
        <div className="border-warning/30 bg-warning/10 mb-4 flex gap-3 rounded-md border p-3">
          <Users aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
          <p className="text-warning text-sm">
            {t("deputyBanner", { owner: detail.ownerName ?? t("unassigned") })}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="assignment-heading" className="text-sm font-semibold text-text-primary">
          {t("title")}
        </h2>
        {canAssign ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(true);
            }}
          >
            {t("reassign")}
          </Button>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        {people.map((person) => {
          const absence = absenceOf(person.id);
          const Icon =
            person.role === "RESPONSABLE"
              ? UserRound
              : person.role === "SUPPLEANT"
                ? Users
                : ShieldCheck;

          return (
            <div key={person.role}>
              <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-text-muted uppercase">
                <Icon aria-hidden="true" className="size-3.5" />
                {tQuality(person.role)}
              </dt>
              <dd className="mt-1.5">
                {person.name === null ? (
                  <span className="text-sm text-text-muted">{t("unassigned")}</span>
                ) : (
                  <>
                    <UserAvatar fullName={person.name} size="sm" showName />
                    {absence === undefined ? null : (
                      <p className="text-warning mt-1 flex items-center gap-1 text-2xs">
                        <CalendarOff aria-hidden="true" className="size-3" />
                        {t("absentUntil", {
                          // Midi UTC : assez loin des bornes du jour pour
                          // qu'aucun décalage de fuseau ne fasse afficher la
                          // veille.
                          date: formatDateFr(new Date(`${absence.endsAt}T12:00:00Z`)),
                        })}
                      </p>
                    )}
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reassign")}</DialogTitle>
            <DialogDescription>{t("reassignHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <PersonField
              id="assign-owner"
              label={tQuality("RESPONSABLE")}
              value={ownerId}
              onChange={setOwnerId}
              assignees={assignees}
              noneLabel={t("unassigned")}
            />
            <PersonField
              id="assign-deputy"
              label={tQuality("SUPPLEANT")}
              value={deputyId}
              onChange={setDeputyId}
              assignees={assignees}
              noneLabel={t("unassigned")}
            />
            <PersonField
              id="assign-validator"
              label={tQuality("SUPERVISEUR")}
              value={validatorId}
              onChange={setValidatorId}
              assignees={assignees}
              noneLabel={t("unassigned")}
            />

            <div>
              <Label htmlFor="assign-reason">{t("reason")}</Label>
              <Textarea
                id="assign-reason"
                rows={2}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-text-muted">{t("reasonHint")}</p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t("cancel")}
            </Button>
            {/*
             * Le bouton reste inerte tant que le motif est trop court : la base
             * refuserait de toute façon, autant le dire avant l'aller-retour.
             */}
            <Button disabled={pending || reason.trim().length < 3} onClick={submit}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PersonField({
  id,
  label,
  value,
  onChange,
  assignees,
  noneLabel,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly assignees: readonly { readonly id: string; readonly fullName: string }[];
  readonly noneLabel: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
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
