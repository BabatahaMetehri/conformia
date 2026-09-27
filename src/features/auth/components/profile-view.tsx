import { CalendarDays, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthContext } from "@/services/auth/context";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Fiche de l'utilisateur courant.
 *
 * ⚠️ ELLE MONTRE LES DROITS, ELLE N'EN ACCORDE AUCUN. Tout est en lecture : les
 * habilitations se modifient dans Administration, par quelqu'un qui détient
 * `user.manage`. Un écran où l'on voit ses propres rôles ET où l'on peut les
 * changer n'est plus un profil, c'est une élévation de privilège.
 *
 * ⚠️ Elle existe surtout pour répondre à UNE question, celle que le support
 * entend le plus souvent : « pourquoi je ne vois pas ce dossier ? ». Rôle,
 * domaine, échéance d'habilitation et délégations reçues y répondent d'un coup
 * d'œil, sans ouvrir la base.
 */

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="text-xs text-text-secondary sm:w-48 sm:shrink-0">{label}</dt>
      <dd className="text-sm text-text-primary">{children}</dd>
    </div>
  );
}

export async function ProfileView({
  context,
  domainLabels,
  roleLabels,
  departmentName,
}: {
  readonly context: AuthContext;
  /** Libellés des domaines, par identifiant — le contexte ne porte que des UUID. */
  readonly domainLabels: ReadonlyMap<string, string>;
  /*
   * ⚠️ Les libellés de rôle viennent de la BASE, pas d'un catalogue i18n.
   * `roles.label` est de la donnée au même titre que le référentiel : un rôle
   * ajouté par l'administration doit s'afficher sans déploiement.
   */
  readonly roleLabels: ReadonlyMap<string, string>;
  readonly departmentName: string | null;
}) {
  const t = await getTranslations("profile");
  const format = await getFormatter();

  const { profile, grants, mfa, delegations, permissions } = context;
  const displayName = profile.fullName ?? profile.email ?? "";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
        <UserAvatar fullName={displayName} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-text-primary">{displayName}</p>
          <p className="truncate text-sm text-text-secondary">{profile.email}</p>
        </div>
      </section>

      <section aria-labelledby="profile-identity">
        <h2 id="profile-identity" className="mb-2 text-sm font-medium text-text-primary">
          {t("identityTitle")}
        </h2>
        <dl className="rounded-lg border border-border bg-surface px-4 py-1">
          <Row label={t("fields.fullName")}>{profile.fullName ?? t("notProvided")}</Row>
          <Row label={t("fields.email")}>{profile.email ?? t("notProvided")}</Row>
          <Row label={t("fields.phone")}>{profile.phone ?? t("notProvided")}</Row>
          <Row label={t("fields.jobTitle")}>{profile.jobTitle ?? t("notProvided")}</Row>
          <Row label={t("fields.department")}>{departmentName ?? t("notProvided")}</Row>
        </dl>
        <p className="mt-2 text-xs text-text-muted">{t("identityHint")}</p>
      </section>

      <section aria-labelledby="profile-roles">
        <h2 id="profile-roles" className="mb-2 text-sm font-medium text-text-primary">
          {t("rolesTitle")}
        </h2>

        {grants.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-secondary">
            {t("noRoles")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {grants.map((grant) => (
              <li
                key={`${grant.roleCode}:${grant.domainId ?? "all"}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <Badge variant="secondary">
                  {roleLabels.get(grant.roleCode) ?? grant.roleCode}
                </Badge>
                <span className="text-text-secondary">
                  {/*
                    ⚠️ « Tous les domaines » n'est pas un défaut d'affichage :
                    `domain_id` à NULL signifie une portée globale, et le lecteur
                    doit pouvoir distinguer « aucun domaine » de « tous ».
                  */}
                  {grant.domainId === null
                    ? t("allDomains")
                    : (domainLabels.get(grant.domainId) ?? grant.domainId)}
                </span>
                {grant.expiresAt === null ? null : (
                  <span className="ms-auto text-xs text-due-soon" data-numeric>
                    {t("expiresOn", {
                      date: format.dateTime(new Date(grant.expiresAt), "short"),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-xs text-text-muted">
          {t("permissionCount", { count: permissions.size })}
        </p>
      </section>

      {delegations.length === 0 ? null : (
        <section aria-labelledby="profile-delegations">
          <h2 id="profile-delegations" className="mb-2 text-sm font-medium text-text-primary">
            {t("delegationsTitle")}
          </h2>
          <ul className="flex flex-col gap-2">
            {delegations.map((delegation) => (
              <li
                key={`${delegation.delegatorId}:${delegation.startsAt}`}
                className="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary"
              >
                {t("delegationRange", {
                  from: format.dateTime(new Date(delegation.startsAt), "short"),
                  to: format.dateTime(new Date(delegation.endsAt), "short"),
                })}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">{t("delegationsHint")}</p>
        </section>
      )}

      <section aria-labelledby="profile-security">
        <h2 id="profile-security" className="mb-2 text-sm font-medium text-text-primary">
          {t("securityTitle")}
        </h2>

        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-lg border p-4",
            mfa.enrolled
              ? "border-border bg-surface"
              : // Non enrôlé ET exigé : c'est un blocage imminent, pas une suggestion.
                mfa.required
                ? "border-destructive/40 bg-destructive/5"
                : "border-border bg-surface",
          )}
        >
          {mfa.enrolled ? (
            <ShieldCheck aria-hidden="true" className="size-5 text-due-far" />
          ) : (
            <ShieldAlert
              aria-hidden="true"
              className={cn("size-5", mfa.required ? "text-destructive" : "text-due-soon")}
            />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary">
              {mfa.enrolled ? t("mfa.enrolled") : t("mfa.notEnrolled")}
            </p>
            <p className="text-xs text-text-secondary">
              {mfa.enrolled
                ? t("mfa.enrolledHint")
                : mfa.required
                  ? t("mfa.requiredHint")
                  : t("mfa.suggestedHint")}
            </p>
          </div>

          {mfa.enrolled ? null : (
            <Button asChild size="sm" variant={mfa.required ? "default" : "outline"}>
              <Link href="/mfa/enroll">
                <KeyRound aria-hidden="true" className="size-4" />
                {t("mfa.enrol")}
              </Link>
            </Button>
          )}
        </div>

        <p className="mt-2 text-xs text-text-muted">{t("mfa.resetHint")}</p>
      </section>

      <section aria-labelledby="profile-calendar">
        <h2 id="profile-calendar" className="mb-2 text-sm font-medium text-text-primary">
          {t("calendarTitle")}
        </h2>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <CalendarDays aria-hidden="true" className="size-5 text-text-secondary" />
          <p className="min-w-0 flex-1 text-sm text-text-secondary">{t("calendarHint")}</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/profile/calendar">{t("calendarOpen")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
