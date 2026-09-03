import "server-only";

/**
 * Fiche d'occurrence — orchestration.
 *
 * ⚠️ AUCUNE MACHINE À ÉTATS ICI. Les transitions ouvertes sont LUES en base
 * (status_transition_rules), leur autorisation est décidée par les triggers, et
 * la séparation des tâches est tranchée par `can_validate_occurrence()` — la
 * fonction que le trigger consulte lui-même. Ce module compose et présente ;
 * il ne décide d'aucun chemin de workflow (prompt 4.5).
 *
 * ⚠️ Aucun branchement sur un code d'obligation. Cet écran ne sait pas ce qu'est
 * un G50 (CLAUDE.md §3.5).
 */

import type { Criticality, OccurrenceStatus, Periodicity } from "@/config/constants";
import {
  canValidateOccurrence,
  getDependencyState,
  getSiblingById,
  getTransitionContext,
  getTransitionRule,
  isSelfValidationBlocked,
  listOccurrenceAuditEntries,
  listPreviousOccurrences,
  listRectifications,
  listTransitionsFrom,
  loadOccurrenceAggregate,
  type DependencyState,
  type SiblingOccurrence,
} from "@/data/queries/occurrence-detail";
import {
  applyTransition,
  createRectification as createRectificationRow,
  insertComment,
  reassignSingle,
  softDeleteComment,
  type LateReasonCode,
  type TransitionOutcome,
} from "@/data/mutations/occurrence-detail";
import { AppError } from "@/lib/errors";
import { formatISODateInAppTz } from "@/lib/dates";
import { err, ok, type Result } from "@/lib/result";
import { isPermission } from "@/config/permissions";
import { requireAuthContext, requirePermission } from "@/services/auth/context";
import { computeCompleteness, type Completeness } from "@/services/occurrences/completeness";
import { toOccurrenceId, toProfileId, type OccurrenceId } from "@/types/domain";

export type { Completeness, DependencyState, LateReasonCode, SiblingOccurrence };
export { computeCompleteness };

/** Nombre de périodes antérieures présentées. Un an de recul sur une mensuelle. */
const PREVIOUS_PERIOD_COUNT = 12;

// ─── Modèle de la fiche ──────────────────────────────────────────────────────

export interface AttachedDocumentView {
  readonly id: string;
  readonly checklistItemId: string | null;
  readonly originalFilename: string;
  readonly normalizedFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly version: number;
  readonly supersedesId: string | null;
  readonly documentKind: string | null;
  readonly uploadedAt: string;
  readonly uploaderName: string | null;
  /** Versions antérieures, de la plus récente à la plus ancienne. */
  readonly previousVersions: readonly AttachedDocumentView[];
}

export interface ChecklistLineView {
  readonly id: string;
  readonly label: string;
  readonly isMandatory: boolean;
  readonly documentKind: string | null;
  readonly orderIndex: number;
  readonly document: AttachedDocumentView | null;
}

export type TimelineKind = "TRANSITION" | "DOCUMENT" | "AUDIT";

export interface TimelineEntry {
  readonly id: string;
  readonly kind: TimelineKind;
  readonly occurredAt: string;
  readonly fromStatus: OccurrenceStatus | null;
  readonly toStatus: OccurrenceStatus | null;
  readonly actorName: string | null;
  /** Délégant, lorsque l'action a été faite au nom d'un autre. */
  readonly onBehalfOfName: string | null;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly changedFields: readonly string[];
}

export interface CommentView {
  readonly id: string;
  readonly body: string;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly mentionedUserIds: readonly string[];
  readonly createdAt: string;
  readonly isMine: boolean;
}

export interface AvailableTransition {
  readonly toStatus: OccurrenceStatus;
  readonly requiredPermission: string;
  readonly requiresReason: boolean;
  /** Libellé du référentiel, replié si une clé i18n existe pour le statut cible. */
  readonly label: string;
  readonly permitted: boolean;
}

export interface OccurrenceAbilities {
  readonly transitions: readonly AvailableTransition[];
  readonly canReassign: boolean;
  readonly canCreateRectification: boolean;
  readonly canUpload: boolean;
  readonly canDeleteDocument: boolean;
  readonly canReadAudit: boolean;
}

export interface OccurrenceDetailView {
  readonly id: string;
  readonly version: number;
  readonly periodKey: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: OccurrenceStatus;
  readonly legalDueDate: string;
  readonly internalDueDate: string;
  readonly daysToInternal: number;
  readonly daysToLegal: number;
  readonly isOverdue: boolean;
  readonly isInternallyLate: boolean;
  readonly isLocked: boolean;
  readonly referenceNumber: string | null;
  readonly naReason: string | null;
  readonly rejectionReason: string | null;
  readonly lateReason: string | null;
  readonly lateReasonCode: LateReasonCode | null;
  readonly penaltyIncurred: boolean;
  readonly rectificationIndex: number;

  readonly obligation: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly periodicity: Periodicity;
    readonly criticality: Criticality;
    readonly procedureMd: string | null;
    readonly legalBasis: string | null;
    readonly portalUrl: string | null;
    readonly requiresProof: boolean;
    readonly domainLabel: string | null;
    readonly authorityName: string | null;
    readonly authorityPortalUrl: string | null;
  };

  readonly ownerName: string | null;
  readonly ownerId: string | null;
  readonly validatorName: string | null;
  readonly validatorId: string | null;

  readonly checklist: readonly ChecklistLineView[];
  readonly documents: readonly AttachedDocumentView[];
  readonly completeness: Completeness;
  readonly timeline: readonly TimelineEntry[];
  readonly comments: readonly CommentView[];

  readonly dependency: DependencyState | null;
  readonly original: SiblingOccurrence | null;
  readonly rectifications: readonly SiblingOccurrence[];
  readonly previousPeriods: readonly SiblingOccurrence[];

  readonly abilities: OccurrenceAbilities;
}

// ─── Chargement ──────────────────────────────────────────────────────────────

/**
 * Agrégat complet du dossier.
 *
 * DEUX allers-retours : l'agrégat principal, les rectificatives, l'audit, la
 * dépendance et la question de validation partent ensemble ; les périodes
 * précédentes et l'occurrence d'origine suivent, faute de connaître leurs clés
 * avant la première réponse.
 */
export async function getOccurrenceDetail(id: string): Promise<Result<OccurrenceDetailView>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const occurrenceId = toOccurrenceId(id);

  const [aggregate, rectifications, audit, dependency, canValidate, selfBlocked] =
    await Promise.all([
      loadOccurrenceAggregate(occurrenceId),
      listRectifications(occurrenceId),
      listOccurrenceAuditEntries(occurrenceId),
      getDependencyState(occurrenceId),
      canValidateOccurrence(occurrenceId),
      isSelfValidationBlocked(occurrenceId),
    ]);

  if (!aggregate.ok) return aggregate;
  const row = aggregate.value;
  const type = row.obligation_types;

  const [previous, original, transitionRules] = await Promise.all([
    listPreviousOccurrences(row.obligation_type_id, row.period_key, PREVIOUS_PERIOD_COUNT),
    row.rectifies_occurrence_id === null
      ? Promise.resolve(ok(null))
      : getSiblingById(row.rectifies_occurrence_id),
    listTransitionsFrom(row.status),
  ]);

  const documents = buildDocumentTree(row.documents);
  const checklistItems = row.occurrence_checklist_items.map((item) => ({
    id: item.id,
    label: item.label,
    isMandatory: item.is_mandatory,
    orderIndex: item.order_index,
  }));

  const completeness = computeCompleteness(
    checklistItems,
    row.documents.map((document) => ({
      checklistItemId: document.checklist_item_id,
      // L'agrégat ne remonte que les pièces vivantes : la politique de lecture
      // de `documents` filtre déjà `deleted_at is null`.
      deletedAt: null,
    })),
  );

  const today = formatISODateInAppTz();
  const closedStatuses: readonly OccurrenceStatus[] = ["SUBMITTED", "ARCHIVED", "NOT_APPLICABLE"];
  const isClosed = closedStatuses.includes(row.status);

  return ok({
    id: row.id,
    version: row.version,
    periodKey: row.period_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    legalDueDate: row.legal_due_date,
    internalDueDate: row.internal_due_date,
    daysToInternal: daysBetween(today, row.internal_due_date),
    daysToLegal: daysBetween(today, row.legal_due_date),
    isOverdue: !isClosed && row.legal_due_date < today,
    isInternallyLate: !isClosed && row.internal_due_date < today,
    isLocked: row.is_locked,
    referenceNumber: row.reference_number,
    naReason: row.na_reason,
    rejectionReason: row.rejection_reason,
    lateReason: row.late_reason,
    lateReasonCode: row.late_reason_code,
    penaltyIncurred: row.penalty_incurred,
    rectificationIndex: row.rectification_index,

    obligation: {
      id: type.id,
      code: type.code,
      name: type.name,
      periodicity: type.periodicity,
      criticality: type.criticality,
      procedureMd: type.procedure_md,
      legalBasis: type.legal_basis,
      portalUrl: type.portal_url,
      requiresProof: type.requires_proof,
      // Le domaine est obligatoire depuis 0019 : la jointure rend toujours une
      // ligne, et un libellé absent n'est plus un cas à traiter.
      domainLabel: type.domains.label,
      authorityName: type.authorities?.name ?? null,
      authorityPortalUrl: type.authorities?.portal_url ?? null,
    },

    ownerId: row.owner_id,
    ownerName: row.owner?.full_name ?? null,
    validatorId: row.validator_id,
    validatorName: row.validator?.full_name ?? null,

    checklist: buildChecklist(row.occurrence_checklist_items, documents),
    documents,
    completeness,
    timeline: buildTimeline(row.occurrence_transitions, row.documents, audit.ok ? audit.value : []),
    comments: row.occurrence_comments
      .map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorId: comment.author_id,
        authorName: comment.author?.full_name ?? null,
        mentionedUserIds: comment.mentioned_user_ids,
        createdAt: comment.created_at,
        isMine: comment.author_id === context.value.userId,
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),

    dependency: dependency.ok ? dependency.value : null,
    original: original.ok ? original.value : null,
    rectifications: rectifications.ok ? rectifications.value : [],
    previousPeriods: previous.ok ? previous.value : [],

    abilities: {
      transitions: (transitionRules.ok ? transitionRules.value : []).map((rule) => ({
        toStatus: rule.toStatus,
        requiredPermission: rule.requiredPermission,
        requiresReason: rule.requiresReason,
        label: rule.label,
        permitted:
          // ⚠️ La validation ne se déduit PAS de la seule permission : la
          // séparation des tâches et le filet DIRECTION sont tranchés en base.
          // Le bouton reflète donc le verdict du trigger, jamais une seconde règle.
          rule.requiredPermission === "occurrence.validate"
            ? canValidate.ok && canValidate.value && !(selfBlocked.ok && selfBlocked.value)
            : isPermission(rule.requiredPermission) &&
              context.value.permissions.has(rule.requiredPermission),
      })),
      canReassign: context.value.permissions.has("occurrence.assign"),
      canCreateRectification:
        context.value.permissions.has("occurrence.write") &&
        (row.status === "SUBMITTED" || row.status === "ARCHIVED"),
      canUpload: context.value.permissions.has("document.upload") && !row.is_locked,
      canDeleteDocument: context.value.permissions.has("document.delete") && !row.is_locked,
      canReadAudit: context.value.permissions.has("audit.read"),
    },
  });
}

/** Périodes précédentes, exposé séparément pour l'onglet dédié. */
export async function getPreviousOccurrences(
  obligationTypeId: string,
  currentPeriodKey: string,
  limit = PREVIOUS_PERIOD_COUNT,
): Promise<Result<readonly SiblingOccurrence[]>> {
  const context = await requirePermission("occurrence.read");
  if (!context.ok) return context;

  return listPreviousOccurrences(obligationTypeId, currentPeriodKey, limit);
}

// ─── Composition ─────────────────────────────────────────────────────────────

interface RawDocument {
  readonly id: string;
  readonly checklist_item_id: string | null;
  readonly original_filename: string;
  readonly normalized_filename: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly version: number;
  readonly supersedes_id: string | null;
  readonly document_kind: string | null;
  readonly uploaded_at: string;
  readonly uploader: { readonly full_name: string | null } | null;
}

/**
 * Replie les versions antérieures sous la version courante.
 *
 * Une pièce remplacée n'est jamais écrasée : le nouveau document pointe vers
 * l'ancien par `supersedes_id`. La version COURANTE est donc celle que personne
 * ne remplace ; les autres se replient dessous, de la plus récente à la plus ancienne.
 */
function buildDocumentTree(rows: readonly RawDocument[]): readonly AttachedDocumentView[] {
  const bySuperseded = new Map<string, RawDocument>();
  for (const row of rows) {
    if (row.supersedes_id !== null) bySuperseded.set(row.supersedes_id, row);
  }

  const toView = (
    row: RawDocument,
    previousVersions: AttachedDocumentView[],
  ): AttachedDocumentView => ({
    id: row.id,
    checklistItemId: row.checklist_item_id,
    originalFilename: row.original_filename,
    normalizedFilename: row.normalized_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    version: row.version,
    supersedesId: row.supersedes_id,
    documentKind: row.document_kind,
    uploadedAt: row.uploaded_at,
    uploaderName: row.uploader?.full_name ?? null,
    previousVersions,
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  return rows
    .filter((row) => !bySuperseded.has(row.id))
    .map((current) => {
      const history: AttachedDocumentView[] = [];
      let cursor = current.supersedes_id;
      // Borne de sécurité : une chaîne cyclique serait un défaut de données, pas
      // une raison de faire tourner l'affichage indéfiniment.
      while (cursor !== null && history.length < rows.length) {
        const previous = byId.get(cursor);
        if (previous === undefined) break;
        history.push(toView(previous, []));
        cursor = previous.supersedes_id;
      }
      return toView(current, history);
    })
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

interface RawChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly is_mandatory: boolean;
  readonly document_kind: string | null;
  readonly order_index: number;
}

function buildChecklist(
  items: readonly RawChecklistItem[],
  documents: readonly AttachedDocumentView[],
): readonly ChecklistLineView[] {
  const byItem = new Map(
    documents
      .filter((document) => document.checklistItemId !== null)
      .map((document) => [document.checklistItemId as string, document]),
  );

  return [...items]
    .sort((left, right) => left.order_index - right.order_index)
    .map((item) => ({
      id: item.id,
      label: item.label,
      isMandatory: item.is_mandatory,
      documentKind: item.document_kind,
      orderIndex: item.order_index,
      document: byItem.get(item.id) ?? null,
    }));
}

interface RawTransition {
  readonly id: number;
  readonly from_status: OccurrenceStatus | null;
  readonly to_status: OccurrenceStatus;
  readonly reason: string | null;
  readonly created_at: string;
  readonly actor: { readonly full_name: string | null } | null;
  readonly on_behalf_of: { readonly full_name: string | null } | null;
}

interface RawAudit {
  readonly id: string;
  readonly action: string;
  readonly actorEmail: string | null;
  readonly changedFields: readonly string[];
  readonly occurredAt: string;
}

/**
 * Chronologie fusionnée.
 *
 * ⚠️ Les entrées d'audit portant un changement de STATUT sont écartées : elles
 * décrivent le même fait que la ligne de transition, en moins lisible. Les
 * autres — réaffectation, numéro de récépissé, motif de retard — n'ont pas
 * d'autre trace et sont conservées.
 */
function buildTimeline(
  transitions: readonly RawTransition[],
  documents: readonly RawDocument[],
  audit: readonly RawAudit[],
): readonly TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const transition of transitions) {
    entries.push({
      id: `transition:${String(transition.id)}`,
      kind: "TRANSITION",
      occurredAt: transition.created_at,
      fromStatus: transition.from_status,
      toStatus: transition.to_status,
      actorName: transition.actor?.full_name ?? null,
      onBehalfOfName: transition.on_behalf_of?.full_name ?? null,
      reason: transition.reason,
      detail: null,
      changedFields: [],
    });
  }

  for (const document of documents) {
    entries.push({
      id: `document:${document.id}`,
      kind: "DOCUMENT",
      occurredAt: document.uploaded_at,
      fromStatus: null,
      toStatus: null,
      actorName: document.uploader?.full_name ?? null,
      onBehalfOfName: null,
      reason: null,
      detail: document.original_filename,
      changedFields: [],
    });
  }

  for (const entry of audit) {
    if (entry.changedFields.includes("status")) continue;
    entries.push({
      id: `audit:${entry.id}`,
      kind: "AUDIT",
      occurredAt: entry.occurredAt,
      fromStatus: null,
      toStatus: null,
      actorName: entry.actorEmail,
      onBehalfOfName: null,
      reason: null,
      detail: entry.action,
      changedFields: entry.changedFields,
    });
  }

  return entries.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/** Écart en jours entre deux dates ISO, calendrier d'Alger. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T12:00:00.000Z`);
  const to = Date.parse(`${toIso}T12:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Longueur minimale d'un motif : « ok » n'explique rien à l'auditeur de 2029. */
const MIN_REASON_LENGTH = 10;

export interface TransitionInput {
  readonly occurrenceId: string;
  readonly toStatus: OccurrenceStatus;
  readonly expectedVersion: number;
  readonly reason?: string | undefined;
  readonly referenceNumber?: string | undefined;
  readonly lateReasonCode?: LateReasonCode | undefined;
  readonly lateReason?: string | undefined;
}

/**
 * Change l'état d'un dossier.
 *
 * ⚠️ La complétude est revérifiée EN BASE, par `apply_occurrence_transition`.
 * Le contrôle côté interface n'est qu'un confort : une Server Action est un
 * point d'entrée HTTP, appelable sans jamais ouvrir l'écran.
 */
export async function transitionOccurrence(
  input: TransitionInput,
): Promise<Result<TransitionOutcome>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const occurrenceId = toOccurrenceId(input.occurrenceId);

  const current = await getTransitionContext(occurrenceId);
  if (!current.ok) return current;

  /*
   * ⚠️ CONTRÔLE APPLICATIF DE LA PERMISSION, LU EN BASE.
   *
   * La permission exigée par la transition demandée vient de
   * status_transition_rules — jamais d'un littéral dans ce fichier. Écrire
   * `requirePermission("occurrence.submit")` ici créerait une seconde définition
   * du cycle de vie, qui divergerait de la table au premier ajout (CLAUDE.md §3.5).
   *
   * Ce contrôle PRÉCÈDE la base sans la remplacer : le trigger de transition
   * revérifie, domaine compris, et refuse en dernier ressort.
   */
  const rule = await getTransitionRule(current.value.status, input.toStatus);
  if (!rule.ok) return rule;
  if (rule.value === null) {
    return err(AppError.invalidTransition(current.value.status, input.toStatus));
  }

  if (isPermission(rule.value.requiredPermission)) {
    const permitted = await requirePermission(rule.value.requiredPermission);
    if (!permitted.ok) return permitted;
  }

  if (rule.value.requiresReason && (input.reason ?? "").trim().length < MIN_REASON_LENGTH) {
    return err(AppError.validationFailed({ field: "reason", reason: "REASON_TOO_SHORT" }));
  }

  return applyTransition({
    occurrenceId,
    toStatus: input.toStatus,
    expectedVersion: input.expectedVersion,
    reason: input.reason ?? null,
    referenceNumber: input.referenceNumber ?? null,
    lateReasonCode: input.lateReasonCode ?? null,
    lateReason: input.lateReason ?? null,
  });
}

export async function createRectification(
  occurrenceId: string,
  reason: string,
): Promise<Result<{ readonly id: string }>> {
  const context = await requirePermission("occurrence.write");
  if (!context.ok) return context;

  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    return err(AppError.validationFailed({ field: "reason", reason: "REASON_TOO_SHORT" }));
  }

  const created = await createRectificationRow(toOccurrenceId(occurrenceId), trimmed);
  if (!created.ok) return created;

  return ok({ id: created.value });
}

export async function postComment(
  occurrenceId: string,
  body: string,
  mentionedUserIds: readonly string[],
): Promise<Result<{ readonly id: string }>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 5000) {
    return err(AppError.validationFailed({ field: "body", reason: "BODY_LENGTH" }));
  }

  const inserted = await insertComment({
    occurrenceId: toOccurrenceId(occurrenceId),
    authorId: context.value.userId,
    body: trimmed,
    // ⚠️ Les mentions sont ENREGISTRÉES, pas notifiées : aucun canal de
    // notification n'existe encore. La colonne mentioned_user_ids est
    // précisément ce que le job de notification lira le jour venu.
    mentionedUserIds,
  });
  if (!inserted.ok) return inserted;

  return ok({ id: inserted.value });
}

export async function removeComment(commentId: string): Promise<Result<boolean>> {
  const context = await requireAuthContext();
  if (!context.ok) return context;

  // La politique d'écriture n'accepte que l'auteur : inutile de le revérifier ici,
  // et le refaire ouvrirait une seconde règle susceptible de diverger.
  return softDeleteComment(commentId);
}

export async function reassignOccurrence(
  occurrenceId: string,
  ownerId: string,
): Promise<Result<{ readonly updated: number }>> {
  const context = await requirePermission("occurrence.assign");
  if (!context.ok) return context;

  const updated = await reassignSingle(toOccurrenceId(occurrenceId), toProfileId(ownerId));
  if (!updated.ok) return updated;

  return ok({ updated: updated.value });
}

export type { OccurrenceId, TransitionOutcome };
