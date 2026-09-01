import "server-only";

/**
 * Administration : comptes, rôles, référentiels, réglages, journal.
 *
 * ⚠️ Ce module n'accorde ni ne refuse aucun droit. Toutes les gardes sensibles
 * vivent en base — auto-attribution, expiration obligatoire, réaffectation avant
 * désactivation, immuabilité des rôles système. Les contrôles présents ici sont
 * des refus PRÉCOCES, destinés à donner un message utile avant l'aller-retour ;
 * aucun n'est la garantie.
 */

import { MAX_UPLOAD_MB } from "@/config/constants";
import {
  listHolidays,
  listInvitations,
  listSettings,
  listUsers,
  loadReferentials,
  loadRoleMatrix,
  searchAuditLog,
  type AuditEntryRow,
  type AuditFilters,
  type AuditPage,
  type HolidayRow,
  type InvitationRow,
  type Referentials,
  type RoleMatrix,
  type SettingRow,
  type UserRow,
} from "@/data/queries/admin";
import {
  applyDueDateUpdates,
  cancelInvitation,
  deactivateUser,
  deleteHoliday,
  grantRole,
  insertInvitation,
  logAuditExport,
  resetMfa,
  revokeRole,
  setRolePermission,
  updateSetting,
  upsertHolidays,
  type HolidayInput,
} from "@/data/mutations/admin";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { requireAuthContext, requirePermission } from "@/services/auth/context";

export type {
  AuditEntryRow,
  AuditFilters,
  AuditPage,
  HolidayRow,
  InvitationRow,
  Referentials,
  RoleMatrix,
  SettingRow,
  UserRow,
};

const MIN_REASON_LENGTH = 10;

// ─── Comptes ─────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<Result<readonly UserRow[]>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;
  return listUsers();
}

export async function getInvitations(): Promise<Result<readonly InvitationRow[]>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;
  return listInvitations();
}

export interface InviteInput {
  readonly email: string;
  readonly fullName: string;
  readonly departmentId: string | null;
  readonly roleId: string;
  readonly domainId: string | null;
  readonly roleExpiresAt: string | null;
}

/**
 * Invite une personne.
 *
 * ⚠️ AUCUN MOT DE PASSE N'EST DÉFINI ICI, ni nulle part dans l'interface. Un mot
 * de passe choisi par un administrateur est un mot de passe connu d'un tiers :
 * la personne ne peut plus répondre de ce qui est fait sous son nom, et toute la
 * traçabilité du produit s'effondre avec cette garantie.
 *
 * L'invitation est INSCRITE ; la création du compte d'authentification et
 * l'envoi du courriel appartiennent à `src/server/jobs/`, seul endroit détenant
 * la clé de service. `dispatched_at` dit ce qui est réellement parti.
 */
export async function inviteUser(input: InviteInput): Promise<Result<string>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return err(AppError.validationFailed({ field: "email", reason: "INVALID_EMAIL" }));
  }
  if (input.fullName.trim().length < 2) {
    return err(AppError.validationFailed({ field: "fullName", reason: "NAME_TOO_SHORT" }));
  }

  return insertInvitation({
    email,
    fullName: input.fullName.trim(),
    departmentId: input.departmentId,
    roleId: input.roleId,
    domainId: input.domainId,
    roleExpiresAt: input.roleExpiresAt,
    invitedBy: context.value.userId,
  });
}

export async function withdrawInvitation(invitationId: string): Promise<Result<null>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;
  return cancelInvitation(invitationId);
}

export interface GrantInput {
  readonly userId: string;
  readonly roleId: string;
  readonly domainId: string | null;
  readonly expiresAt: string | null;
  readonly reason: string | null;
}

export async function assignRole(input: GrantInput): Promise<Result<string>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;

  // Refus précoce, doublé par le trigger de 0002 : le message est plus clair
  // ici, mais c'est la base qui garantit.
  if (input.userId === context.value.userId) {
    return err(AppError.forbidden({ details: { reason: "SELF_ROLE_ASSIGNMENT" } }));
  }

  return grantRole({
    userId: input.userId,
    roleId: input.roleId,
    domainId: input.domainId,
    expiresAt: input.expiresAt,
    grantedBy: context.value.userId,
    reason: input.reason,
  });
}

export async function withdrawRole(assignmentId: string): Promise<Result<null>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;
  return revokeRole(assignmentId, context.value.userId);
}

export async function deactivate(
  userId: string,
  reason: string,
  handoverTo: string | null,
): Promise<Result<number>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;

  if (reason.trim().length < MIN_REASON_LENGTH) {
    return err(AppError.validationFailed({ field: "reason", reason: "REASON_TOO_SHORT" }));
  }
  return deactivateUser(userId, reason.trim(), handoverTo);
}

export async function resetSecondFactor(userId: string, reason: string): Promise<Result<boolean>> {
  const context = await requirePermission("user.manage");
  if (!context.ok) return context;

  if (reason.trim().length < MIN_REASON_LENGTH) {
    return err(AppError.validationFailed({ field: "reason", reason: "REASON_TOO_SHORT" }));
  }
  return resetMfa(userId, reason.trim());
}

// ─── Matrice des rôles ───────────────────────────────────────────────────────

export async function getRoleMatrix(): Promise<Result<RoleMatrix>> {
  const context = await requirePermission("role.manage");
  if (!context.ok) return context;
  return loadRoleMatrix();
}

export async function toggleRolePermission(
  roleId: string,
  permissionId: string,
  granted: boolean,
): Promise<Result<null>> {
  const context = await requirePermission("role.manage");
  if (!context.ok) return context;
  return setRolePermission(roleId, permissionId, granted);
}

// ─── Référentiels ────────────────────────────────────────────────────────────

export async function getReferentials(): Promise<Result<Referentials>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;
  return loadReferentials();
}

export async function getHolidays(fromYear: number): Promise<Result<readonly HolidayRow[]>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;
  return listHolidays(fromYear);
}

/** Une ligne de CSV de jours fériés, telle qu'on l'accepte. */
export interface HolidayImportRow {
  readonly date: string;
  readonly label: string;
  readonly isRecurring: boolean;
}

export async function saveHolidays(
  rows: readonly HolidayImportRow[],
  source: string,
): Promise<Result<number>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  if (rows.length === 0) {
    return err(AppError.validationFailed({ reason: "EMPTY_IMPORT" }));
  }
  // Borne de volume : un import de jours fériés compte des dizaines de lignes,
  // pas des milliers. Au-delà, c'est un fichier qui n'est pas ce qu'on croit.
  if (rows.length > 500) {
    return err(AppError.validationFailed({ reason: "TOO_MANY_ROWS", max: 500 }));
  }

  const invalid = rows.find(
    (row) => !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.label.trim().length === 0,
  );
  if (invalid !== undefined) {
    return err(AppError.validationFailed({ reason: "INVALID_ROW", date: invalid.date }));
  }

  const payload: HolidayInput[] = rows.map((row) => ({
    date: row.date,
    label: row.label.trim(),
    isRecurring: row.isRecurring,
    source,
  }));

  return upsertHolidays(payload);
}

export async function removeHoliday(holidayId: string): Promise<Result<null>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;
  return deleteHoliday(holidayId);
}

export async function propagateDueDates(
  updates: readonly { occurrence_id: string; legal_due_date: string; internal_due_date: string }[],
  reason: string,
): Promise<Result<number>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;
  return applyDueDateUpdates(updates, reason);
}

// ─── Réglages ────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Result<readonly SettingRow[]>> {
  const context = await requirePermission("settings.manage");
  if (!context.ok) return context;
  return listSettings();
}

/**
 * Valide une valeur de réglage CONTRE SON TYPE DÉCLARÉ.
 *
 * ⚠️ Le type vient de `app_settings.value_type`, jamais d'une liste en dur : un
 * réglage ajouté demain est validé sans toucher à ce fichier.
 */
export function parseSettingValue(valueType: string, raw: string): Result<unknown> {
  const trimmed = raw.trim();

  switch (valueType) {
    case "boolean": {
      if (trimmed !== "true" && trimmed !== "false") {
        return err(AppError.validationFailed({ reason: "EXPECTED_BOOLEAN" }));
      }
      return ok(trimmed === "true");
    }
    case "integer": {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed)) {
        return err(AppError.validationFailed({ reason: "EXPECTED_INTEGER" }));
      }
      return ok(parsed);
    }
    case "array":
    case "object": {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const isArray = Array.isArray(parsed);
        if (valueType === "array" && !isArray) {
          return err(AppError.validationFailed({ reason: "EXPECTED_ARRAY" }));
        }
        if (valueType === "object" && (isArray || typeof parsed !== "object" || parsed === null)) {
          return err(AppError.validationFailed({ reason: "EXPECTED_OBJECT" }));
        }
        return ok(parsed);
      } catch {
        return err(AppError.validationFailed({ reason: "INVALID_JSON" }));
      }
    }
    case "string":
      return ok(trimmed);
    default:
      return err(AppError.validationFailed({ reason: "UNKNOWN_TYPE", valueType }));
  }
}

export async function saveSetting(key: string, rawValue: string): Promise<Result<null>> {
  const context = await requirePermission("settings.manage");
  if (!context.ok) return context;

  const settings = await listSettings();
  if (!settings.ok) return settings;

  const target = settings.value.find((setting) => setting.key === key);
  if (target === undefined) return err(AppError.notFound("setting", key));

  const parsed = parseSettingValue(target.valueType, rawValue);
  if (!parsed.ok) return parsed;

  return updateSetting(key, parsed.value);
}

// ─── Journal d'audit ─────────────────────────────────────────────────────────

/** Fenêtre par défaut. Voir `searchAuditLog` : elle conditionne l'élagage. */
export const DEFAULT_AUDIT_WINDOW_DAYS = 30;
export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

export async function getAuditPage(filters: AuditFilters): Promise<Result<AuditPage>> {
  const context = await requirePermission("audit.read");
  if (!context.ok) return context;
  return searchAuditLog(filters);
}

/**
 * Export CSV du journal.
 *
 * ⚠️ L'export est JOURNALISÉ avant d'être rendu : le seul geste capable de faire
 * sortir l'intégralité de la traçabilité de l'entreprise ne peut pas être le
 * seul à ne pas en laisser. Si la trace ne s'écrit pas, l'export n'a pas lieu.
 */
export async function exportAuditCsv(
  filters: AuditFilters,
): Promise<Result<{ readonly csv: string; readonly rowCount: number }>> {
  const context = await requirePermission("audit.read");
  if (!context.ok) return context;

  const page = await searchAuditLog({
    ...filters,
    limit: Math.min(filters.limit, AUDIT_EXPORT_MAX_ROWS),
    offset: 0,
  });
  if (!page.ok) return page;

  const logged = await logAuditExport(
    {
      from: filters.from ?? null,
      to: filters.to ?? null,
      action: filters.action ?? null,
      entityTable: filters.entityTable ?? null,
      actorId: filters.actorId ?? null,
    },
    page.value.rows.length,
  );
  if (!logged.ok) return logged;

  const header = [
    "occurred_at",
    "actor_email",
    "on_behalf_of",
    "action",
    "entity_table",
    "entity_id",
    "changed_fields",
    "ip_address",
  ];

  const lines = page.value.rows.map((row) =>
    [
      row.occurredAt,
      row.actorEmail ?? "",
      row.onBehalfOfId ?? "",
      row.action,
      row.entityTable,
      row.entityIdRef ?? "",
      row.changedFields.join(" "),
      row.ipAddress ?? "",
    ]
      .map(csvCell)
      .join(","),
  );

  return ok({
    csv: [header.join(","), ...lines].join("\r\n"),
    rowCount: page.value.rows.length,
  });
}

/**
 * Échappement CSV.
 *
 * ⚠️ Le préfixe apostrophe neutralise l'INJECTION DE FORMULE : une valeur
 * commençant par `=`, `+`, `-` ou `@` est exécutée par Excel à l'ouverture du
 * fichier. Un journal d'audit exporté pour un auditeur externe est exactement le
 * fichier qu'on ne veut pas voir exécuter du code sur son poste.
 */
function csvCell(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const escaped = (dangerous ? `'${value}` : value).replaceAll('"', '""');
  return `"${escaped}"`;
}

export { MAX_UPLOAD_MB };
