import { render } from "@react-email/render";
import type { ReactElement } from "react";

import { BackupFailureAlert, IntegrityAlert } from "@/emails/ops-emails";
import { PasswordReset, UserInvitation } from "@/emails/account-emails";
import { GroupedAlerts } from "@/emails/grouped-alerts-email";
import { WeeklyDigest, type DigestSection } from "@/emails/digest-email";
import {
  EscalationNotice,
  OverdueAlert,
  SubmissionRejected,
  UpcomingDeadline,
  ValidationRequested,
} from "@/emails/occurrence-emails";
import { emailTranslator, type EmailTranslator } from "@/emails/translator";
import type { Locale } from "@/config/constants";

/**
 * Registre des gabarits : la seule porte entre une `template_key` de la base et
 * un composant React.
 *
 * ⚠️ La clé vient d'une COLONNE (`notification_rules.template_key`) : elle est
 * donc une donnée, saisissable par un administrateur, et peut ne correspondre à
 * rien. Le rendu échoue alors PROPREMENT, avec un message qui nomme la clé —
 * plutôt que de produire un courriel vide que personne ne remarquerait.
 */

export interface OccurrenceFacts {
  readonly obligationName: string;
  readonly obligationCode: string;
  readonly periodLabel: string;
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly authorityName: string | null;
  readonly occurrenceUrl: string;
}

/**
 * Charge utile d'un courriel. Union discriminée : ajouter un gabarit sans
 * l'ajouter au registre ne compile pas.
 */
export type EmailPayload =
  | ({ readonly template: "UpcomingDeadline"; readonly daysBefore: number } & OccurrenceFacts)
  | ({ readonly template: "OverdueAlert"; readonly daysAfter: number } & OccurrenceFacts)
  | ({ readonly template: "ValidationRequested" } & OccurrenceFacts)
  | ({ readonly template: "SubmissionRejected"; readonly reason: string } & OccurrenceFacts)
  | ({
      readonly template: "EscalationNotice";
      readonly daysAfter: number;
      readonly ownerName: string;
    } & OccurrenceFacts)
  | {
      readonly template: "WeeklyDigest";
      readonly recipientName: string;
      readonly weekLabel: string;
      readonly sections: readonly DigestSection[];
      readonly dashboardUrl: string;
    }
  | {
      readonly template: "UserInvitation";
      readonly inviterName: string;
      readonly roleLabel: string;
      readonly acceptUrl: string;
      readonly expiresInHours: number;
    }
  | {
      readonly template: "PasswordReset";
      readonly resetUrl: string;
      readonly expiresInMinutes: number;
    }
  | {
      readonly template: "IntegrityAlert";
      readonly checkedCount: number;
      readonly divergentCount: number;
      readonly checkedAt: string;
      readonly reportUrl: string;
    }
  | {
      readonly template: "GroupedAlerts";
      readonly recipientName: string;
      readonly items: readonly string[];
      readonly listUrl: string;
    }
  | {
      readonly template: "BackupFailureAlert";
      readonly lastSuccessAt: string | null;
      readonly hoursSinceSuccess: number;
      readonly reportUrl: string;
    };

export type TemplateKey = EmailPayload["template"];

export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  "UpcomingDeadline",
  "OverdueAlert",
  "ValidationRequested",
  "SubmissionRejected",
  "EscalationNotice",
  "WeeklyDigest",
  "UserInvitation",
  "PasswordReset",
  "IntegrityAlert",
  "BackupFailureAlert",
  // Imposé par la règle de regroupement — voir grouped-alerts-email.tsx.
  "GroupedAlerts",
];

export function isTemplateKey(value: string): value is TemplateKey {
  return TEMPLATE_KEYS.some((key) => key === value);
}

/** Sujet et élément React, pour une charge utile donnée. */
function build(payload: EmailPayload, t: EmailTranslator): [string, ReactElement] {
  switch (payload.template) {
    case "UpcomingDeadline":
      return [
        t("emails.upcomingDeadline.subject", {
          obligation: payload.obligationName,
          days: payload.daysBefore,
        }),
        UpcomingDeadline({ t, ...payload }),
      ];
    case "OverdueAlert":
      return [
        t("emails.overdueAlert.subject", {
          obligation: payload.obligationName,
          days: payload.daysAfter,
        }),
        OverdueAlert({ t, ...payload }),
      ];
    case "ValidationRequested":
      return [
        t("emails.validationRequested.subject", { obligation: payload.obligationName }),
        ValidationRequested({ t, ...payload }),
      ];
    case "SubmissionRejected":
      return [
        t("emails.submissionRejected.subject", { obligation: payload.obligationName }),
        SubmissionRejected({ t, ...payload }),
      ];
    case "EscalationNotice":
      return [
        t("emails.escalation.subject", {
          obligation: payload.obligationName,
          days: payload.daysAfter,
        }),
        EscalationNotice({ t, ...payload }),
      ];
    case "WeeklyDigest":
      return [
        t("emails.weeklyDigest.subject", { week: payload.weekLabel }),
        WeeklyDigest({ t, ...payload }),
      ];
    case "UserInvitation":
      return [t("emails.userInvitation.subject"), UserInvitation({ t, ...payload })];
    case "PasswordReset":
      return [t("emails.passwordReset.subject"), PasswordReset({ t, ...payload })];
    case "IntegrityAlert":
      return [
        t("emails.integrityAlert.subject", { count: payload.divergentCount }),
        IntegrityAlert({ t, ...payload }),
      ];
    case "GroupedAlerts":
      return [
        t("emails.groupedAlerts.subject", { count: payload.items.length }),
        GroupedAlerts({ t, ...payload }),
      ];
    case "BackupFailureAlert":
      return [
        t("emails.backupFailure.subject", { hours: payload.hoursSinceSuccess }),
        BackupFailureAlert({ t, ...payload }),
      ];
  }
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * Rend un courriel en HTML **et** en texte brut.
 *
 * ⚠️ Les deux versions sortent du MÊME arbre React. Rédiger le texte à part
 * garantirait qu'il diverge : c'est la version que personne ne relit, et donc
 * celle qui reste fausse le plus longtemps. Ici, une phrase ajoutée au gabarit
 * apparaît dans les deux ou dans aucune.
 *
 * Le texte brut n'est pas une politesse : c'est ce que voient les passerelles
 * anti-spam d'entreprise, les clients configurés en texte seul, et les lecteurs
 * d'écran mal servis par le HTML de courriel.
 */
export async function renderEmail(payload: EmailPayload, locale?: Locale): Promise<RenderedEmail> {
  const t = emailTranslator(locale);
  const [subject, element] = build(payload, t);

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  return { subject, html, text };
}
