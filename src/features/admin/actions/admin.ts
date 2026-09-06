"use server";

/**
 * Server Actions de l'administration.
 *
 * ⚠️ Aucune ne décide d'un droit. Chacune appelle le service, qui appelle la
 * base, où vivent les gardes : auto-attribution de rôle, expiration obligatoire,
 * réaffectation avant désactivation, immuabilité des rôles système. Une
 * vérification faite ici et nulle part ailleurs serait contournée par un appel
 * direct.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  CountOutcome,
  HolidayImpactOutcome,
  HolidayImportOutcome,
  IdOutcome,
  PlainAdminOutcome,
} from "@/features/admin/actions/types";
import { toClientError } from "@/lib/errors";
import {
  assignRole,
  deactivate,
  inviteUser,
  removeHoliday,
  resetSecondFactor,
  saveHolidays,
  saveSetting,
  toggleRolePermission,
  withdrawInvitation,
  withdrawRole,
} from "@/services/admin";
import {
  parseHolidayCsv,
  previewHolidayChange,
  recalculateForHolidayChange,
} from "@/services/admin/holidays";
import { uuidSchema } from "@/lib/schemas";

const USERS_PATH = "/[locale]/(app)/admin/users";
const ROLES_PATH = "/[locale]/(app)/admin/roles";
const REFERENTIALS_PATH = "/[locale]/(app)/admin/referentials";
const SETTINGS_PATH = "/[locale]/(app)/admin/settings";

const invalid = () => ({
  status: "error" as const,
  error: {
    code: "VALIDATION_FAILED" as const,
    message: "errors.validationFailed",
    httpStatus: 422,
  },
});

// ─── Comptes ─────────────────────────────────────────────────────────────────

const InviteSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(2).max(200),
  departmentId: uuidSchema.nullable(),
  roleId: uuidSchema,
  domainId: uuidSchema.nullable(),
  roleExpiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export async function inviteUserAction(input: unknown): Promise<IdOutcome> {
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await inviteUser({
    ...parsed.data,
    roleExpiresAt:
      parsed.data.roleExpiresAt === null ? null : `${parsed.data.roleExpiresAt}T23:59:59Z`,
  });
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(USERS_PATH, "page");
  return { status: "success", data: { id: result.value } };
}

export async function cancelInvitationAction(input: unknown): Promise<PlainAdminOutcome> {
  const parsed = z.object({ invitationId: uuidSchema }).safeParse(input);
  if (!parsed.success) return invalid();

  const result = await withdrawInvitation(parsed.data.invitationId);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(USERS_PATH, "page");
  return { status: "success", data: null };
}

const GrantSchema = z.object({
  userId: uuidSchema,
  roleId: uuidSchema,
  domainId: uuidSchema.nullable(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  reason: z.string().trim().max(2000).nullable(),
});

export async function grantRoleAction(input: unknown): Promise<IdOutcome> {
  const parsed = GrantSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await assignRole({
    ...parsed.data,
    expiresAt: parsed.data.expiresAt === null ? null : `${parsed.data.expiresAt}T23:59:59Z`,
  });
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(USERS_PATH, "page");
  return { status: "success", data: { id: result.value } };
}

export async function revokeRoleAction(input: unknown): Promise<PlainAdminOutcome> {
  const parsed = z.object({ assignmentId: uuidSchema }).safeParse(input);
  if (!parsed.success) return invalid();

  const result = await withdrawRole(parsed.data.assignmentId);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(USERS_PATH, "page");
  return { status: "success", data: null };
}

const DeactivateSchema = z.object({
  userId: uuidSchema,
  reason: z.string().trim().min(10).max(2000),
  handoverTo: uuidSchema.nullable(),
});

export async function deactivateUserAction(input: unknown): Promise<CountOutcome> {
  const parsed = DeactivateSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await deactivate(parsed.data.userId, parsed.data.reason, parsed.data.handoverTo);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(USERS_PATH, "page");
  return { status: "success", data: result.value };
}

const MfaSchema = z.object({
  userId: uuidSchema,
  reason: z.string().trim().min(10).max(2000),
});

export async function resetMfaAction(input: unknown): Promise<PlainAdminOutcome> {
  const parsed = MfaSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await resetSecondFactor(parsed.data.userId, parsed.data.reason);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(USERS_PATH, "page");
  return { status: "success", data: null };
}

// ─── Matrice des rôles ───────────────────────────────────────────────────────

const ToggleSchema = z.object({
  roleId: uuidSchema,
  permissionId: uuidSchema,
  granted: z.boolean(),
});

export async function toggleRolePermissionAction(input: unknown): Promise<PlainAdminOutcome> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await toggleRolePermission(
    parsed.data.roleId,
    parsed.data.permissionId,
    parsed.data.granted,
  );
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(ROLES_PATH, "page");
  return { status: "success", data: null };
}

// ─── Jours fériés ────────────────────────────────────────────────────────────

const HolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().trim().min(1).max(200),
  isRecurring: z.boolean(),
});

/**
 * Enregistre un jour férié, puis RECALCULE les échéances qu'il déplace.
 *
 * ⚠️ Les deux gestes vont ensemble. Ajouter un jour chômé sans propager le
 * report laisserait des échéances tombant un jour où personne ne travaille —
 * c'est-à-dire des retards fabriqués par l'outil censé les éviter.
 */
export async function saveHolidayAction(input: unknown): Promise<HolidayImportOutcome> {
  const parsed = HolidaySchema.safeParse(input);
  if (!parsed.success) return invalid();

  const saved = await saveHolidays([parsed.data], "Saisie manuelle");
  if (!saved.ok) return { status: "error", error: toClientError(saved.error) };

  const recalculated = await recalculateForHolidayChange(
    `Jour férié ajouté : ${parsed.data.label} (${parsed.data.date})`,
  );

  revalidatePath(REFERENTIALS_PATH, "page");
  return {
    status: "success",
    data: {
      imported: saved.value,
      rejectedLines: [],
      recalculated: recalculated.ok ? recalculated.value : 0,
    },
  };
}

const ImportSchema = z.object({ content: z.string().min(1).max(200_000) });

/**
 * ─── ANNONCER AVANT D'AGIR ───────────────────────────────────────────────────
 *
 * ⚠️ CES TROIS ACTIONS N'ÉCRIVENT RIEN. Chacune répond à une seule question :
 * combien d'échéances ce changement déplacerait-il ?
 *
 * Un jour férié ajouté, importé ou retiré décale des dates que des gens ont
 * notées ailleurs — dans un agenda, sur un tableau, dans leur tête. L'écran
 * rendait compte APRÈS : « 12 échéances déplacées », quand il n'était plus temps
 * de dire non. Le nombre doit être connu pendant qu'il est encore possible de
 * renoncer.
 *
 * L'impact est calculé PAR LE SERVEUR, à partir de l'état réel de la base. Ce
 * qui sera écrit est recalculé une seconde fois à l'application : l'aperçu est
 * un affichage, jamais une promesse.
 */

export async function previewHolidaySaveAction(input: unknown): Promise<HolidayImpactOutcome> {
  const parsed = HolidaySchema.safeParse(input);
  if (!parsed.success) return invalid();

  const impact = await previewHolidayChange({ added: [parsed.data] });
  if (!impact.ok) return { status: "error", error: toClientError(impact.error) };

  return {
    status: "success",
    data: { ...impact.value, importable: 1, rejectedLines: [] },
  };
}

export async function previewHolidayImportAction(input: unknown): Promise<HolidayImpactOutcome> {
  const parsed = ImportSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const { rows, rejected } = parseHolidayCsv(parsed.data.content);

  // Un fichier dont rien n'est lisible ne déplace rien : inutile d'interroger la
  // base pour le dire, et les lignes rejetées sont montrées quand même.
  if (rows.length === 0) {
    return {
      status: "success",
      data: { moved: 0, examined: 0, importable: 0, rejectedLines: rejected },
    };
  }

  const impact = await previewHolidayChange({ added: rows });
  if (!impact.ok) return { status: "error", error: toClientError(impact.error) };

  return {
    status: "success",
    data: { ...impact.value, importable: rows.length, rejectedLines: rejected },
  };
}

export async function previewHolidayDeleteAction(input: unknown): Promise<HolidayImpactOutcome> {
  const parsed = z.object({ holidayId: uuidSchema }).safeParse(input);
  if (!parsed.success) return invalid();

  const impact = await previewHolidayChange({ removedId: parsed.data.holidayId });
  if (!impact.ok) return { status: "error", error: toClientError(impact.error) };

  return {
    status: "success",
    data: { ...impact.value, importable: 0, rejectedLines: [] },
  };
}

export async function importHolidaysAction(input: unknown): Promise<HolidayImportOutcome> {
  const parsed = ImportSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const { rows, rejected } = parseHolidayCsv(parsed.data.content);
  if (rows.length === 0) {
    return {
      status: "success",
      data: { imported: 0, rejectedLines: rejected, recalculated: 0 },
    };
  }

  const saved = await saveHolidays(rows, "Import CSV");
  if (!saved.ok) return { status: "error", error: toClientError(saved.error) };

  const recalculated = await recalculateForHolidayChange(
    `Import du calendrier des jours fériés (${String(saved.value)} entrées)`,
  );

  revalidatePath(REFERENTIALS_PATH, "page");
  return {
    status: "success",
    data: {
      imported: saved.value,
      rejectedLines: rejected,
      recalculated: recalculated.ok ? recalculated.value : 0,
    },
  };
}

export async function deleteHolidayAction(input: unknown): Promise<HolidayImportOutcome> {
  const parsed = z.object({ holidayId: uuidSchema, label: z.string() }).safeParse(input);
  if (!parsed.success) return invalid();

  const removed = await removeHoliday(parsed.data.holidayId);
  if (!removed.ok) return { status: "error", error: toClientError(removed.error) };

  const recalculated = await recalculateForHolidayChange(
    `Jour férié retiré : ${parsed.data.label}`,
  );

  revalidatePath(REFERENTIALS_PATH, "page");
  return {
    status: "success",
    data: {
      imported: 0,
      rejectedLines: [],
      recalculated: recalculated.ok ? recalculated.value : 0,
    },
  };
}

// ─── Réglages ────────────────────────────────────────────────────────────────

const SettingSchema = z.object({
  key: z.string().trim().min(1).max(100),
  value: z.string().max(10_000),
});

export async function saveSettingAction(input: unknown): Promise<PlainAdminOutcome> {
  const parsed = SettingSchema.safeParse(input);
  if (!parsed.success) return invalid();

  const result = await saveSetting(parsed.data.key, parsed.data.value);
  if (!result.ok) return { status: "error", error: toClientError(result.error) };

  revalidatePath(SETTINGS_PATH, "page");
  return { status: "success", data: null };
}
