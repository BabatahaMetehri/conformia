"use client";

import { KeyRound, ShieldOff, UserPlus, X } from "lucide-react";
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
import {
  cancelInvitationAction,
  deactivateUserAction,
  grantRoleAction,
  inviteUserAction,
  resetMfaAction,
  revokeRoleAction,
} from "@/features/admin/actions/admin";
import { formatDateTimeFr } from "@/lib/dates";
import type { InvitationRow, UserRow } from "@/services/admin";
import { useActionRunner } from "@/hooks/use-action-runner";

const MIN_REASON = 10;

interface Option {
  readonly id: string;
  readonly label: string;
  readonly maxDurationDays?: number | null;
}

/**
 * Comptes et habilitations.
 *
 * ⚠️ AUCUN CHAMP DE MOT DE PASSE, nulle part. Un compte se crée par INVITATION :
 * un mot de passe choisi par un administrateur est un mot de passe connu d'un
 * tiers, et la personne ne peut plus répondre de ce qui est fait sous son nom.
 * Toute la traçabilité du produit repose sur cette garantie.
 *
 * ⚠️ La désactivation exige un DESTINATAIRE dès que le compte porte du travail.
 * L'écran l'impose ; la base le garantit — le trigger refuse la désactivation
 * tant qu'il reste un dossier ouvert, et l'écran ne fait que l'annoncer avant.
 */
export function UsersView({
  users,
  invitations,
  roles,
  domains,
  departments,
  currentUserId,
}: {
  readonly users: readonly UserRow[];
  readonly invitations: readonly InvitationRow[];
  readonly roles: readonly Option[];
  readonly domains: readonly Option[];
  readonly departments: readonly Option[];
  readonly currentUserId: string;
}) {
  const t = useTranslations("admin.users");
  const tActions = useTranslations("common.actions");

  const [pending, runAction] = useActionRunner();
  const [inviting, setInviting] = useState(false);
  const [granting, setGranting] = useState<UserRow | null>(null);
  const [deactivating, setDeactivating] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [reason, setReason] = useState("");
  const [handoverTo, setHandoverTo] = useState("");

  const [invite, setInvite] = useState({
    email: "",
    fullName: "",
    departmentId: "",
    roleId: "",
    domainId: "",
    roleExpiresAt: "",
  });
  const [grant, setGrant] = useState({ roleId: "", domainId: "", expiresAt: "" });

  const roleById = (id: string): Option | undefined => roles.find((role) => role.id === id);
  const inviteRole = roleById(invite.roleId);
  const grantRole = roleById(grant.roleId);

  /** ⚠️ Expiration OBLIGATOIRE pour les rôles temporaires — la borne vient du
   *  référentiel (`roles.max_duration_days`), jamais d'une constante ici. */
  const inviteNeedsExpiry = (inviteRole?.maxDurationDays ?? null) !== null;
  const grantNeedsExpiry = (grantRole?.maxDurationDays ?? null) !== null;

  function run(action: Promise<{ status: string }>, success: string, done?: () => void): void {
    runAction(async () => {
      const outcome = await action;
      if (outcome.status === "error") {
        toast.error(t("failed"));
        return;
      }
      toast.success(success);
      done?.();
    });
  }

  const maxDate = (days: number | null | undefined): string | undefined =>
    days == null ? undefined : new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">{t("intro")}</p>
        <Button
          size="sm"
          onClick={() => {
            setInviting(true);
          }}
        >
          <UserPlus aria-hidden="true" className="size-4" />
          {t("invite")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <Th>{t("name")}</Th>
              <Th>{t("email")}</Th>
              <Th>{t("department")}</Th>
              <Th>{t("roles")}</Th>
              <Th>{t("mfa")}</Th>
              <Th>{t("lastLogin")}</Th>
              <Th>{t("state")}</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-border align-top last:border-0">
                <td className="px-3 py-2 text-text-primary">{user.fullName}</td>
                <td className="px-3 py-2 text-text-secondary">{user.email}</td>
                <td className="px-3 py-2 text-text-secondary">{user.departmentName ?? "—"}</td>
                <td className="px-3 py-2">
                  <ul className="space-y-1">
                    {user.roles.map((assignment) => (
                      <li key={assignment.id} className="flex items-center gap-1">
                        <Badge variant="outline">
                          {assignment.roleLabel}
                          {assignment.domainLabel === null ? "" : ` · ${assignment.domainLabel}`}
                        </Badge>
                        {assignment.expiresAt === null ? null : (
                          <span className="text-xs text-text-muted" data-numeric>
                            {t("until", { date: assignment.expiresAt.slice(0, 10) })}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={t("revokeRole", { role: assignment.roleLabel })}
                          className="text-text-muted hover:text-destructive"
                          onClick={() => {
                            run(
                              revokeRoleAction({ assignmentId: assignment.id }),
                              t("roleRevoked"),
                            );
                          }}
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </button>
                      </li>
                    ))}
                    {user.roles.length === 0 ? (
                      <li className="text-xs text-text-muted">{t("noRole")}</li>
                    ) : null}
                  </ul>
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{user.mfaEnrolled ? t("mfaOn") : t("mfaOff")}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary" data-numeric>
                  {user.lastLoginAt === null ? "—" : formatDateTimeFr(new Date(user.lastLoginAt))}
                </td>
                <td className="px-3 py-2">
                  {user.deactivatedAt === null ? (
                    <Badge variant="outline" className="text-status-validated">
                      {t("active")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-text-muted">
                      {t("deactivated")}
                    </Badge>
                  )}
                  {user.openTasks > 0 ? (
                    <p className="mt-1 text-xs text-text-muted">
                      {t("openTasks", { count: user.openTasks })}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setGranting(user);
                        setGrant({ roleId: "", domainId: "", expiresAt: "" });
                      }}
                    >
                      {t("addRole")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResetting(user);
                        setReason("");
                      }}
                    >
                      <KeyRound aria-hidden="true" className="size-4" />
                      {t("resetMfa")}
                    </Button>
                    {user.deactivatedAt === null && user.id !== currentUserId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDeactivating(user);
                          setReason("");
                          setHandoverTo("");
                        }}
                      >
                        <ShieldOff aria-hidden="true" className="size-4" />
                        {t("deactivate")}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-primary">{t("invitations")}</h2>
        {invitations.length === 0 ? (
          <EmptyState title={t("noInvitation")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <Th>{t("email")}</Th>
                  <Th>{t("name")}</Th>
                  <Th>{t("role")}</Th>
                  <Th>{t("sent")}</Th>
                  <Th>{t("state")}</Th>
                  <Th>{""}</Th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-text-primary">{row.email}</td>
                    <td className="px-3 py-2 text-text-secondary">{row.fullName}</td>
                    <td className="px-3 py-2 text-text-secondary">{row.roleLabel}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {/* ⚠️ « En file » n'est pas « envoyée » : l'envoi appartient
                          à la tâche planifiée, et l'écran ne prétend pas le contraire. */}
                      {row.dispatchedAt === null
                        ? t("queued")
                        : formatDateTimeFr(new Date(row.dispatchedAt))}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">
                        {row.acceptedAt !== null
                          ? t("accepted")
                          : row.cancelledAt !== null
                            ? t("cancelled")
                            : t("waiting")}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {row.acceptedAt === null && row.cancelledAt === null ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            run(
                              cancelInvitationAction({ invitationId: row.id }),
                              t("invitationCancelled"),
                            );
                          }}
                        >
                          {tActions("cancel")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Invitation ─────────────────────────────────────────────────────── */}
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inviteTitle")}</DialogTitle>
            <DialogDescription>{t("inviteHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Field label={t("email")} htmlFor="invite-email">
              <Input
                id="invite-email"
                type="email"
                value={invite.email}
                onChange={(event) => {
                  setInvite({ ...invite, email: event.target.value });
                }}
              />
            </Field>
            <Field label={t("name")} htmlFor="invite-name">
              <Input
                id="invite-name"
                value={invite.fullName}
                onChange={(event) => {
                  setInvite({ ...invite, fullName: event.target.value });
                }}
              />
            </Field>
            <Picker
              label={t("department")}
              value={invite.departmentId}
              options={departments}
              placeholder={t("noDepartment")}
              onChange={(value) => {
                setInvite({ ...invite, departmentId: value });
              }}
            />
            <Picker
              label={t("role")}
              value={invite.roleId}
              options={roles}
              placeholder={t("chooseRole")}
              allowEmpty={false}
              onChange={(value) => {
                setInvite({ ...invite, roleId: value });
              }}
            />
            <Picker
              label={t("domain")}
              value={invite.domainId}
              options={domains}
              placeholder={t("allDomains")}
              onChange={(value) => {
                setInvite({ ...invite, domainId: value });
              }}
            />
            {inviteNeedsExpiry ? (
              <Field label={t("expiresAt")} htmlFor="invite-expiry">
                <Input
                  id="invite-expiry"
                  type="date"
                  required
                  max={maxDate(inviteRole?.maxDurationDays)}
                  value={invite.roleExpiresAt}
                  onChange={(event) => {
                    setInvite({ ...invite, roleExpiresAt: event.target.value });
                  }}
                />
                <p className="text-xs text-text-muted">
                  {t("expiryRequired", { days: inviteRole?.maxDurationDays ?? 0 })}
                </p>
              </Field>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setInviting(false);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button
              disabled={
                pending ||
                invite.email.length === 0 ||
                invite.fullName.trim().length < 2 ||
                invite.roleId.length === 0 ||
                (inviteNeedsExpiry && invite.roleExpiresAt.length === 0)
              }
              onClick={() => {
                run(
                  inviteUserAction({
                    email: invite.email,
                    fullName: invite.fullName,
                    departmentId: invite.departmentId === "" ? null : invite.departmentId,
                    roleId: invite.roleId,
                    domainId: invite.domainId === "" ? null : invite.domainId,
                    roleExpiresAt: invite.roleExpiresAt === "" ? null : invite.roleExpiresAt,
                  }),
                  t("invited"),
                  () => {
                    setInviting(false);
                  },
                );
              }}
            >
              {t("invite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Attribution de rôle ────────────────────────────────────────────── */}
      <Dialog
        open={granting !== null}
        onOpenChange={(open) => {
          if (!open) setGranting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("grantTitle", { name: granting?.fullName ?? "" })}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Picker
              label={t("role")}
              value={grant.roleId}
              options={roles}
              placeholder={t("chooseRole")}
              allowEmpty={false}
              onChange={(value) => {
                setGrant({ ...grant, roleId: value });
              }}
            />
            <Picker
              label={t("domain")}
              value={grant.domainId}
              options={domains}
              placeholder={t("allDomains")}
              onChange={(value) => {
                setGrant({ ...grant, domainId: value });
              }}
            />
            {grantNeedsExpiry ? (
              <Field label={t("expiresAt")} htmlFor="grant-expiry">
                <Input
                  id="grant-expiry"
                  type="date"
                  required
                  max={maxDate(grantRole?.maxDurationDays)}
                  value={grant.expiresAt}
                  onChange={(event) => {
                    setGrant({ ...grant, expiresAt: event.target.value });
                  }}
                />
                <p className="text-xs text-text-muted">
                  {t("expiryRequired", { days: grantRole?.maxDurationDays ?? 0 })}
                </p>
              </Field>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setGranting(null);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button
              disabled={
                pending ||
                grant.roleId.length === 0 ||
                (grantNeedsExpiry && grant.expiresAt.length === 0)
              }
              onClick={() => {
                if (granting === null) return;
                run(
                  grantRoleAction({
                    userId: granting.id,
                    roleId: grant.roleId,
                    domainId: grant.domainId === "" ? null : grant.domainId,
                    expiresAt: grant.expiresAt === "" ? null : grant.expiresAt,
                    reason: null,
                  }),
                  t("roleGranted"),
                  () => {
                    setGranting(null);
                  },
                );
              }}
            >
              {tActions("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Désactivation ──────────────────────────────────────────────────── */}
      <Dialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("deactivateTitle", { name: deactivating?.fullName ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {(deactivating?.openTasks ?? 0) > 0
                ? t("handoverRequired", { count: deactivating?.openTasks ?? 0 })
                : t("deactivateHint")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(deactivating?.openTasks ?? 0) > 0 ? (
              <Picker
                label={t("handoverTo")}
                value={handoverTo}
                options={users
                  .filter((user) => user.id !== deactivating?.id && user.deactivatedAt === null)
                  .map((user) => ({ id: user.id, label: user.fullName }))}
                placeholder={t("chooseRecipient")}
                allowEmpty={false}
                onChange={setHandoverTo}
              />
            ) : null}
            <Field label={t("reason")} htmlFor="deactivate-reason">
              <Textarea
                id="deactivate-reason"
                rows={2}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              <p className="text-xs text-text-muted">{t("reasonMin", { min: MIN_REASON })}</p>
            </Field>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDeactivating(null);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                pending ||
                reason.trim().length < MIN_REASON ||
                ((deactivating?.openTasks ?? 0) > 0 && handoverTo.length === 0)
              }
              onClick={() => {
                if (deactivating === null) return;
                run(
                  deactivateUserAction({
                    userId: deactivating.id,
                    reason,
                    handoverTo: handoverTo === "" ? null : handoverTo,
                  }),
                  t("deactivated"),
                  () => {
                    setDeactivating(null);
                  },
                );
              }}
            >
              {t("deactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Réinitialisation MFA ───────────────────────────────────────────── */}
      <Dialog
        open={resetting !== null}
        onOpenChange={(open) => {
          if (!open) setResetting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resetMfaTitle", { name: resetting?.fullName ?? "" })}</DialogTitle>
            {/* Retirer le second facteur de quelqu'un est le geste qui permet de
                prendre sa place : la Direction en est informée, sans veto. */}
            <DialogDescription>{t("resetMfaHint")}</DialogDescription>
          </DialogHeader>

          <Field label={t("reason")} htmlFor="mfa-reason">
            <Textarea
              id="mfa-reason"
              rows={2}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p className="text-xs text-text-muted">{t("reasonMin", { min: MIN_REASON })}</p>
          </Field>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setResetting(null);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < MIN_REASON}
              onClick={() => {
                if (resetting === null) return;
                run(resetMfaAction({ userId: resetting.id, reason }), t("mfaReset"), () => {
                  setResetting(null);
                });
              }}
            >
              {t("resetMfa")}
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

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Picker({
  label,
  value,
  options,
  placeholder,
  onChange,
  allowEmpty = true,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly Option[];
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly allowEmpty?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          onChange(next === "__none__" ? "" : next);
        }}
      >
        {/* ⚠️ Un `<Label>` non rattaché ne nomme rien : le déclencheur Radix est
            un bouton, et sans `aria-label` il est annoncé « bouton » tout court. */}
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty ? <SelectItem value="__none__">{placeholder}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
