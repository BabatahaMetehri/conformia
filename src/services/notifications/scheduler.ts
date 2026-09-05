import "server-only";

/**
 * PLANIFICATEUR — exécution horaire.
 *
 * Il répond à une seule question : « que faut-il annoncer maintenant ? », et il
 * doit y répondre de la même façon qu'on la pose une fois ou dix.
 *
 * ⚠️ IDEMPOTENT PAR CONSTRUCTION, pas par vigilance. Le planificateur ne
 * cherche pas ce qu'il a déjà envoyé : il propose, et la contrainte d'unicité
 * de la base tranche. Un doublon n'est donc pas un incident rattrapé après coup,
 * c'est une insertion refusée — le seul mécanisme qui tienne encore lorsque deux
 * exécutions se chevauchent.
 *
 * ⚠️ Il n'ENVOIE RIEN. Il remplit une file ; le diffuseur la vide. Séparer les
 * deux permet qu'une panne du fournisseur de courriel n'empêche pas les
 * notifications in-app d'apparaître — critère d'acceptation explicite, et
 * impossible à tenir si l'écriture et l'envoi partagent le même échec.
 */

import { CALENDAR_ALARM_DAYS_BEFORE } from "@/config/notifications";
import { env } from "@/config/env";
import { DEFAULT_LOCALE } from "@/config/constants";
import {
  enqueueNotification,
  listDueCandidates,
  type NotificationCandidate,
  type NotificationClient,
} from "@/data/queries/notifications";
import { renderEmail, isTemplateKey, type EmailPayload } from "@/emails";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import { formatDateFr } from "@/lib/dates";

export interface SchedulingReport {
  /** Alertes proposées par la base pour ce cycle. */
  readonly considered: number;
  /** Notifications réellement créées. */
  readonly created: number;
  /** Déjà présentes : la preuve, à chaque exécution, que la déduplication tient. */
  readonly duplicates: number;
  /** Alertes qu'on n'a pas su rendre. Le cycle continue malgré elles. */
  readonly failed: number;
  readonly failures: readonly { readonly obligationCode: string; readonly reason: string }[];
}

const EMPTY: SchedulingReport = {
  considered: 0,
  created: 0,
  duplicates: 0,
  failed: 0,
  failures: [],
};

/**
 * Début de l'heure courante, en UTC.
 *
 * ⚠️ C'est LA CLÉ DE REGROUPEMENT. Toutes les alertes d'un cycle portent le même
 * `scheduled_for`, donc le diffuseur peut les reconnaître comme simultanées sans
 * rien recalculer. Employer `now()` tel quel donnerait à chaque ligne un horodatage
 * distinct à la milliseconde près, et deux alertes du même cycle ne seraient
 * jamais « dans la même heure ».
 */
export function hourBucket(now: Date): Date {
  const bucket = new Date(now.getTime());
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}

/** Lien profond vers le dossier. Toujours absolu : un courriel n'a pas d'origine. */
function occurrenceUrl(occurrenceId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/${DEFAULT_LOCALE}/echeancier/${occurrenceId}`;
}

/**
 * Traduit une candidate en charge utile de gabarit.
 *
 * ⚠️ Aucune donnée confidentielle ne franchit cette frontière : libellé, code,
 * période, deux dates, l'organisme, un lien. Ce qui n'est pas ici ne peut pas se
 * retrouver dans un courriel, et c'est le seul endroit où le vérifier.
 */
export function toPayload(candidate: NotificationCandidate): Result<EmailPayload> {
  if (!isTemplateKey(candidate.templateKey)) {
    return err(
      AppError.validationFailed({
        details: { templateKey: candidate.templateKey, obligation: candidate.obligationCode },
      }),
    );
  }

  const facts = {
    obligationName: candidate.obligationName,
    obligationCode: candidate.obligationCode,
    periodLabel: candidate.periodKey,
    internalDueDate: formatDateFr(new Date(`${candidate.internalDueDate}T12:00:00Z`)),
    legalDueDate: formatDateFr(new Date(`${candidate.legalDueDate}T12:00:00Z`)),
    authorityName: candidate.authorityName,
    occurrenceUrl: occurrenceUrl(candidate.occurrenceId),
  };

  /*
   * ⚠️ LE DÉROUTEMENT PRIME SUR LE GABARIT PRÉVU PAR LA RÈGLE.
   *
   * Quand la base a redirigé un courriel vers le suppléant d'un absent, envoyer
   * l'alerte ordinaire serait exact mais incompréhensible : le suppléant lirait
   * « votre échéance approche » sur un dossier dont il n'est pas responsable, et
   * chercherait d'abord ce qu'il a lui-même oublié. Le gabarit `AbsenceRouting`
   * porte les mêmes faits ET la mention qui les rend lisibles.
   *
   * La condition ne peut être vraie que pour le canal COURRIEL : la fonction
   * SQL ne déroute pas l'in-app, précisément pour que l'absent retrouve le
   * contexte à son retour.
   */
  if (candidate.absentRecipientName !== null) {
    return ok({
      template: "AbsenceRouting",
      absentName: candidate.absentRecipientName,
      offsetDays: candidate.offsetDays,
      ...facts,
    });
  }

  switch (candidate.templateKey) {
    case "UpcomingDeadline":
      // L'offset est négatif avant l'échéance ; le gabarit parle en jours restants.
      return ok({
        template: "UpcomingDeadline",
        daysBefore: Math.abs(candidate.offsetDays),
        ...facts,
      });

    case "OverdueAlert":
      return ok({ template: "OverdueAlert", daysAfter: candidate.offsetDays, ...facts });

    case "EscalationNotice":
      return ok({
        template: "EscalationNotice",
        daysAfter: candidate.offsetDays,
        // Un dossier sans porteur est précisément ce qu'une escalade doit
        // signaler : on le dit, plutôt que d'écrire « null » ou de sauter la ligne.
        ownerName: candidate.ownerName ?? "",
        ...facts,
      });

    case "ValidationRequested":
      return ok({ template: "ValidationRequested", ...facts });

    default:
      /*
       * Les autres gabarits existent, mais aucun jalon ne peut les produire :
       * un résumé hebdomadaire, une invitation ou une alerte de sauvegarde ne
       * naissent pas d'une échéance. Une règle qui les désigne est une erreur de
       * saisie, signalée comme telle.
       */
      return err(
        AppError.validationFailed({
          details: {
            templateKey: candidate.templateKey,
            reason: "gabarit non déclenchable par un jalon",
          },
        }),
      );
  }
}

/**
 * Un cycle complet.
 *
 * `now` est un paramètre et non `new Date()` : c'est ce qui rend le planificateur
 * éprouvable à une date choisie, donc ce qui permet de vérifier qu'une occurrence
 * à J-30 produit exactement une notification.
 */
export async function scheduleNotifications(
  client: NotificationClient,
  now: Date,
): Promise<Result<SchedulingReport>> {
  const candidates = await listDueCandidates(client, now);
  if (!candidates.ok) return err(candidates.error);

  if (candidates.value.length === 0) return ok(EMPTY);

  const scheduledFor = hourBucket(now);
  let created = 0;
  let duplicates = 0;
  const failures: { obligationCode: string; reason: string }[] = [];

  for (const candidate of candidates.value) {
    const payload = toPayload(candidate);
    if (!payload.ok) {
      failures.push({ obligationCode: candidate.obligationCode, reason: payload.error.code });
      continue;
    }

    let rendered;
    try {
      rendered = await renderEmail(payload.value);
    } catch (cause) {
      /*
       * ⚠️ Un gabarit qui casse ne doit pas emporter le cycle. Les alertes
       * suivantes concernent d'autres dossiers et d'autres personnes : les
       * perdre parce qu'une chaîne de traduction manque transformerait un défaut
       * d'affichage en échéances manquées.
       */
      failures.push({
        obligationCode: candidate.obligationCode,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }

    const inserted = await enqueueNotification(client, {
      occurrenceId: candidate.occurrenceId,
      ruleId: candidate.ruleId,
      escalationPolicyId: candidate.escalationPolicyId,
      recipientId: candidate.recipientId,
      channel: candidate.channel,
      kind: candidate.kind,
      subject: rendered.subject,
      // Le corps HTML n'est stocké que pour le canal courriel : une notification
      // in-app affiche du texte, et conserver le HTML doublerait la table pour
      // rien.
      bodyHtml: candidate.channel === "EMAIL" ? rendered.html : null,
      bodyText: rendered.text,
      scheduledFor,
    });

    if (!inserted.ok) {
      failures.push({ obligationCode: candidate.obligationCode, reason: inserted.error.code });
      continue;
    }

    if (inserted.value === null) duplicates += 1;
    else created += 1;
  }

  const report: SchedulingReport = {
    considered: candidates.value.length,
    created,
    duplicates,
    failed: failures.length,
    failures,
  };

  logger.info("Planification des notifications", {
    considered: report.considered,
    created: report.created,
    duplicates: report.duplicates,
    failed: report.failed,
  });

  return ok(report);
}

/** Réexporté pour le flux calendrier, qui aligne son rappel sur le jalon J-7. */
export const ALARM_DAYS_BEFORE = CALENDAR_ALARM_DAYS_BEFORE;
