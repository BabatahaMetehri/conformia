"use client";

import { Info, Lock, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toggleRolePermissionAction } from "@/features/admin/actions/admin";
import { useRouter } from "@/i18n/navigation";
import type { RoleMatrix } from "@/services/admin";

/**
 * Matrice rôles × permissions.
 *
 * ⚠️ Décocher une case RETIRE un droit à des comptes actifs. L'écran l'annonce
 * avec un NOMBRE avant d'agir : « cette réduction touche 4 comptes » se comprend,
 * « êtes-vous sûr ? » ne se comprend pas.
 *
 * ⚠️ Les rôles SYSTÈME gardent leurs permissions modifiables mais ne peuvent être
 * ni renommés ni supprimés : leur `code` est comparé en dur dans les fonctions
 * d'autorisation de la base, et le renommer romprait ces comparaisons en silence.
 */
export function RolesMatrix({ matrix }: { readonly matrix: RoleMatrix }) {
  const t = useTranslations("admin.roles");
  const tActions = useTranslations("common.actions");
  const router = useRouter();

  const [pending, startTransition] = useTransition();
  const [granted, setGranted] = useState<ReadonlySet<string>>(matrix.granted);
  const [confirming, setConfirming] = useState<{
    roleId: string;
    permissionId: string;
    roleLabel: string;
    permissionLabel: string;
    holders: number;
  } | null>(null);
  const [simulated, setSimulated] = useState("");

  const byCategory = useMemo(() => {
    const groups = new Map<string, typeof matrix.permissions>();
    for (const permission of matrix.permissions) {
      groups.set(permission.category, [...(groups.get(permission.category) ?? []), permission]);
    }
    return [...groups.entries()];
  }, [matrix]);

  function apply(roleId: string, permissionId: string, next: boolean): void {
    startTransition(async () => {
      const outcome = await toggleRolePermissionAction({ roleId, permissionId, granted: next });
      if (outcome.status === "error") {
        toast.error(t("failed"));
        return;
      }
      setGranted((current) => {
        const updated = new Set(current);
        const key = `${roleId}:${permissionId}`;
        if (next) updated.add(key);
        else updated.delete(key);
        return updated;
      });
      setConfirming(null);
      router.refresh();
    });
  }

  const simulatedRole = matrix.roles.find((role) => role.id === simulated);
  const simulatedPermissions = matrix.permissions.filter((permission) =>
    granted.has(`${simulated}:${permission.id}`),
  );

  return (
    <div className="space-y-4">
      {/*
       * ⚠️ NOTE EXPLICATIVE OBLIGATOIRE. Sans elle, un futur administrateur
       * « corrigerait » ce qu'il prendrait pour un oubli — et donnerait à ADMIN
       * l'accès aux déclarations fiscales et aux pièces sociales.
       */}
      <aside className="flex gap-3 rounded-lg border border-border bg-surface p-3">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-sm text-text-secondary">
          <p className="font-medium text-text-primary">{t("adminNoteTitle")}</p>
          <p className="mt-1">{t("adminNoteBody")}</p>
        </div>
      </aside>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="sticky start-0 bg-surface px-3 py-2 text-start text-xs font-medium tracking-wide text-text-muted uppercase">
                {t("permission")}
              </th>
              {matrix.roles.map((role) => (
                <th key={role.id} className="px-2 py-2 text-center align-bottom">
                  <span className="block text-xs font-medium text-text-primary">{role.label}</span>
                  <span className="mt-0.5 block text-xs text-text-muted" data-numeric>
                    {t("holders", { count: role.holders })}
                  </span>
                  {role.isSystem ? (
                    <Lock
                      aria-label={t("systemRole")}
                      className="mx-auto mt-1 size-3 text-text-muted"
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byCategory.map(([category, permissions]) => (
              <>
                <tr key={category} className="border-b border-border bg-surface-raised">
                  <td
                    colSpan={matrix.roles.length + 1}
                    className="px-3 py-1 text-xs font-medium tracking-wide text-text-muted uppercase"
                  >
                    {category}
                  </td>
                </tr>
                {permissions.map((permission) => (
                  <tr key={permission.id} className="border-b border-border last:border-0">
                    <td className="sticky start-0 bg-surface px-3 py-1.5 text-text-primary">
                      {permission.label}
                      <span className="ms-2 text-xs text-text-muted" data-numeric>
                        {permission.code}
                      </span>
                    </td>
                    {matrix.roles.map((role) => {
                      const key = `${role.id}:${permission.id}`;
                      const isGranted = granted.has(key);
                      return (
                        <td key={role.id} className="px-2 py-1.5 text-center">
                          <Checkbox
                            checked={isGranted}
                            disabled={pending}
                            aria-label={t("toggle", {
                              role: role.label,
                              permission: permission.label,
                            })}
                            onCheckedChange={() => {
                              // Une EXTENSION s'applique tout de suite ; une
                              // RÉDUCTION passe par un avertissement chiffré.
                              if (isGranted && role.holders > 0) {
                                setConfirming({
                                  roleId: role.id,
                                  permissionId: permission.id,
                                  roleLabel: role.label,
                                  permissionLabel: permission.label,
                                  holders: role.holders,
                                });
                                return;
                              }
                              apply(role.id, permission.id, !isGranted);
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">{t("simulatorTitle")}</h2>
        <p className="mt-0.5 mb-3 text-xs text-text-muted">{t("simulatorHint")}</p>

        <Select value={simulated} onValueChange={setSimulated}>
          {/* ⚠️ `aria-label` explicite : le titre visible au-dessus n'est PAS
              rattaché au contrôle, et un déclencheur qui n'affiche qu'un texte
              d'invite n'a aucun nom accessible. Constaté par axe. */}
          <SelectTrigger className="max-w-xs" aria-label={t("simulatorTitle")}>
            <SelectValue placeholder={t("chooseRole")} />
          </SelectTrigger>
          <SelectContent>
            {matrix.roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {simulatedRole === undefined ? null : (
          <div className="mt-3">
            <p className="text-sm text-text-secondary">
              {t("simulatorResult", {
                role: simulatedRole.label,
                count: simulatedPermissions.length,
              })}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1">
              {simulatedPermissions.map((permission) => (
                <li key={permission.id}>
                  <Badge variant="outline">{permission.label}</Badge>
                </li>
              ))}
            </ul>
            {simulatedPermissions.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">{t("simulatorEmpty")}</p>
            ) : null}
          </div>
        )}
      </section>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert aria-hidden="true" className="size-4 text-status-overdue" />
              {t("reductionTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("reductionBody", {
                permission: confirming?.permissionLabel ?? "",
                role: confirming?.roleLabel ?? "",
                count: confirming?.holders ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(null);
              }}
            >
              {tActions("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (confirming === null) return;
                apply(confirming.roleId, confirming.permissionId, false);
              }}
            >
              {t("reductionConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
