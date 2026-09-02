import "server-only";

/**
 * RÉSUMÉ HEBDOMADAIRE — lundi 07 h 00, heure d'Alger, par défaut.
 *
 * ⚠️ Le jour et l'heure sont des RÉGLAGES, pas des constantes : la tâche se
 * réveille chaque heure et décide elle-même si c'est le moment. Figer « lundi
 * 07 h » dans le code aurait rendu les deux colonnes de réglage mensongères —
 * un écran d'administration qui accepte une valeur sans effet est pire que pas
 * d'écran du tout.
 *
 * ⚠️ Le résumé N'EST PAS DÉDUPLIQUÉ par la contrainte d'unicité : il ne se
 * rattache à aucune occurrence ni à aucune règle. Sa garde est ailleurs — une
 * seule heure par semaine satisfait la condition, et le marqueur `sent_at` de la
 * semaine en cours empêche un second envoi si la tâche est rejouée.
 */

import { DIGEST_MAX_ROWS_PER_SECTION } from "@/config/notifications";
import { DEFAULT_LOCALE } from "@/config/constants";
import { env } from "@/config/env";
import type { NotificationClient } from "@/data/queries/notifications";
import { enqueueNotification, loadNotificationSettings } from "@/data/queries/notifications";
import { renderEmail } from "@/emails";
import type { DigestSection } from "@/emails/digest-email";
import { emailTranslator, type EmailTranslator } from "@/lib/translator";
import { APP_TIMEZONE, formatDateFr } from "@/lib/dates";
import { mapPostgrestError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";

/**
 * Les quatre sections, dans l'ordre de lecture voulu : ce qui est déjà en retard
 * d'abord, les nouveautés en dernier.
 *
 * ⚠️ Les clés i18n sont ÉCRITES EN TOUTES LETTRES et non composées. Une clé
 * construite (`emails.weeklyDigest.sections.${key}`) échappe au typage de
 * next-intl : une section renommée compilerait, et le résumé partirait avec un
 * titre manquant.
 */
const SECTIONS = [
  ["overdue", "emails.weeklyDigest.sections.overdue"],
  ["pendingValidation", "emails.weeklyDigest.sections.pendingValidation"],
  ["weekAhead", "emails.weeklyDigest.sections.weekAhead"],
  ["newObligations", "emails.weeklyDigest.sections.newObligations"],
] as const;

export interface DigestReport {
  readonly due: boolean;
  readonly recipients: number;
  readonly queued: number;
  readonly failed: number;
}

const NOT_DUE: DigestReport = { due: false, recipients: 0, queued: 0, failed: 0 };

/**
 * L'instant tombe-t-il sur le créneau réglé ?
 *
 * ⚠️ Le jour et l'heure sont lus À ALGER. `getUTCDay()` donnerait dimanche 23 h
 * pour un lundi 00 h local — le résumé partirait la veille, une semaine sur
 * deux, sans que personne ne fasse le lien.
 */
export function isDigestDue(now: Date, day: number, hour: number): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const localHour = Number(parts.find((part) => part.type === "hour")?.value ?? "-1");

  // Norme ISO : lundi = 1 … dimanche = 7, comme la colonne de réglage.
  const ISO_DAYS: Readonly<Record<string, number>> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return ISO_DAYS[weekday] === day && localHour === hour;
}

interface DigestRow {
  readonly section: string;
  readonly label: string;
  readonly dueDate: string | null;
}

function buildSections(rows: readonly DigestRow[], t: EmailTranslator): readonly DigestSection[] {
  return SECTIONS.map(([key, titleKey]): DigestSection => {
    const matching = rows.filter((row) => row.section === key);
    const shown = matching.slice(0, DIGEST_MAX_ROWS_PER_SECTION);

    return {
      title: t(titleKey),
      items: shown.map((row) =>
        row.dueDate === null
          ? row.label
          : t("emails.weeklyDigest.itemWithDate", {
              label: row.label,
              date: formatDateFr(new Date(`${row.dueDate}T12:00:00Z`)),
            }),
      ),
      hiddenCount: matching.length - shown.length,
    };
  });
}

/**
 * Prépare le résumé de chaque destinataire et le met en file.
 *
 * ⚠️ Ne l'envoie pas : comme tout le reste, il passe par le diffuseur. Une
 * seconde voie d'envoi aurait sa propre gestion d'échec, ses propres réessais et
 * ses propres bogues.
 */
export async function scheduleWeeklyDigest(
  client: NotificationClient,
  now: Date,
): Promise<Result<DigestReport>> {
  const settings = await loadNotificationSettings(client);
  if (!settings.ok) return err(settings.error);

  if (!isDigestDue(now, settings.value.weeklyDigestDay, settings.value.weeklyDigestHour)) {
    return ok(NOT_DUE);
  }

  const { data: recipients, error: recipientsError } = await client.rpc("weekly_digest_recipients");
  if (recipientsError !== null) return err(mapPostgrestError(recipientsError));

  const t = emailTranslator(DEFAULT_LOCALE);
  const weekLabel = formatDateFr(now);

  let queued = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const { data: rows, error: rowsError } = await client.rpc("weekly_digest_rows", {
      p_user: recipient.user_id,
      p_now: now.toISOString(),
      // On demande plus que ce qui sera montré : c'est ce qui permet d'écrire
      // « et 12 autres » plutôt que de laisser croire que la liste est complète.
      p_limit: DIGEST_MAX_ROWS_PER_SECTION * SECTIONS.length * 4,
    });

    if (rowsError !== null) {
      failed += 1;
      continue;
    }

    const sections = buildSections(
      rows.map((row) => ({ section: row.section, label: row.label, dueDate: row.due_date })),
      t,
    );

    const rendered = await renderEmail({
      template: "WeeklyDigest",
      recipientName: recipient.full_name,
      weekLabel,
      sections,
      dashboardUrl: `${env.NEXT_PUBLIC_APP_URL}/${DEFAULT_LOCALE}/dashboard`,
    });

    /*
     * ⚠️ Ni occurrence, ni règle : le résumé ne se rattache à rien, et la
     * contrainte d'unicité ne le protège donc pas. Sa garde est ailleurs — une
     * seule heure par semaine satisfait `isDigestDue`, et le verrou consultatif
     * de la tâche interdit deux cycles simultanés.
     */
    const queuedRow = await enqueueNotification(client, {
      occurrenceId: null,
      ruleId: null,
      escalationPolicyId: null,
      recipientId: recipient.user_id,
      channel: "EMAIL",
      kind: "WEEKLY_DIGEST",
      subject: rendered.subject,
      bodyHtml: rendered.html,
      bodyText: rendered.text,
      scheduledFor: now,
    });

    if (!queuedRow.ok) failed += 1;
    else queued += 1;
  }

  const report: DigestReport = {
    due: true,
    recipients: recipients.length,
    queued,
    failed,
  };

  logger.info("Résumé hebdomadaire mis en file", { ...report });
  return ok(report);
}
