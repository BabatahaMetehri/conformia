/**
 * Schéma de saisie d'une obligation — UNIQUE, partagé client et serveur.
 *
 * ⚠️ PAS de `server-only` : c'est tout l'intérêt. Le formulaire le résout via
 * `zodResolver`, la Server Action le rejoue avant d'appeler le service. Deux
 * schémas se répondant l'un l'autre divergeraient au premier champ ajouté, et
 * c'est le client — le moins fiable des deux — qui semblerait avoir raison.
 *
 * Le service ne fait donc AUCUNE confiance au client : il revalide. La
 * validation côté navigateur ne sert qu'à afficher l'erreur avant l'aller-retour.
 */

import { z } from "zod";

import { Criticality, DocumentKind, Periodicity } from "@/config/constants";
import { DueRuleSchema } from "@/services/scheduling/due-rule";
import { uuidSchema } from "@/lib/schemas";

/** Longueurs alignées sur ce qu'un écran dense peut afficher sans tronquer. */
const CODE_MAX = 40;
const NAME_MAX = 160;
const LABEL_MAX = 160;

/**
 * Le code identifie l'obligation dans les échanges humains (« le G50 »). Majuscules,
 * chiffres, tiret et sous-tiret : il finit dans des noms de fichiers et des exports.
 */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

export const RequiredDocumentSchema = z.object({
  /** Absent à la création, présent à la mise à jour d'une pièce existante. */
  id: uuidSchema.optional(),
  label: z.string().trim().min(1).max(LABEL_MAX),
  description: z.string().trim().max(1000).nullable().default(null),
  is_mandatory: z.boolean().default(true),
  document_kind: z.enum(DocumentKind).nullable().default(null),
  max_size_mb: z.int().min(1).max(100).default(25),
});

export type RequiredDocumentInput = z.input<typeof RequiredDocumentSchema>;
export type RequiredDocumentValues = z.infer<typeof RequiredDocumentSchema>;

/**
 * Base commune à la création et à la mise à jour.
 *
 * `order_index` n'y figure pas : l'ordre des pièces est la position dans le
 * tableau. Le laisser saisir ouvrirait la porte à deux pièces au même rang, que
 * la contrainte unique en base refuserait — l'utilisateur verrait une erreur
 * technique pour une manipulation qui, à l'écran, semblait légitime.
 */
export const ObligationTypeBaseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(CODE_MAX)
    .regex(CODE_PATTERN, { message: "validation.codeFormat" }),
  name: z.string().trim().min(3).max(NAME_MAX),
  domain_id: uuidSchema.nullable().default(null),
  authority_id: uuidSchema.nullable().default(null),

  periodicity: z.enum(Periodicity),
  due_rule: DueRuleSchema,
  internal_lead_days: z.int().min(0).max(365).default(0),

  procedure_md: z.string().max(20_000).nullable().default(null),
  legal_basis: z.string().trim().max(500).nullable().default(null),
  portal_url: z.url().max(500).nullable().default(null),

  default_owner_id: uuidSchema.nullable().default(null),
  default_validator_id: uuidSchema.nullable().default(null),

  criticality: z.enum(Criticality),
  requires_validation: z.boolean().default(true),
  validation_levels: z.int().min(1).max(2).default(1),
  requires_proof: z.boolean().default(true),
  allow_self_validation: z.boolean().default(false),

  depends_on_obligation_type_id: uuidSchema.nullable().default(null),

  generation_horizon_months: z.int().min(1).max(60).default(18),
  retention_years: z.int().min(1).max(50).default(10),

  effective_from: z.iso.date(),
  effective_to: z.iso.date().nullable().default(null),

  required_documents: z.array(RequiredDocumentSchema).max(50).default([]),
});

/**
 * Contrôles qui portent sur PLUSIEURS champs à la fois. Ils sont ici, et non
 * dans le service, pour que le formulaire les affiche sans aller-retour — et
 * dans le service aussi, puisqu'il rejoue ce même schéma.
 */
function refineObligation(
  values: z.infer<typeof ObligationTypeBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (values.effective_to !== null && values.effective_to < values.effective_from) {
    ctx.addIssue({
      code: "custom",
      path: ["effective_to"],
      message: "validation.effectiveRangeReversed",
    });
  }

  // Une auto-validation n'a de sens que si une validation est demandée.
  if (!values.requires_validation && values.validation_levels > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["validation_levels"],
      message: "validation.validationLevelsWithoutValidation",
    });
  }

  const labels = new Set<string>();
  values.required_documents.forEach((document, index) => {
    const key = document.label.toLocaleLowerCase("fr");
    if (labels.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["required_documents", index, "label"],
        message: "validation.duplicateRequiredDocument",
      });
    }
    labels.add(key);
  });
}

export const CreateObligationTypeSchema = ObligationTypeBaseSchema.superRefine(refineObligation);

export const UpdateObligationTypeSchema = ObligationTypeBaseSchema.extend({
  id: uuidSchema,
  /**
   * Version lue à l'ouverture du formulaire. Le service refuse l'écriture si la
   * ligne a bougé depuis : deux personnes qui éditent la même obligation ne
   * doivent pas s'écraser en silence.
   */
  expected_version: z.int().min(1).optional(),
}).superRefine(refineObligation);

export type CreateObligationTypeInput = z.input<typeof CreateObligationTypeSchema>;
export type CreateObligationTypeValues = z.infer<typeof CreateObligationTypeSchema>;
export type UpdateObligationTypeInput = z.input<typeof UpdateObligationTypeSchema>;
export type UpdateObligationTypeValues = z.infer<typeof UpdateObligationTypeSchema>;

// ─── Filtres de liste ────────────────────────────────────────────────────────

export const ObligationListFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  domain_id: uuidSchema.optional(),
  authority_id: uuidSchema.optional(),
  periodicity: z.enum(Periodicity).optional(),
  criticality: z.enum(Criticality).optional(),
  /** Absent = les deux. La liste n'est jamais filtrée à l'insu de l'utilisateur. */
  is_active: z.boolean().optional(),
});

export type ObligationListFilters = z.infer<typeof ObligationListFiltersSchema>;

// ─── Actions de cycle de vie ─────────────────────────────────────────────────

export const ToggleActiveSchema = z.object({
  id: uuidSchema,
  is_active: z.boolean(),
});

export const DuplicateObligationSchema = z.object({
  id: uuidSchema,
  code: z
    .string()
    .trim()
    .min(2)
    .max(CODE_MAX)
    .regex(CODE_PATTERN, { message: "validation.codeFormat" }),
  name: z.string().trim().min(3).max(NAME_MAX),
});

export const RecalculationSchema = z.object({
  id: uuidSchema,
  /** Confirmée explicitement par l'utilisateur, jamais déduite d'un défaut. */
  confirmed: z.literal(true),
});
