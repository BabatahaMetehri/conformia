import "server-only";

/**
 * DIFFUSEUR — vide la file d'envoi.
 *
 * Trois promesses, dans cet ordre :
 *
 *  1. « Un échec d'envoi n'interrompt jamais le traitement du lot. » Chaque
 *     message est tenté, quoi qu'il soit arrivé aux précédents. Une exception
 *     n'échappe jamais de la boucle.
 *  2. « Une panne du fournisseur n'empêche pas les notifications in-app. » Elle
 *     est tenue par construction : les lignes IN_APP ne passent pas ici. Elles
 *     sont visibles dès leur écriture par le planificateur — le diffuseur ne les
 *     regarde même pas.
 *  3. Le regroupement : plusieurs alertes d'un même destinataire dans la même
 *     heure partent en UN message.
 */

import {
  EMAIL_BATCH_SIZE,
  EMAIL_MIN_INTERVAL_MS,
  EMAIL_RETRY_BASE_MS,
  MAX_EMAIL_ATTEMPTS,
} from "@/config/notifications";
import { env } from "@/config/env";
import { DEFAULT_LOCALE } from "@/config/constants";
import {
  listPendingEmails,
  loadNotificationSettings,
  markFailed,
  markSent,
  notifyAdminsOfFailures,
  type NotificationClient,
  type PendingEmail,
} from "@/data/queries/notifications";
import { renderEmail } from "@/emails";
import { createEmailProvider, type EmailProvider } from "@/services/notifications/providers";
import { logger } from "@/lib/logger";
import { emailTranslator, type EmailTranslator } from "@/lib/translator";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";

export interface DispatchReport {
  readonly provider: string;
  /** Lignes prises dans la file. */
  readonly picked: number;
  /** Messages effectivement remis au fournisseur. */
  readonly messages: number;
  /** Lignes marquées envoyées — supérieur à `messages` dès qu'il y a regroupement. */
  readonly sent: number;
  readonly failed: number;
  /** Administrateurs prévenus d'un échec définitif. */
  readonly adminsAlerted: number;
}

/**
 * Budget de temporisation pour TOUT le lot.
 *
 * ⚠️ Sans lui, un fournisseur injoignable ferait attendre 7 secondes par message :
 * cinquante messages, six minutes d'attente pure, pour cinquante échecs
 * identiques et prévisibles. Le budget épuisé, les messages restants sont tentés
 * UNE fois chacun — ils sont donc toujours tentés, la première promesse tient,
 * mais le lot rend la main.
 */
const RETRY_BUDGET_MS = 30_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Motif d'échec consigné sur la ligne.
 *
 * ⚠️ LE CODE SEUL NE DIAGNOSTIQUE RIEN. « EXTERNAL_SERVICE_FAILED :
 * errors.externalServiceFailed » se lit exactement pareil pour une adresse
 * invalide, une clé révoquée et un serveur injoignable — trois incidents dont
 * les remèdes n'ont rien à voir. On y joint donc ce que le FOURNISSEUR a dit :
 * c'est la seule information qui distingue « corriger l'adresse » de
 * « prévenir l'hébergeur », et elle n'est disponible qu'ici, au moment où la
 * ligne est marquée en échec.
 *
 * Le second membre reste borné par le SQL, qui tronque à 500 caractères : un
 * fournisseur bavard ne remplit pas la table.
 */
function failureReason(error: AppError): string {
  const reported = error.details?.["reason"];
  const detail =
    typeof reported === "string" && reported.length > 0
      ? reported
      : error.cause instanceof Error
        ? error.cause.message
        : "";

  return `${error.code}: ${detail.length > 0 ? detail : error.message}`;
}

/** Un envoi et ses lignes : une seule ligne, ou plusieurs si elles sont fusionnées. */
interface OutgoingMessage {
  readonly ids: readonly number[];
  readonly to: string;
  readonly toName: string | null;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attemptsUsed: number;
}

/**
 * Regroupe la file en messages.
 *
 * ⚠️ La clé est (destinataire, heure prévue). `scheduled_for` porte le début de
 * l'heure du cycle — c'est le planificateur qui l'y a mis, précisément pour que
 * ce regroupement soit une comparaison d'égalité et non une arithmétique sur des
 * horodatages, qui se serait trompée d'une milliseconde une fois sur deux.
 */
export function groupPending(
  pending: readonly PendingEmail[],
): readonly (readonly PendingEmail[])[] {
  const groups = new Map<string, PendingEmail[]>();

  for (const row of pending) {
    const key = `${row.recipientId}|${row.scheduledFor}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }

  return [...groups.values()];
}

/**
 * Forme d'une cle i18n : `notifications.backupStale.subject`.
 *
 * Volontairement etroite. Un sujet redige commence par une majuscule et contient
 * des espaces ; il ne peut pas ressembler a ceci par accident.
 */
const I18N_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;

/**
 * Resout un libelle stocke sous forme de CLE.
 *
 * ⚠️ CERTAINES NOTIFICATIONS SONT CREEES EN SQL, ET LE SQL NE TRADUIT PAS.
 * L'alerte de sauvegarde (migration 0015) range `notifications.backupStale.subject`
 * dans la colonne `subject`, faute de pouvoir faire mieux depuis un trigger. Le
 * repartiteur envoyait cette chaine telle quelle : les administrateurs recevaient
 * un courriel dont l'objet etait le nom technique de la cle.
 *
 * ⚠️ UNE CLE INCONNUE EST RENDUE TELLE QUELLE, JAMAIS REMPLACEE PAR UN TEXTE
 * GENERIQUE. « Notification » a la place d'un objet manquant serait plus joli et
 * strictement moins utile : on perdrait la seule information permettant de
 * retrouver la cle fautive.
 */
function resolveLabel(value: string, t: EmailTranslator): string {
  if (!I18N_KEY.test(value)) return value;
  try {
    // @ts-expect-error — la cle vient de la base, donc hors du typage statique
    // de next-intl. Le `try` couvre exactement ce que le typage ne peut pas.
    const resolved = t(value);
    return typeof resolved === "string" && resolved.length > 0 ? resolved : value;
  } catch {
    return value;
  }
}

async function buildMessage(group: readonly PendingEmail[]): Promise<OutgoingMessage | null> {
  const first = group[0];
  if (first === undefined) return null;

  const ids = group.map((row) => row.id);
  // Les tentatives déjà consommées sont celles de la ligne la PLUS éprouvée du
  // groupe : fusionner deux lignes ne doit pas offrir un budget neuf à celle qui
  // a déjà échoué deux fois.
  const attemptsUsed = group.reduce((worst, row) => Math.max(worst, row.retryCount), 0);

  const t = emailTranslator();

  if (group.length === 1) {
    const subject = resolveLabel(first.subject, t);
    const text = resolveLabel(first.bodyText, t);
    return {
      ids,
      to: first.recipientEmail,
      toName: first.recipientName,
      subject,
      // Le corps HTML peut etre absent : le texte resolu en tient lieu.
      html: first.bodyHtml ?? text,
      text,
      attemptsUsed,
    };
  }

  const rendered = await renderEmail({
    template: "GroupedAlerts",
    recipientName: first.recipientName ?? "",
    // Le sujet de chaque alerte fait la ligne de la liste : il porte déjà le
    // libellé de l'obligation et l'échéance, et il a été rédigé pour être lu
    // seul.
    items: group.map((row) => resolveLabel(row.subject, t)),
    listUrl: `${env.NEXT_PUBLIC_APP_URL}/${DEFAULT_LOCALE}/echeancier`,
  });

  return {
    ids,
    to: first.recipientEmail,
    toName: first.recipientName,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attemptsUsed,
  };
}

/**
 * Envoie un message, avec temporisation exponentielle.
 *
 * Le budget de tentatives est GLOBAL à la ligne, pas au cycle : une ligne qui a
 * déjà échoué deux fois n'a droit qu'à une tentative de plus, même une heure
 * plus tard. C'est ce qui donne un sens à « échec définitif » — sans quoi une
 * adresse morte serait retentée indéfiniment, à trois essais par heure.
 */
async function sendWithBackoff(
  provider: EmailProvider,
  message: OutgoingMessage,
  budget: { remainingMs: number },
): Promise<Result<string>> {
  const remainingAttempts = Math.max(1, MAX_EMAIL_ATTEMPTS - message.attemptsUsed);
  // Valeur de départ jamais rendue : `remainingAttempts` vaut au moins 1, donc
  // la boucle s'exécute et réaffecte `last` avant tout retour.
  let last: Result<string> = err(AppError.internal());

  for (let attempt = 0; attempt < remainingAttempts; attempt += 1) {
    if (attempt > 0) {
      const delay = EMAIL_RETRY_BASE_MS * 2 ** (attempt - 1);
      if (budget.remainingMs < delay) break;
      budget.remainingMs -= delay;
      await wait(delay);
    }

    last = await provider.send({
      to: message.to,
      toName: message.toName,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (last.ok) return last;
  }

  return last;
}

/**
 * Un cycle de diffusion.
 *
 * `now` est un paramètre : la file se remplit et se vide à des dates qu'un test
 * doit pouvoir choisir.
 */
export async function dispatchNotifications(
  client: NotificationClient,
  now: Date,
): Promise<Result<DispatchReport>> {
  const settings = await loadNotificationSettings(client);
  if (!settings.ok) return err(settings.error);

  const pending = await listPendingEmails(client, now, EMAIL_BATCH_SIZE, MAX_EMAIL_ATTEMPTS);
  if (!pending.ok) return err(pending.error);

  if (pending.value.length === 0) {
    return ok({
      provider: settings.value.emailProvider,
      picked: 0,
      messages: 0,
      sent: 0,
      failed: 0,
      adminsAlerted: 0,
    });
  }

  const provider = createEmailProvider(settings.value.emailProvider, settings.value.sender);
  if (!provider.ok) {
    /*
     * ⚠️ Fournisseur inconstructible — clé absente, réglage incohérent. On ne
     * consomme AUCUNE tentative : l'incident est de configuration, pas d'envoi.
     * Décompter des tentatives ici épuiserait le budget de messages parfaitement
     * valides pendant qu'un administrateur cherche la variable manquante.
     */
    logger.error("Fournisseur de courriel indisponible", {
      provider: settings.value.emailProvider,
      code: provider.error.code,
    });
    return err(provider.error);
  }

  const groups = groupPending(pending.value);
  const budget = { remainingMs: RETRY_BUDGET_MS };
  let sent = 0;
  let failed = 0;
  let messages = 0;

  for (const group of groups) {
    let message: OutgoingMessage | null;
    try {
      message = await buildMessage(group);
    } catch (cause) {
      // Un rendu qui casse ne doit pas emporter le lot : la ligne consomme une
      // tentative et le lot continue.
      await markFailed(
        client,
        group.map((row) => row.id),
        cause instanceof Error ? cause.message : String(cause),
      );
      failed += group.length;
      continue;
    }

    if (message === null) continue;
    messages += 1;

    const outcome = await sendWithBackoff(provider.value, message, budget);

    if (outcome.ok) {
      const marked = await markSent(client, message.ids);
      sent += marked.ok ? marked.value : 0;
    } else {
      await markFailed(client, message.ids, failureReason(outcome.error));
      failed += message.ids.length;
    }

    // Limitation de débit : le fournisseur gratuit plafonne à deux messages par
    // seconde, et se faire limiter produit un échec impossible à distinguer
    // d'une panne — donc une tentative consommée pour rien.
    if (messages < groups.length) await wait(EMAIL_MIN_INTERVAL_MS);
  }

  // Échecs définitifs : les administrateurs sont prévenus EN INTERNE. Signaler
  // par courriel qu'un courriel ne part pas supposerait résolu le problème qu'on
  // annonce.
  const alerted = await notifyAdminsOfFailures(client, MAX_EMAIL_ATTEMPTS);

  const report: DispatchReport = {
    provider: provider.value.name,
    picked: pending.value.length,
    messages,
    sent,
    failed,
    adminsAlerted: alerted.ok ? alerted.value : 0,
  };

  logger.info("Diffusion des notifications", { ...report });
  return ok(report);
}
