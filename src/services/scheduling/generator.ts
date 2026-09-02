import "server-only";

/**
 * Génération automatique des occurrences.
 *
 * ⚠️ REJOUABLE. Deux exécutions consécutives produisent le même état. La
 * garantie ne vient pas d'une précaution applicative mais de la contrainte
 * d'unicité `(entity_id, obligation_type_id, period_key)` et d'un
 * `on conflict do nothing` : une période déjà générée n'est JAMAIS régénérée,
 * quel que soit son statut. Un dossier déjà traité, validé ou déposé ne peut
 * donc pas être écrasé par une seconde passe — ce qui serait bien pire que de
 * ne rien générer.
 *
 * ⚠️ Aucune règle d'échéance n'est écrite ici. Tout vient de `due_rule`, et le
 * calcul passe par `computeDueDate` — la même fonction que la prévisualisation
 * du référentiel. C'est ce qui garantit qu'une date annoncée à l'écran est la
 * date qui sera générée.
 */

import { addMonths } from "date-fns";

import { Criticality, Periodicity } from "@/config/constants";
import {
  createOccurrenceIfAbsent,
  listFutureTodoOccurrences,
  listGeneratableObligations,
  loadHolidayDates,
  loadObligation,
  updateOccurrenceDueDates,
  type GeneratableObligation,
  type GenerationClient,
} from "@/data/queries/generation";
import { nowInAppTz, toAppTz, toUtcFromAppTz, type PeriodDescriptor } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import {
  computeDueDate,
  computePeriods,
  isEventDrivenAnchor,
  resolveLeadDays,
  validateDueRule,
  type DueRule,
} from "@/services/scheduling";

/** Horizon de génération par défaut, en mois. */
export const DEFAULT_HORIZON_MONTHS = 12;

/** Profondeur du rattrapage d'archives, en mois. */
export const DEFAULT_BACKFILL_MONTHS = 12;

export interface GenerationReport {
  readonly obligationTypeId: string;
  readonly obligationCode: string;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  /** Périodes refusées, avec la raison — pour diagnostiquer sans relire les journaux. */
  readonly failures: readonly { readonly periodKey: string; readonly reason: string }[];
}

export interface BatchReport {
  readonly obligations: number;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  readonly perObligation: readonly GenerationReport[];
}

/** Date civile, en heure d'Alger, au format « AAAA-MM-JJ ». */
function isoDay(instant: Date): string {
  const zoned = toAppTz(instant);
  return [
    String(zoned.getFullYear()),
    String(zoned.getMonth() + 1).padStart(2, "0"),
    String(zoned.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Minuit d'Alger pour une date civile « AAAA-MM-JJ ». */
function fromIsoDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return toUtcFromAppTz(new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12, 0, 0, 0));
}

/**
 * Fenêtre de génération d'une obligation.
 *
 * ⚠️ Bornée par `effective_from` et `effective_to` : on ne génère RIEN hors de
 * la période de validité déclarée. Une obligation abrogée cesse de produire des
 * dossiers le jour où elle est abrogée, et une obligation à venir n'en produit
 * pas avant son entrée en vigueur.
 */
function generationWindow(
  obligation: GeneratableObligation,
  from: Date,
  to: Date,
): { readonly from: Date; readonly to: Date } | null {
  const effectiveFrom = fromIsoDay(obligation.effectiveFrom);
  const effectiveTo = obligation.effectiveTo === null ? null : fromIsoDay(obligation.effectiveTo);

  const start = from.getTime() > effectiveFrom.getTime() ? from : effectiveFrom;
  const end = effectiveTo !== null && effectiveTo.getTime() < to.getTime() ? effectiveTo : to;

  // Fenêtre vide : l'obligation n'est pas en vigueur sur l'intervalle demandé.
  if (end.getTime() < start.getTime()) return null;
  return { from: start, to: end };
}

/** Périodes à produire, règle validée à l'appui. */
function planPeriods(
  obligation: GeneratableObligation,
  rule: DueRule,
  window: { readonly from: Date; readonly to: Date },
): readonly PeriodDescriptor[] {
  const periodicity = obligation.periodicity as Periodicity;

  const periodRule =
    periodicity === Periodicity.CUSTOM
      ? { periodicity, occurrences: rule.occurrences ?? [] }
      : { periodicity };

  return computePeriods(periodRule, window);
}

/**
 * Génère les occurrences d'UNE obligation sur l'horizon demandé.
 *
 * ⚠️ Chaque période est traitée SÉPARÉMENT. Une période dont le calcul échoue —
 * report non convergent, règle incohérente — est comptée en erreur et n'empêche
 * pas les autres d'être créées. Un lot tout-ou-rien priverait de dossiers une
 * année entière pour une seule date pathologique.
 */
export async function generateOccurrences(
  client: GenerationClient,
  obligationTypeId: string,
  horizonMonths: number = DEFAULT_HORIZON_MONTHS,
  now: Date = toUtcFromAppTz(nowInAppTz()),
): Promise<Result<GenerationReport>> {
  const obligation = await loadObligation(client, obligationTypeId);
  if (!obligation.ok) return obligation;
  if (obligation.value === null) {
    return err(AppError.notFound("obligation", obligationTypeId));
  }

  const holidays = await loadHolidayDates(client);
  if (!holidays.ok) return holidays;

  return generateForObligation(
    client,
    obligation.value,
    holidays.value.map(fromIsoDay),
    horizonMonths,
    now,
  );
}

async function generateForObligation(
  client: GenerationClient,
  obligation: GeneratableObligation,
  holidays: readonly Date[],
  horizonMonths: number,
  now: Date,
): Promise<Result<GenerationReport>> {
  const empty: GenerationReport = {
    obligationTypeId: obligation.id,
    obligationCode: obligation.code,
    created: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  // ⚠️ ON_EVENT n'est jamais généré : ces obligations naissent d'un fait.
  if (obligation.periodicity === Periodicity.ON_EVENT) return ok(empty);

  const rule = validateDueRule({
    rule: obligation.dueRule,
    periodicity: obligation.periodicity as Periodicity,
  });
  // Une règle illisible ne produit AUCUN dossier — plutôt que des dossiers aux
  // échéances inventées, qui se découvriraient au moment de la pénalité.
  if (!rule.ok) {
    return ok({
      ...empty,
      failed: 1,
      failures: [{ periodKey: "*", reason: "INVALID_DUE_RULE" }],
    });
  }

  /*
   * ⚠️ ANCRE PORTÉE PAR L'OCCURRENCE : rien à générer, et ce n'est PAS un échec.
   *
   * `EXPIRY_DATE` et `EVENT_DATE` se calculent depuis une date que porte
   * l'occurrence — l'expiration du titre, la date du fait. Au moment de la
   * génération, cette date n'existe pas encore : l'occurrence est créée à la
   * main, avec elle.
   *
   * Constaté sur le référentiel réel : ASSUR et ATT-FISC sont déclarées ANNUAL
   * tout en s'ancrant sur une expiration. Le moteur produisait alors une erreur
   * par période, soit six échecs à chaque passe, et la tâche de nuit rapportait
   * PARTIAL indéfiniment. Un statut d'alerte permanent apprend à ignorer les
   * alertes : c'est le pire résultat possible.
   *
   * L'impossibilité de générer est ici STRUCTURELLE, pas accidentelle. On la
   * traite comme telle — zéro occurrence, zéro échec — quelle que soit la
   * périodicité déclarée.
   */
  if (isEventDrivenAnchor(rule.value.anchor)) return ok(empty);

  const window = generationWindow(
    obligation,
    now,
    toUtcFromAppTz(addMonths(toAppTz(now), horizonMonths)),
  );
  if (window === null) return ok(empty);

  const periods = planPeriods(obligation, rule.value, window);
  const leadDays = resolveLeadDays(
    obligation.criticality as Criticality,
    obligation.internalLeadDays,
  );

  let created = 0;
  let skipped = 0;
  const failures: { periodKey: string; reason: string }[] = [];

  for (const period of periods) {
    const computed = computeDueDate({
      rule: rule.value,
      period,
      holidays,
      internalLeadDays: leadDays,
    });

    if (!computed.ok) {
      failures.push({ periodKey: period.key, reason: String(computed.error.details?.["reason"]) });
      continue;
    }

    const inserted = await createOccurrenceIfAbsent(client, obligation.id, {
      periodKey: period.key,
      periodStart: isoDay(period.start),
      periodEnd: isoDay(period.end),
      legalDueDate: isoDay(computed.value.legalDueDate),
      internalDueDate: isoDay(computed.value.internalDueDate),
    });

    if (!inserted.ok) {
      failures.push({ periodKey: period.key, reason: inserted.error.code });
      continue;
    }

    // `null` signifie « la période existait déjà » : c'est le cas NOMINAL d'une
    // seconde exécution, pas une anomalie.
    if (inserted.value === null) skipped += 1;
    else created += 1;
  }

  return ok({
    obligationTypeId: obligation.id,
    obligationCode: obligation.code,
    created,
    skipped,
    failed: failures.length,
    failures,
  });
}

/**
 * Génère pour TOUTES les obligations actives.
 *
 * ⚠️ POURSUIT APRÈS UN ÉCHEC UNITAIRE. Une obligation dont la règle est cassée
 * ne doit pas priver les quarante autres de leurs dossiers. Le rapport porte le
 * détail par obligation : c'est lui qui rend l'échec visible sans le rendre
 * bloquant.
 */
export async function generateAllActive(
  client: GenerationClient,
  horizonMonths: number = DEFAULT_HORIZON_MONTHS,
  now: Date = toUtcFromAppTz(nowInAppTz()),
): Promise<Result<BatchReport>> {
  const obligations = await listGeneratableObligations(client);
  if (!obligations.ok) return obligations;

  const holidays = await loadHolidayDates(client);
  if (!holidays.ok) return holidays;

  const holidayDates = holidays.value.map(fromIsoDay);
  const perObligation: GenerationReport[] = [];

  for (const obligation of obligations.value) {
    const report = await generateForObligation(
      client,
      obligation,
      holidayDates,
      horizonMonths,
      now,
    );

    perObligation.push(
      report.ok
        ? report.value
        : {
            obligationTypeId: obligation.id,
            obligationCode: obligation.code,
            created: 0,
            skipped: 0,
            failed: 1,
            failures: [{ periodKey: "*", reason: report.error.code }],
          },
    );
  }

  return ok({
    obligations: perObligation.length,
    created: perObligation.reduce((sum, entry) => sum + entry.created, 0),
    skipped: perObligation.reduce((sum, entry) => sum + entry.skipped, 0),
    failed: perObligation.reduce((sum, entry) => sum + entry.failed, 0),
    perObligation,
  });
}

/**
 * Recalcule les échéances FUTURES après un changement de règle.
 *
 * ⚠️ Ne touche QUE les occurrences au statut TODO, non verrouillées, dont la
 * période commence après `fromDate`. Les quatre bornes ont la même raison : on
 * ne déplace pas le sol sous les pieds de quelqu'un qui a déjà commencé à
 * travailler, et on ne réécrit pas l'histoire d'un dossier déposé.
 *
 * Ne CRÉE rien : c'est un recalcul, pas une génération. Les périodes manquantes
 * relèvent de `generateOccurrences`.
 */
export async function regenerateFuture(
  client: GenerationClient,
  obligationTypeId: string,
  fromDate: Date = toUtcFromAppTz(nowInAppTz()),
): Promise<Result<{ readonly updated: number; readonly unchanged: number }>> {
  const obligation = await loadObligation(client, obligationTypeId);
  if (!obligation.ok) return obligation;
  if (obligation.value === null) return err(AppError.notFound("obligation", obligationTypeId));

  const rule = validateDueRule({
    rule: obligation.value.dueRule,
    periodicity: obligation.value.periodicity as Periodicity,
  });
  if (!rule.ok) return rule;

  const [holidays, occurrences] = await Promise.all([
    loadHolidayDates(client),
    listFutureTodoOccurrences(client, obligationTypeId, isoDay(fromDate)),
  ]);
  if (!holidays.ok) return holidays;
  if (!occurrences.ok) return occurrences;

  const holidayDates = holidays.value.map(fromIsoDay);
  const leadDays = resolveLeadDays(
    obligation.value.criticality as Criticality,
    obligation.value.internalLeadDays,
  );

  let updated = 0;
  let unchanged = 0;

  for (const occurrence of occurrences.value) {
    const computed = computeDueDate({
      rule: rule.value,
      period: {
        key: occurrence.periodKey,
        start: fromIsoDay(occurrence.periodStart),
        end: fromIsoDay(occurrence.periodEnd),
        periodicity: obligation.value.periodicity as Periodicity,
      },
      holidays: holidayDates,
      internalLeadDays: leadDays,
    });
    if (!computed.ok) continue;

    const legal = isoDay(computed.value.legalDueDate);
    const internal = isoDay(computed.value.internalDueDate);

    // On n'écrit que ce qui change réellement : une mise à jour sans écart
    // produirait une entrée d'audit et une notification pour rien.
    if (legal === occurrence.legalDueDate && internal === occurrence.internalDueDate) {
      unchanged += 1;
      continue;
    }

    const applied = await updateOccurrenceDueDates(client, occurrence.id, legal, internal);
    if (applied.ok) updated += 1;
  }

  return ok({ updated, unchanged });
}

/**
 * Crée les coquilles ARCHIVÉES des mois précédents.
 *
 * ⚠️ RAISON D'ÊTRE, à ne pas perdre de vue : permettre le versement de
 * justificatifs ANCIENS au fil de l'eau, sans imposer une campagne de saisie
 * rétroactive au démarrage. Sans ces coquilles, une pièce de mars n'a nulle part
 * où aller tant que personne n'a créé le dossier de mars à la main.
 *
 * Elles naissent au statut ARCHIVED, donc VERROUILLÉES : elles ne réclament
 * aucun travail, n'apparaissent dans aucune file, et ne comptent dans aucun
 * indicateur de retard. Les créer en TODO fabriquerait des centaines de dossiers
 * en retard le premier jour — exactement l'inverse du but.
 *
 * ⚠️ Conséquence à connaître : une occurrence ARCHIVED est immuable depuis 0010,
 * y compris pour ses pièces. Verser un justificatif ancien suppose donc de
 * ROUVRIR le dossier (transition ARCHIVED → SUBMITTED, permission
 * `occurrence.unlock`, motif obligatoire). C'est plus lourd que prévu par
 * l'intention initiale, et il faut le signaler plutôt que le découvrir à l'usage.
 */
export async function backfillArchivedShells(
  client: GenerationClient,
  obligationTypeId: string,
  months: number = DEFAULT_BACKFILL_MONTHS,
  now: Date = toUtcFromAppTz(nowInAppTz()),
): Promise<Result<GenerationReport>> {
  const obligation = await loadObligation(client, obligationTypeId);
  if (!obligation.ok) return obligation;
  if (obligation.value === null) return err(AppError.notFound("obligation", obligationTypeId));

  const empty: GenerationReport = {
    obligationTypeId: obligation.value.id,
    obligationCode: obligation.value.code,
    created: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  if (obligation.value.periodicity === Periodicity.ON_EVENT) return ok(empty);

  const rule = validateDueRule({
    rule: obligation.value.dueRule,
    periodicity: obligation.value.periodicity as Periodicity,
  });
  if (!rule.ok)
    return ok({ ...empty, failed: 1, failures: [{ periodKey: "*", reason: "INVALID_DUE_RULE" }] });

  const holidays = await loadHolidayDates(client);
  if (!holidays.ok) return holidays;
  const holidayDates = holidays.value.map(fromIsoDay);

  // Fenêtre PASSÉE : de `now - months` à `now`, bornée par la validité.
  const window = generationWindow(
    obligation.value,
    toUtcFromAppTz(addMonths(toAppTz(now), -months)),
    now,
  );
  if (window === null) return ok(empty);

  const periods = planPeriods(obligation.value, rule.value, window);
  const leadDays = resolveLeadDays(
    obligation.value.criticality as Criticality,
    obligation.value.internalLeadDays,
  );

  let created = 0;
  let skipped = 0;
  const failures: { periodKey: string; reason: string }[] = [];

  for (const period of periods) {
    const computed = computeDueDate({
      rule: rule.value,
      period,
      holidays: holidayDates,
      internalLeadDays: leadDays,
    });
    if (!computed.ok) {
      failures.push({ periodKey: period.key, reason: String(computed.error.details?.["reason"]) });
      continue;
    }

    const inserted = await createOccurrenceIfAbsent(
      client,
      obligation.value.id,
      {
        periodKey: period.key,
        periodStart: isoDay(period.start),
        periodEnd: isoDay(period.end),
        legalDueDate: isoDay(computed.value.legalDueDate),
        internalDueDate: isoDay(computed.value.internalDueDate),
      },
      "ARCHIVED",
    );

    if (!inserted.ok) {
      failures.push({ periodKey: period.key, reason: inserted.error.code });
      continue;
    }
    if (inserted.value === null) skipped += 1;
    else created += 1;
  }

  return ok({
    obligationTypeId: obligation.value.id,
    obligationCode: obligation.value.code,
    created,
    skipped,
    failed: failures.length,
    failures,
  });
}
