import "server-only";

/**
 * Calendrier des jours fériés, et sa conséquence sur les échéances.
 *
 * ⚠️ COMPORTEMENT ARRÊTÉ. Les fêtes CIVILES à date fixe (1er janvier, Yennayer,
 * 1er mai, 5 juillet, 1er novembre) sont injectées comme récurrentes par la
 * migration 0011. Les fêtes RELIGIEUSES — Aïd el-Fitr, Aïd el-Adha, Awal
 * Moharem, Achoura, Mawlid Ennabaoui — suivent le calendrier hégirien et sont
 * fixées chaque année par décret : elles sont SAISIES À LA MAIN, jamais
 * calculées. Les calculer reviendrait à inventer une règle réglementaire ; les
 * figer serait pire, parce que l'erreur passerait inaperçue.
 *
 * Ajouter ou retirer un jour férié DÉPLACE des échéances. Ce module recalcule
 * celles des occurrences encore à faire et laisse la base prévenir leurs
 * responsables — un calendrier qui bouge en silence est pire qu'un calendrier
 * faux : on continue de se fier à la date qu'on avait notée.
 */

import { listHolidayDates, listRecalculableOccurrences } from "@/data/queries/admin";
import { ok, type Result } from "@/lib/result";
import type { Periodicity } from "@/config/constants";
import { computeDueDate } from "@/services/scheduling";
import { DueRuleSchema } from "@/services/scheduling/due-rule";
import { propagateDueDates } from "@/services/admin";

/** Une ligne de CSV admise. Séparateur virgule ou point-virgule. */
export interface ParsedHolidayLine {
  readonly date: string;
  readonly label: string;
  readonly isRecurring: boolean;
}

export interface CsvParseResult {
  readonly rows: readonly ParsedHolidayLine[];
  /** Numéros de ligne rejetés, pour les montrer plutôt que de les taire. */
  readonly rejected: readonly number[];
}

/**
 * Lit un CSV de jours fériés.
 *
 * Format attendu : `date,libellé[,récurrent]` — la date en `AAAA-MM-JJ`.
 * ⚠️ Les lignes invalides sont RAPPORTÉES, jamais ignorées en silence : un
 * import qui avale la moitié d'un fichier sans le dire produit un calendrier
 * faux dont personne ne saura qu'il l'est.
 */
export function parseHolidayCsv(content: string): CsvParseResult {
  const rows: ParsedHolidayLine[] = [];
  const rejected: number[] = [];

  const lines = content.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const cells = line.split(/[;,]/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const [date, label, recurring] = cells;

    // En-tête toléré : on le reconnaît à sa première cellule non datée.
    if (index === 0 && date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    if (
      date === undefined ||
      label === undefined ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      label.length === 0
    ) {
      rejected.push(index + 1);
      continue;
    }

    rows.push({
      date,
      label,
      isRecurring: recurring === "true" || recurring === "1" || recurring === "oui",
    });
  }

  return { rows, rejected };
}

/**
 * Recalcule les échéances des occurrences ENCORE À FAIRE.
 *
 * ⚠️ Ne touche que `TODO`, non verrouillées : on ne déplace pas le sol sous les
 * pieds de quelqu'un qui a déjà commencé. La borne est appliquée deux fois — ici
 * pour ne pas proposer l'impossible, et par `apply_due_date_updates` qui refuse
 * tout le reste.
 */
export async function recalculateForHolidayChange(reason: string): Promise<Result<number>> {
  const today = new Date().toISOString().slice(0, 10);

  const [pending, holidays] = await Promise.all([
    listRecalculableOccurrences(today),
    listHolidayDates(),
  ]);

  if (!pending.ok) return pending;
  if (!holidays.ok) return holidays;

  const holidayDates = holidays.value.map((date) => new Date(`${date}T00:00:00Z`));
  const updates: { occurrence_id: string; legal_due_date: string; internal_due_date: string }[] =
    [];

  for (const row of pending.value) {
    const rule = DueRuleSchema.safeParse(row.rule);
    // Une règle illisible n'est pas une raison de déplacer une échéance au
    // hasard : on laisse la ligne intacte plutôt que d'inventer une date.
    if (!rule.success) continue;

    const anchor =
      row.expiryDate !== null
        ? new Date(`${row.expiryDate}T00:00:00Z`)
        : row.eventDate !== null
          ? new Date(`${row.eventDate}T00:00:00Z`)
          : undefined;

    const computed = computeDueDate({
      rule: rule.data,
      period: {
        key: row.periodKey,
        start: new Date(`${row.periodStart}T00:00:00Z`),
        end: new Date(`${row.periodEnd}T00:00:00Z`),
        periodicity: row.periodicity as Periodicity,
      },
      holidays: holidayDates,
      internalLeadDays: row.leadDays,
      ...(anchor === undefined ? {} : { anchorDate: anchor }),
    });
    if (!computed.ok) continue;

    const legal = computed.value.legalDueDate.toISOString().slice(0, 10);
    const internal = computed.value.internalDueDate.toISOString().slice(0, 10);

    // On n'envoie que ce qui change RÉELLEMENT : une mise à jour sans écart
    // produirait une notification pour rien, et rien n'use plus vite une
    // notification que d'en recevoir sans motif.
    if (legal === row.legalDueDate && internal === row.internalDueDate) continue;

    updates.push({ occurrence_id: row.id, legal_due_date: legal, internal_due_date: internal });
  }

  if (updates.length === 0) return ok(0);
  return propagateDueDates(updates, reason);
}
