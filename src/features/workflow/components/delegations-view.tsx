"use client";

import { Ban, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { MAX_DELEGATION_DAYS } from "@/config/constants";
import {
  createDelegationAction,
  revokeDelegationAction,
} from "@/features/workflow/actions/validation";
import { formatDateFr } from "@/lib/dates";
import type { DelegationRow } from "@/services/workflow/delegations";
import { useActionRunner } from "@/hooks/use-action-runner";

const MIN_REASON_LENGTH = 10;

interface Person {
  readonly id: string;
  readonly name: string;
}

/**
 * Délégations de validation.
 *
 * ⚠️ Une délégation est datée, motivée et révocable — le partage de compte n'est
 * rien de tout cela. C'est la raison d'être de cet écran : offrir la seule
 * réponse acceptable au « je pars en congé, prends mon mot de passe ».
 *
 * Les bornes affichées ici (90 jours, motif) sont RAPPELÉES, pas appliquées :
 * la contrainte vit en base, et l'interface se contente de ne pas laisser
 * saisir ce qui serait refusé.
 */
export function DelegationsView({
  delegations,
  people,
  domains,
  currentUserId,
  canDelegateForOthers,
}: {
  readonly delegations: readonly DelegationRow[];
  readonly people: readonly Person[];
  readonly domains: readonly { readonly id: string; readonly label: string }[];
  readonly currentUserId: string;
  readonly canDelegateForOthers: boolean;
}) {
  const t = useTranslations("workflow.delegations");
  const tActions = useTranslations("common.actions");

  const [pending, run] = useActionRunner();
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<DelegationRow | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    delegatorId: currentUserId,
    delegateId: "",
    domainId: "",
    startsAt: today,
    endsAt: "",
    reason: "",
  });

  const maxEnd = new Date(Date.now() + MAX_DELEGATION_DAYS * 86_400_000).toISOString().slice(0, 10);

  function submit(): void {
    run(async () => {
      const outcome = await createDelegationAction({
        delegatorId: form.delegatorId,
        delegateId: form.delegateId,
        domainId: form.domainId === "" ? null : form.domainId,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        reason: form.reason,
      });

      if (outcome.status === "error") {
        toast.error(t("createFailed"));
        return;
      }
      toast.success(t("created"));
      setOpen(false);
      setForm({ ...form, delegateId: "", endsAt: "", reason: "" });
    });
  }

  function revoke(): void {
    const target = revoking;
    if (target === null) return;

    run(async () => {
      const outcome = await revokeDelegationAction({
        delegationId: target.id,
        reason: revokeReason,
      });
      if (outcome.status === "error") {
        toast.error(t("revokeFailed"));
        return;
      }
      toast.success(t("revoked"));
      setRevoking(null);
      setRevokeReason("");
    });
  }

  const canSubmit =
    form.delegateId.length > 0 &&
    form.endsAt.length > 0 &&
    form.reason.trim().length >= MIN_REASON_LENGTH &&
    form.delegateId !== form.delegatorId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">{t("intro", { max: MAX_DELEGATION_DAYS })}</p>
        <Button
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          <UserCheck aria-hidden="true" className="size-4" />
          {t("create")}
        </Button>
      </div>

      {delegations.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <Th>{t("delegator")}</Th>
                <Th>{t("delegate")}</Th>
                <Th>{t("scope")}</Th>
                <Th>{t("period")}</Th>
                <Th>{t("reason")}</Th>
                <Th>{t("state")}</Th>
                <Th>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {delegations.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-text-primary">{row.delegatorName ?? "—"}</td>
                  <td className="px-3 py-2 text-text-primary">{row.delegateName ?? "—"}</td>
                  <td className="px-3 py-2 text-text-secondary">
                    {row.domainCode ?? t("allDomains")}
                  </td>
                  <td className="px-3 py-2 text-text-secondary" data-numeric>
                    {formatDateFr(new Date(`${row.startsAt}T12:00:00Z`))} →{" "}
                    {formatDateFr(new Date(`${row.endsAt}T12:00:00Z`))}
                  </td>
                  <td className="max-w-64 truncate px-3 py-2 text-text-secondary">{row.reason}</td>
                  <td className="px-3 py-2">
                    {/* ⚠️ Trois états distincts : active, révoquée, expirée. Les
                        confondre laisserait croire qu'une délégation périmée
                        prête encore des droits. */}
                    {row.revokedAt !== null ? (
                      <Badge variant="outline">{t("stateRevoked")}</Badge>
                    ) : row.isActive ? (
                      <Badge variant="outline" className="text-status-validated">
                        {t("stateActive")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-text-muted">
                        {t("stateExpired")}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.revokedAt === null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRevoking(row);
                          setRevokeReason("");
                        }}
                      >
                        <Ban aria-hidden="true" className="size-4" />
                        {t("revoke")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createHint", { max: MAX_DELEGATION_DAYS })}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {canDelegateForOthers ? (
              <div className="space-y-1.5">
                <Label>{t("delegator")}</Label>
                <Select
                  value={form.delegatorId}
                  onValueChange={(value) => {
                    setForm({ ...form, delegatorId: value });
                  }}
                >
                  <SelectTrigger aria-label={t("delegator")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>{t("delegate")}</Label>
              <Select
                value={form.delegateId}
                onValueChange={(value) => {
                  setForm({ ...form, delegateId: value });
                }}
              >
                <SelectTrigger aria-label={t("delegate")}>
                  <SelectValue placeholder={t("delegatePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {people
                    .filter((person) => person.id !== form.delegatorId)
                    .map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {domains.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{t("scope")}</Label>
                <Select
                  value={form.domainId}
                  onValueChange={(value) => {
                    setForm({ ...form, domainId: value === "__all__" ? "" : value });
                  }}
                >
                  <SelectTrigger aria-label={t("scope")}>
                    <SelectValue placeholder={t("allDomains")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("allDomains")}</SelectItem>
                    {domains.map((domain) => (
                      <SelectItem key={domain.id} value={domain.id}>
                        {domain.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="delegation-start">{t("startsAt")}</Label>
                <Input
                  id="delegation-start"
                  type="date"
                  value={form.startsAt}
                  onChange={(event) => {
                    setForm({ ...form, startsAt: event.target.value });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delegation-end">{t("endsAt")}</Label>
                {/* Date de fin OBLIGATOIRE et bornée : une délégation permanente
                    est une réorganisation, elle passe par les rôles. */}
                <Input
                  id="delegation-end"
                  type="date"
                  required
                  min={form.startsAt}
                  max={maxEnd}
                  value={form.endsAt}
                  onChange={(event) => {
                    setForm({ ...form, endsAt: event.target.value });
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="delegation-reason">{t("reason")}</Label>
              <Textarea
                id="delegation-reason"
                rows={2}
                value={form.reason}
                onChange={(event) => {
                  setForm({ ...form, reason: event.target.value });
                }}
              />
              <p className="text-xs text-text-muted">
                {t("reasonMin", { min: MIN_REASON_LENGTH })}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button disabled={!canSubmit || pending} onClick={submit}>
              {tActions("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next) setRevoking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("revokeTitle")}</DialogTitle>
            <DialogDescription>{t("revokeHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="revoke-reason">{t("reason")}</Label>
            <Textarea
              id="revoke-reason"
              rows={2}
              value={revokeReason}
              onChange={(event) => {
                setRevokeReason(event.target.value);
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRevoking(null);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || revokeReason.trim().length < MIN_REASON_LENGTH}
              onClick={revoke}
            >
              {t("revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-start text-xs font-medium tracking-wide text-text-muted uppercase">
      {children}
    </th>
  );
}
