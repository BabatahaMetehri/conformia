import "server-only";

/**
 * Registres de commerce — logique métier.
 *
 * ⚠️ `register.manage` EST DISTINCTE DE `referential.manage`, et ce module est
 * l'endroit où cette distinction se tient. Radier un registre ÉTEINT la
 * génération de tous les dossiers qui en dépendent ; ce n'est pas le même
 * pouvoir que corriger le libellé d'une obligation, et cela ne s'obtient pas
 * avec la même permission (matrice de 0019).
 *
 * La lecture, elle, n'exige que `obligation.read` : les registres décrivent
 * l'entreprise, pas un dossier, et quiconque suit des échéances doit savoir de
 * quel établissement elles relèvent.
 */

import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { insertRegister, updateRegisterRow } from "@/data/mutations/registers";
import {
  getRegister,
  getRegisterCompliance,
  getRegisterTimeline,
  listRegisterDocuments,
  listRegisterObligations,
  listRegisters,
  listRegisterWilayas,
  type RegisterCompliance,
  type RegisterDocumentRow,
  type RegisterObligationRow,
  type RegisterRow,
  type RegisterTimelineEntry,
} from "@/data/queries/registers";
import { listOccurrencePage, listRegisterOccurrences } from "@/data/queries/occurrence-list";
import { parseOccurrenceFilters } from "@/services/occurrences/filters";
import { requirePermission } from "@/services/auth/context";
import { RegisterFiltersSchema, RegisterSchema } from "@/services/registers/schema";

export * from "@/services/registers/schema";

/*
 * ⚠️ LES TYPES SONT RÉEXPORTÉS ICI, et ce n'est pas une commodité. La couche UI
 * n'a pas le droit d'importer `src/data` — la règle est tenue par ESLint
 * (`import/no-restricted-paths`). Un composant qui importerait la forme d'une
 * ligne depuis la couche d'accès se lierait à la façon dont elle est LUE, et
 * changerait avec elle.
 */
export type {
  RegisterCompliance,
  RegisterDocumentRow,
  RegisterObligationRow,
  RegisterRow,
  RegisterTimelineEntry,
};
export type { OccurrenceListRow } from "@/services/occurrences";

// ─── Lecture ─────────────────────────────────────────────────────────────────

export async function listCommercialRegisters(
  rawFilters: unknown = {},
): Promise<Result<readonly RegisterRow[]>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  const parsed = RegisterFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) return err(AppError.validationFailed({ reason: "FILTERS_MALFORMED" }));

  return listRegisters({
    ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
    ...(parsed.data.registerType === undefined ? {} : { registerType: parsed.data.registerType }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.wilaya === undefined ? {} : { wilaya: parsed.data.wilaya }),
  });
}

export async function getCommercialRegister(id: string): Promise<Result<RegisterRow>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  const row = await getRegister(id);
  if (!row.ok) return row;
  if (row.value === null) return err(AppError.notFound("commercial_register", id));

  return ok(row.value);
}

export async function getRegisterWilayas(): Promise<Result<readonly string[]>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  return listRegisterWilayas();
}

export async function getRegisterChangelog(
  id: string,
): Promise<Result<readonly RegisterTimelineEntry[]>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  return getRegisterTimeline(id);
}

export async function getRegisterObligations(): Promise<Result<readonly RegisterObligationRow[]>> {
  const context = await requirePermission("obligation.read");
  if (!context.ok) return context;

  return listRegisterObligations();
}

export async function getRegisterDocuments(
  id: string,
): Promise<Result<readonly RegisterDocumentRow[]>> {
  const context = await requirePermission("document.read");
  if (!context.ok) return context;

  return listRegisterDocuments(id);
}

export async function getComplianceByRegister(): Promise<Result<readonly RegisterCompliance[]>> {
  const context = await requirePermission("export.generate");
  if (!context.ok) return context;

  return getRegisterCompliance();
}

/**
 * Historique COMPLET d'un registre : toutes ses occurrences, toutes périodes.
 *
 * ⚠️ Un registre RADIÉ rend le même historique qu'un registre actif. Une
 * radiation arrête la génération à venir ; elle ne réécrit pas le passé, et les
 * déclarations déposées pour cet établissement doivent rester consultables —
 * c'est précisément quand un établissement ferme qu'on a besoin de prouver ce
 * qu'il a déposé.
 */
export async function getRegisterHistory(
  id: string,
  rawFilters: Record<string, string | string[] | undefined> = {},
): ReturnType<typeof listOccurrencePage> {
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  /*
   * ⚠️ ICI, ET SEULEMENT ICI, LE REGISTRE EST EXCLUSIF.
   *
   * Ailleurs — échéancier, documents, rapports — sélectionner un registre
   * montre ses dossiers PLUS ceux de toute l'entreprise. Sur la FICHE d'un
   * registre, non : on regarde cet établissement. Y mêler la TVA de
   * l'entreprise fausserait son taux de conformité et ferait croire qu'il porte
   * des obligations qui ne sont pas les siennes.
   *
   * On passe donc par `registerScoped` plutôt que par le filtre `register` du
   * schéma, dont la sémantique est délibérément inclusive.
   */
  const filters = parseOccurrenceFilters({
    ...rawFilters,
    // Tri chronologique inverse : sur un historique, le récent d'abord.
    sort: "internal_due_date",
    direction: "desc",
  });

  return listRegisterOccurrences(id, filters, context.value.userId);
}

// ─── Écriture ────────────────────────────────────────────────────────────────

export async function currentUserCanManageRegisters(): Promise<boolean> {
  const context = await requirePermission("register.manage");
  return context.ok;
}

export async function createRegister(input: unknown): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("register.manage");
  if (!context.ok) return context;

  const parsed = RegisterSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      AppError.validationFailed({ issues: parsed.error.issues.map((i) => i.path.join(".")) }),
    );
  }

  /*
   * ⚠️ `id` EST ÉCARTÉ DE LA CHARGE. Le schéma l'accepte parce que le même objet
   * sert au formulaire de modification ; l'écrire à l'insertion laisserait le
   * client CHOISIR l'identifiant d'un registre — et donc écraser un registre
   * existant en devinant son identifiant.
   */
  const { id: _submitted, ...payload } = parsed.data;
  void _submitted;
  return insertRegister(payload, context.value.userId);
}

export async function updateRegister(
  id: string,
  input: unknown,
): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("register.manage");
  if (!context.ok) return context;

  const parsed = RegisterSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      AppError.validationFailed({ issues: parsed.error.issues.map((i) => i.path.join(".")) }),
    );
  }

  // L'identifiant vient du CHEMIN, jamais du corps : un `id` glissé dans la
  // charge viserait un autre registre que celui qu'on croit modifier.
  const { id: _submitted, ...payload } = parsed.data;
  void _submitted;
  return updateRegisterRow(id, payload, context.value.userId);
}
