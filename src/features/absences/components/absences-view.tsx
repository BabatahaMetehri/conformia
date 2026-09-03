"use client";

import { Info, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { declareAbsenceAction, revokeAbsenceAction } from "@/features/absences/actions";
import { useRouter } from "@/i18n/navigation";
import { formatDateFr } from "@/lib/dates";
import type { AbsenceRow, AssignableProfileRow } from "@/services/absences";

/**
 * Écran des absences.
 *
 * ⚠️ LE RAPPEL EN TÊTE D'ÉCRAN N'EST PAS DÉCORATIF. « Déclarer une absence »
 * suggère naturellement qu'on transfère des droits — c'est ce que font la
 * plupart des outils. Ici, non : l'absence oriente les RAPPELS, et le suppléant
 * peut agir en permanence. Ne pas le dire laisserait quelqu'un attendre une
 * déclaration pour qu'un dossier avance, alors que rien ne l'empêchait.
 */

function calendarDate(iso: string): Date {
  // Midi UTC : assez loin des bornes du jour pour qu'aucun décalage de fuseau
  // ne fasse afficher la veille.
  return new Date(`${iso}T12:00:00Z`);
}

export function AbsencesView({
  absences,
  people,
  currentUserId,
  canManageOthers,
  today,
}: {
  readonly absences: readonly AbsenceRow[];
  readonly people: readonly AssignableProfileRow[];
  readonly currentUserId: string;
  readonly canManageOthers: boolean;
  /** Date du jour à Alger, calculée au SERVEUR : le poste client peut être ailleurs. */
  readonly today: string;
}) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [userId, setUserId] = useState(currentUserId);
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(today);
  const [reason, setReason] = useState("");

  function stateOf(row: AbsenceRow): "revoked" | "current" | "upcoming" | "past" {
    if (row.revokedAt !== null) return "revoked";
    if (row.isCurrent) return "current";
    return row.startsAt > today ? "upcoming" : "past";
  }

  function submit(): void {
    startTransition(async () => {
      const outcome = await declareAbsenceAction({
        user_id: userId,
        starts_at: startsAt,
        ends_at: endsAt,
        reason,
      });

      if (outcome.status === "success") {
        toast.success(t("form.created"));
        setOpen(false);
        setReason("");
        router.refresh();
        return;
      }
      toast.error(outcome.error?.message ?? "errors.internal");
    });
  }

  function revoke(id: string): void {
    startTransition(async () => {
      const outcome = await revokeAbsenceAction(id);
      if (outcome.status === "success") {
        toast.success(t("revoke.done"));
        router.refresh();
        return;
      }
      toast.error(outcome.error?.message ?? "errors.internal");
    });
  }

  return (
    <>
      <div className="bg-surface-muted mb-6 flex gap-3 rounded-lg border border-border p-4">
        <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-muted" />
        <div>
          <p className="font-medium text-text-primary">{t("notice.title")}</p>
          <p className="mt-1 max-w-prose text-sm text-text-secondary">{t("notice.body")}</p>
        </div>
      </div>

      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("declare")}
        </Button>
      </div>

      {absences.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.person")}</TableHead>
                <TableHead>{t("columns.period")}</TableHead>
                <TableHead>{t("columns.reason")}</TableHead>
                <TableHead>{t("columns.state")}</TableHead>
                <TableHead className="text-end">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {absences.map((row) => {
                const state = stateOf(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.userName}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateFr(calendarDate(row.startsAt))} —{" "}
                      {formatDateFr(calendarDate(row.endsAt))}
                    </TableCell>
                    <TableCell className="max-w-[24rem] truncate text-text-secondary">
                      {row.reason}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          state === "current"
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : undefined
                        }
                      >
                        {t(`state.${state}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {/*
                       * La révocation n'est proposée que sur ce qui peut encore
                       * l'être : une absence passée ou déjà révoquée n'oriente
                       * plus rien, et le bouton ne ferait qu'inviter à une
                       * action sans effet.
                       */}
                      {state === "current" || state === "upcoming" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            revoke(row.id);
                          }}
                        >
                          {t("revoke.action")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("declare")}</DialogTitle>
            <DialogDescription>{t("notice.body")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="absence-person">{t("form.person")}</Label>
              {canManageOthers ? (
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="absence-person" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="mt-1 text-sm text-text-muted">{t("form.selfOnly")}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="absence-start">{t("form.startsAt")}</Label>
                <Input
                  id="absence-start"
                  type="date"
                  value={startsAt}
                  onChange={(event) => {
                    setStartsAt(event.target.value);
                  }}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="absence-end">{t("form.endsAt")}</Label>
                <Input
                  id="absence-end"
                  type="date"
                  value={endsAt}
                  onChange={(event) => {
                    setEndsAt(event.target.value);
                  }}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="absence-reason">{t("form.reason")}</Label>
              <Textarea
                id="absence-reason"
                rows={2}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                className="mt-1"
              />
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
              {t("form.cancel")}
            </Button>
            <Button disabled={pending} onClick={submit}>
              {t("form.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
