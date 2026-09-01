import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/layout/section";
import { ErrorState } from "@/components/shared/states";
import { AuditView } from "@/features/audit/components/audit-view";
import { AUDIT_PAGE_SIZE, DEFAULT_AUDIT_WINDOW_DAYS, getAuditPage } from "@/services/admin";
import { requireSectionAccess } from "@/services/navigation/guard";

const ACTIONS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "VIEW",
  "DOWNLOAD",
  "EXPORT",
  "PERMISSION_CHANGE",
  "UNLOCK",
  "MFA_RESET",
];

const TABLES = [
  "obligation_occurrences",
  "obligation_types",
  "documents",
  "occurrence_comments",
  "occurrence_checklist_items",
  "user_roles",
  "role_permissions",
  "profiles",
  "validation_delegations",
  "user_invitations",
  "holidays",
  "audit_log",
];

/**
 * Journal d'audit.
 *
 * ⚠️ Une FENÊTRE PAR DÉFAUT de 30 jours est appliquée quand l'utilisateur n'en
 * choisit pas. Ce n'est pas une commodité : `audit_log` est partitionnée par
 * mois, et sans borne sur `occurred_at`, PostgreSQL balaie toutes les partitions.
 * C'est cette borne qui garde l'écran réactif sur plusieurs millions de lignes.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionAccess("/audit");

  const t = await getTranslations("audit");
  const params = await searchParams;
  const first = (key: string): string | undefined => {
    const value = params[key];
    const resolved = Array.isArray(value) ? value[0] : value;
    return resolved === "" ? undefined : resolved;
  };

  const page = Math.max(0, Number.parseInt(first("page") ?? "0", 10) || 0);
  const defaultFrom = new Date(Date.now() - DEFAULT_AUDIT_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const from = first("from") ?? defaultFrom;

  const result = await getAuditPage({
    from: `${from}T00:00:00Z`,
    ...(first("to") === undefined ? {} : { to: `${String(first("to"))}T23:59:59Z` }),
    ...(first("action") === undefined ? {} : { action: first("action") }),
    ...(first("entity") === undefined ? {} : { entityTable: first("entity") }),
    ...(first("ip") === undefined ? {} : { ipAddress: first("ip") }),
    limit: AUDIT_PAGE_SIZE,
    offset: page * AUDIT_PAGE_SIZE,
  });

  if (!result.ok) {
    return (
      <>
        <SectionHeader titleKey="audit" descriptionKey="audit" />
        <ErrorState title={t("loadFailed")} />
      </>
    );
  }

  return (
    <>
      <SectionHeader titleKey="audit" descriptionKey="audit" />
      <AuditView
        rows={result.value.rows}
        total={result.value.total}
        page={page}
        pageSize={AUDIT_PAGE_SIZE}
        filters={{
          from,
          to: first("to") ?? "",
          action: first("action") ?? "",
          entityTable: first("entity") ?? "",
          ipAddress: first("ip") ?? "",
        }}
        actions={ACTIONS}
        tables={TABLES}
      />
    </>
  );
}
