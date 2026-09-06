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

import { listHolidayCalendar, listRecalculableOccurrences } from "@/data/queries/admin";
import { formatISODateInAppTz } from "@/lib/dates";
import type { HolidayEntry } from "@/lib/holidays";
import { ok, type Result } from "@/lib/result";
import type { Periodicity } from "@/config/constants";
import { requirePermission } from "@/services/auth/context";
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

/** Ce qu'un changement de calendrier déplacerait, sans rien écrire. */
export interface HolidayImpact {
  /** Occurrences dont l'échéance changerait RÉELLEMENT. */
  readonly moved: number;
  /** Occurrences examinées — celles que le changement ne touche pas comprises. */
  readonly examined: number;
}

interface DueDateUpdate {
  readonly occurrence_id: string;
  readonly legal_due_date: string;
  readonly internal_due_date: string;
}

/**
 * Les échéances que CE calendrier produirait, comparées à celles en place.
 *
 * ⚠️ Ne considère que les occurrences `TODO` non verrouillées : on ne déplace
 * pas le sol sous les pieds de quelqu'un qui a déjà commencé. La borne est
 * appliquée deux fois — ici pour ne pas proposer l'impossible, et par
 * `apply_due_date_updates` qui refuse tout le reste.
 *
 * Aucune écriture. C'est ce qui permet d'ANNONCER le nombre avant d'agir.
 */
async function computeUpdatesFor(
  calendar: readonly HolidayEntry[],
): Promise<Result<{ readonly updates: readonly DueDateUpdate[]; readonly examined: number }>> {
  // ⚠️ Aujourd'hui à ALGER, pas en UTC. `new Date().toISOString().slice(0, 10)`
  // — ce qu'il y avait ici — donne la date UTC : entre 23 h et minuit à Alger,
  // c'est encore celle de la veille, et le recalcul se voyait alors proposer une
  // échéance du jour même, précisément celle qu'il protège.
  const today = formatISODateInAppTz();

  const pending = await listRecalculableOccurrences(today);
  if (!pending.ok) return pending;

  const updates: DueDateUpdate[] = [];

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
      holidays: calendar,
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

  return ok({ updates, examined: pending.value.length });
}

/**
 * Ce qu'un changement de calendrier DÉPLACERAIT, s'il était appliqué.
 *
 * ⚠️ ANNONCER AVANT D'AGIR, ET NON RENDRE COMPTE APRÈS. Importer un calendrier
 * déplace des échéances que des gens ont notées ailleurs — dans un agenda, sur
 * un tableau, dans leur tête. Découvrir après coup que trente dossiers ont
 * changé de date ne laisse aucune occasion de dire « non, pas celui-là » : le
 * nombre doit être connu pendant qu'il est encore possible de renoncer.
 *
 * Le calendrier candidat est construit ICI, à partir de l'état réel de la base :
 * rien de ce que le formulaire transmet n'entre dans le calcul, sinon la
 * modification proposée elle-même.
 */
export async function previewHolidayChange(change: {
  readonly added?: readonly HolidayEntry[];
  readonly removedId?: string;
}): Promise<Result<HolidayImpact>> {
  const context = await requirePermission("referential.manage");
  if (!context.ok) return context;

  const calendar = await listHolidayCalendar();
  if (!calendar.ok) return calendar;

  const candidate: HolidayEntry[] = calendar.value
    .filter((row) => row.id !== change.removedId)
    .map((row) => ({ date: row.date, isRecurring: row.isRecurring }));

  for (const entry of change.added ?? []) candidate.push(entry);

  const computed = await computeUpdatesFor(candidate);
  if (!computed.ok) return computed;

  return ok({ moved: computed.value.updates.length, examined: computed.value.examined });
}

/**
 * Recalcule les échéances des occurrences ENCORE À FAIRE.
 *
 * ⚠️ Recalcule à partir du calendrier tel qu'il est EN BASE au moment de
 * l'appel, jamais à partir de l'aperçu : la liste montrée à l'écran n'est qu'un
 * affichage, et le monde a pu bouger entre les deux. C'est la même règle que
 * pour le recalcul d'une règle d'obligation.
 */
export async function recalculateForHolidayChange(reason: string): Promise<Result<number>> {
  const calendar = await listHolidayCalendar();
  if (!calendar.ok) return calendar;

  const computed = await computeUpdatesFor(calendar.value);
  if (!computed.ok) return computed;

  if (computed.value.updates.length === 0) return ok(0);
  return propagateDueDates([...computed.value.updates], reason);
}
