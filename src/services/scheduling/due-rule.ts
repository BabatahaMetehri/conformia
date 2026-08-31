/**
 * Règle d'échéance : forme, validation, valeurs par défaut.
 *
 * ⚠️ CE MODULE N'A PAS `server-only`, et c'est délibéré. La prévisualisation en
 * direct recalcule à chaque frappe : la faire transiter par le serveur
 * imposerait un aller-retour par caractère. Le même code s'exécute donc dans le
 * navigateur et dans le moteur de génération.
 *
 * Il n'accède à aucune base, ne lit aucune session, ne journalise rien. Tout ce
 * dont il a besoin lui est passé — y compris les jours fériés.
 *
 * ⚠️ Ces règles doublent la contrainte SQL `is_valid_due_rule()` (0001). Ce n'est
 * pas une duplication accidentelle : la contrainte est le dernier rempart, elle
 * ne sait dire que « non ». Cette validation-ci, elle, produit une clé i18n
 * exploitable et attrape des incohérences que le CHECK ne voit pas.
 */

import { z } from "zod";

import { DateShift, DueAnchor, Periodicity } from "@/config/constants";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";

// ─── Forme ───────────────────────────────────────────────────────────────────

/**
 * Champs en `snake_case` : c'est la forme EXACTE du JSONB stocké en base. Une
 * conversion camelCase à la frontière ajouterait un mapping à maintenir, et un
 * endroit de plus où la forme peut diverger du schéma.
 */
export const CustomOccurrenceSchema = z.object({
  month: z.int().min(1).max(12),
  day: z.int().min(1).max(31),
});

export const DueRuleSchema = z.object({
  anchor: z.enum(DueAnchor),
  /**
   * Peut être négatif : un renouvellement d'agrément se prépare AVANT
   * l'expiration du titre (`EXPIRY_DATE` avec `offset_days: -90`).
   */
  offset_days: z.int().min(-3650).max(3650).optional(),
  offset_months: z.int().min(-120).max(120).optional(),
  /** Décalage d'année pour `FIXED_DATE` : un bilan déposé l'année suivante. */
  year_offset: z.int().min(-10).max(10).optional(),
  fixed_month: z.int().min(1).max(12).optional(),
  fixed_day: z.int().min(1).max(31).optional(),
  /*
   * Par défaut, une échéance tombant un jour chômé est REPOUSSÉE. C'est la règle
   * administrative courante, et l'inverse ferait tomber l'échéance avant terme.
   * Le défaut est appliqué à l'écriture : la règle stockée porte toujours les
   * deux valeurs, aucune ne reste implicite dans le JSONB.
   */
  weekend_shift: z.enum(DateShift).default(DateShift.NEXT_BUSINESS_DAY),
  holiday_shift: z.enum(DateShift).default(DateShift.NEXT_BUSINESS_DAY),
  occurrences: z.array(CustomOccurrenceSchema).optional(),
});

export type DueRule = z.infer<typeof DueRuleSchema>;
export type DueRuleInput = z.input<typeof DueRuleSchema>;
export type CustomOccurrence = z.infer<typeof CustomOccurrenceSchema>;

// ─── Cohérence périodicité ↔ ancre ───────────────────────────────────────────

/**
 * Ancres dont la date de référence est portée par L'OCCURRENCE et non par le
 * calendrier : elles exigent une date d'ancrage pour être calculées.
 */
export const EVENT_DRIVEN_ANCHORS: readonly DueAnchor[] = [
  DueAnchor.EXPIRY_DATE,
  DueAnchor.EVENT_DATE,
];

export function isEventDrivenAnchor(anchor: DueAnchor): boolean {
  return EVENT_DRIVEN_ANCHORS.includes(anchor);
}

/**
 * Périodicités compatibles avec `FIXED_DATE`.
 *
 * Une date civile fixe ne se répète qu'une fois par an. Associée à MONTHLY, les
 * douze périodes de 2026 rendraient toutes le 31/03/2026 : douze dossiers
 * distincts pour une seule échéance. Ce n'est pas une règle réglementaire que
 * l'on invente, c'est une incohérence arithmétique du modèle.
 */
const FIXED_DATE_PERIODICITIES: readonly Periodicity[] = [Periodicity.ANNUAL, Periodicity.BIENNIAL];

/** Ancres acceptables pour une périodicité CUSTOM : la période est un seul jour. */
const CUSTOM_ANCHORS: readonly DueAnchor[] = [DueAnchor.PERIOD_START, DueAnchor.PERIOD_END];

// ─── Validation ──────────────────────────────────────────────────────────────

export interface DueRuleValidationInput {
  readonly rule: unknown;
  readonly periodicity: Periodicity;
}

function invalid(reason: string, details: Record<string, unknown> = {}): AppError {
  return AppError.validationFailed({ field: "due_rule", reason, ...details });
}

/**
 * Valide une règle : structure, puis cohérence avec la périodicité.
 *
 * Rend `Result` et jamais d'exception : une règle mal saisie est un cas nominal
 * de l'interface, pas un bug (cf. CLAUDE.md §3.3).
 */
export function validateDueRule({ rule, periodicity }: DueRuleValidationInput): Result<DueRule> {
  const parsed = DueRuleSchema.safeParse(rule);
  if (!parsed.success) {
    return err(
      invalid("DUE_RULE_MALFORMED", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      }),
    );
  }

  const value = parsed.data;

  // ── Exigences propres à l'ancre ────────────────────────────────────────────

  if (value.anchor === DueAnchor.FIXED_DATE) {
    if (value.fixed_month === undefined || value.fixed_day === undefined) {
      return err(invalid("FIXED_DATE_REQUIRES_MONTH_AND_DAY"));
    }
    if (!FIXED_DATE_PERIODICITIES.includes(periodicity)) {
      return err(invalid("FIXED_DATE_REQUIRES_ANNUAL_PERIODICITY", { periodicity }));
    }
  } else if (value.offset_days === undefined) {
    // Toutes les autres ancres se calculent par décalage : sans `offset_days`,
    // la règle ne dit pas à quelle distance de son point d'ancrage elle tombe.
    return err(invalid("OFFSET_DAYS_REQUIRED", { anchor: value.anchor }));
  }

  if (value.anchor !== DueAnchor.FIXED_DATE && value.fixed_month !== undefined) {
    return err(invalid("FIXED_FIELDS_ONLY_FOR_FIXED_DATE", { anchor: value.anchor }));
  }

  // ── Exigences propres à la périodicité ─────────────────────────────────────

  if (periodicity === Periodicity.CUSTOM) {
    if (value.occurrences === undefined || value.occurrences.length === 0) {
      return err(invalid("CUSTOM_REQUIRES_OCCURRENCES"));
    }
    if (!CUSTOM_ANCHORS.includes(value.anchor)) {
      return err(invalid("CUSTOM_REQUIRES_PERIOD_ANCHOR", { anchor: value.anchor }));
    }
    const duplicate = findDuplicateOccurrence(value.occurrences);
    if (duplicate !== null) {
      return err(invalid("CUSTOM_DUPLICATE_DATE", duplicate));
    }
  } else if (value.occurrences !== undefined) {
    return err(invalid("OCCURRENCES_ONLY_FOR_CUSTOM", { periodicity }));
  }

  if (periodicity === Periodicity.ON_EVENT && !isEventDrivenAnchor(value.anchor)) {
    // Sans calendrier, il n'y a ni début ni fin de période à quoi s'accrocher.
    return err(invalid("ON_EVENT_REQUIRES_EVENT_ANCHOR", { anchor: value.anchor }));
  }

  // ── Cohérence des reports ──────────────────────────────────────────────────

  /*
   * Deux reports de sens opposés peuvent osciller sans fin : un vendredi
   * (week-end → suivant) mène au dimanche, dimanche férié (férié → précédent)
   * ramène au samedi, samedi week-end mène au dimanche… Le calcul boucle.
   * On refuse la combinaison à la saisie plutôt que d'avoir à l'interrompre au
   * calcul.
   */
  const weekend = value.weekend_shift;
  const holiday = value.holiday_shift;
  if (weekend !== DateShift.NONE && holiday !== DateShift.NONE && weekend !== holiday) {
    return err(invalid("SHIFTS_MUST_AGREE", { weekend_shift: weekend, holiday_shift: holiday }));
  }

  return ok(value);
}

function findDuplicateOccurrence(
  occurrences: readonly CustomOccurrence[],
): { month: number; day: number } | null {
  const seen = new Set<string>();
  for (const occurrence of occurrences) {
    const key = `${String(occurrence.month)}-${String(occurrence.day)}`;
    if (seen.has(key)) return { month: occurrence.month, day: occurrence.day };
    seen.add(key);
  }
  return null;
}

/**
 * Règle par défaut proposée à la création, adaptée à la périodicité choisie.
 * Un formulaire qui s'ouvre sur une règle déjà valide évite à l'utilisateur de
 * partir d'un écran en erreur.
 */
export function defaultDueRule(periodicity: Periodicity): DueRule {
  const base = {
    weekend_shift: DateShift.NEXT_BUSINESS_DAY,
    holiday_shift: DateShift.NEXT_BUSINESS_DAY,
  } as const;

  if (periodicity === Periodicity.CUSTOM) {
    return { ...base, anchor: DueAnchor.PERIOD_END, offset_days: 0, occurrences: [] };
  }
  if (periodicity === Periodicity.ON_EVENT) {
    return { ...base, anchor: DueAnchor.EVENT_DATE, offset_days: 30 };
  }
  if (FIXED_DATE_PERIODICITIES.includes(periodicity)) {
    return { ...base, anchor: DueAnchor.PERIOD_END, offset_days: 30 };
  }
  return { ...base, anchor: DueAnchor.PERIOD_END, offset_days: 20 };
}
