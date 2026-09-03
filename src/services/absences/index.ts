import "server-only";

/**
 * Absences — logique métier.
 *
 * ⚠️ LA RÈGLE QUE CE MODULE NE DOIT JAMAIS ENFREINDRE : une absence n'accorde et
 * ne retire AUCUN droit.
 *
 * Elle change l'acheminement des rappels — à qui l'on écrit quand une échéance
 * approche — et rien d'autre. Le suppléant tient ses permissions de son RÔLE, et
 * peut agir en permanence, absence déclarée ou non. Faire dépendre un droit
 * d'une déclaration créerait une habilitation qui s'accorde et se retire hors de
 * toute traçabilité de rôle, et un dossier bloqué le jour où personne n'a pensé
 * à déclarer.
 *
 * `is_absent_on()` n'est appelée par aucune politique RLS, et
 * `tests/integration/triad-registers-scenarios.test.ts` le vérifie
 * structurellement à chaque exécution.
 */

import { z } from "zod";

import { AppError } from "@/lib/errors";
import { err, type Result } from "@/lib/result";
import {
  insertAbsence,
  listAbsences,
  listCurrentAbsences,
  revokeAbsence,
  type AbsenceRow,
} from "@/data/queries/absences";
import {
  listAssignableProfiles,
  type AssignableProfileRow,
} from "@/data/queries/profiles-directory";
import { requireAuthContext, requirePermission } from "@/services/auth/context";

export type { AbsenceRow, AssignableProfileRow };

/**
 * Personnes à qui une absence peut être attribuée.
 *
 * ⚠️ Réservé à `absence.manage` : un compte qui ne peut déclarer que POUR
 * LUI-MÊME n'a aucun besoin de l'annuaire, et le lui servir reviendrait à
 * publier une liste nominative pour une action qu'il ne peut pas faire.
 */
export async function getAssignablePeople(): Promise<Result<readonly AssignableProfileRow[]>> {
  const context = await requirePermission("absence.manage");
  if (!context.ok) return context;

  return listAssignableProfiles();
}

export const AbsenceSchema = z
  .object({
    user_id: z.guid({ error: "validation.uuid" }),
    starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "validation.dateFormat" }),
    ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "validation.dateFormat" }),
    reason: z
      .string()
      .trim()
      .min(3, { error: "validation.tooShort" })
      .max(500, { error: "validation.tooLong" }),
  })
  .refine((value) => value.ends_at >= value.starts_at, {
    // Une absence qui finit avant de commencer ne lève aucune erreur en base et
    // ne s'affiche simplement jamais comme « en cours » : elle passerait pour
    // une déclaration oubliée.
    error: "validation.periodEndBeforeStart",
    path: ["ends_at"],
  });

export type AbsenceInput = z.infer<typeof AbsenceSchema>;

export async function getAbsences(): Promise<Result<readonly AbsenceRow[]>> {
  // Lecture ouverte : savoir qui est absent n'est pas confidentiel, c'est ce qui
  // permet de comprendre pourquoi un dossier n'avance pas.
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  return listAbsences();
}

export async function getCurrentAbsences(): Promise<Result<readonly AbsenceRow[]>> {
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  return listCurrentAbsences();
}

/**
 * Déclare une absence.
 *
 * ⚠️ DEUX CHEMINS D'AUTORISATION, et c'est la politique `user_absences_insert`
 * qui fait foi : `absence.manage` pour déclarer l'absence d'AUTRUI, ou n'importe
 * quel compte actif POUR LUI-MÊME. On refait ici la même distinction, pour que
 * le refus arrive avec un message plutôt que par un rejet de la base.
 */
export async function declareAbsence(input: unknown): Promise<Result<{ readonly id: string }>> {
  // Première barrière : une session active. La seconde — pour soi ou pour
  // autrui — est plus bas, parce qu'elle dépend de la personne visée.
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const parsed = AbsenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      AppError.validationFailed({ issues: parsed.error.issues.map((i) => i.path.join(".")) }),
    );
  }

  const soiMeme = parsed.data.user_id === context.value.userId;
  if (!soiMeme && !context.value.permissions.has("absence.manage")) {
    return err(AppError.forbidden({ details: { reason: "ABSENCE_FOR_OTHER" } }));
  }

  return insertAbsence(parsed.data, context.value.userId);
}

export async function revokeAbsenceEarly(id: string): Promise<Result<{ readonly id: string }>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  // La RLS tranche : l'intéressé pour lui-même, ou `absence.manage`. On la
  // laisse décider plutôt que de recopier sa condition ici.
  return revokeAbsence(id, context.value.userId);
}
