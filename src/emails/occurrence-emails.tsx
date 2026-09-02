import { EmailFacts, EmailLayout, EmailText } from "@/emails/layout";
import type { EmailTranslator } from "@/lib/translator";

/**
 * Les cinq courriels qui parlent d'UNE occurrence.
 *
 * Ils partagent exactement les mêmes données, et c'est la raison de les réunir :
 * le jour où l'on ajoute une information au bloc de faits, elle doit apparaître
 * dans les cinq. Répartis en cinq fichiers, quatre l'auraient oubliée.
 *
 * ⚠️ CE QUI N'Y FIGURE PAS est aussi important que ce qui y figure : ni montant,
 * ni pièce jointe, ni commentaire, ni nom de document. Le courriel dit qu'il y a
 * quelque chose à faire et où le faire ; le contenu reste derrière
 * l'authentification.
 */

export interface OccurrenceEmailProps {
  readonly t: EmailTranslator;
  readonly obligationName: string;
  readonly obligationCode: string;
  readonly periodLabel: string;
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly authorityName: string | null;
  readonly occurrenceUrl: string;
}

/** Bloc de faits commun. Les cinq gabarits l'emploient sans exception. */
function OccurrenceFacts(props: OccurrenceEmailProps) {
  const { t } = props;
  const facts: (readonly [string, string])[] = [
    [t("emails.common.facts.obligation"), `${props.obligationName} (${props.obligationCode})`],
    [t("emails.common.facts.period"), props.periodLabel],
    [t("emails.common.facts.internalDue"), props.internalDueDate],
    [t("emails.common.facts.legalDue"), props.legalDueDate],
  ];

  if (props.authorityName !== null) {
    facts.push([t("emails.common.facts.authority"), props.authorityName]);
  }

  return <EmailFacts facts={facts} />;
}

/*
 * ⚠️ Les libellés sont passés RÉSOLUS, pas construits à partir d'un nom d'espace.
 * `t(\`emails.${namespace}.preview\`)` compilait, mais échappait au typage des
 * clés de next-intl : une clé absente du catalogue ne se serait vue qu'à
 * l'exécution, dans un courriel déjà parti avec un libellé manquant.
 */
function OccurrenceEmail({
  props,
  preview,
  heading,
  lead,
}: {
  readonly props: OccurrenceEmailProps;
  readonly preview: string;
  readonly heading: string;
  readonly lead: string;
}) {
  const { t } = props;
  return (
    <EmailLayout
      preview={preview}
      heading={heading}
      actionLabel={t("emails.common.viewOccurrence")}
      actionUrl={props.occurrenceUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{lead}</EmailText>
      <OccurrenceFacts {...props} />
    </EmailLayout>
  );
}

/** J-30, J-15, J-7, J-1 — l'échéance approche. */
export function UpcomingDeadline(props: OccurrenceEmailProps & { readonly daysBefore: number }) {
  return (
    <OccurrenceEmail
      props={props}
      preview={props.t("emails.upcomingDeadline.preview")}
      heading={props.t("emails.upcomingDeadline.heading")}
      lead={props.t("emails.upcomingDeadline.lead", { days: props.daysBefore })}
    />
  );
}

/** J+1, J+3, J+7 — l'échéance interne est passée. */
export function OverdueAlert(props: OccurrenceEmailProps & { readonly daysAfter: number }) {
  return (
    <OccurrenceEmail
      props={props}
      preview={props.t("emails.overdueAlert.preview")}
      heading={props.t("emails.overdueAlert.heading")}
      lead={props.t("emails.overdueAlert.lead", { days: props.daysAfter })}
    />
  );
}

/** Un dossier attend LA validation du destinataire. */
export function ValidationRequested(props: OccurrenceEmailProps) {
  return (
    <OccurrenceEmail
      props={props}
      preview={props.t("emails.validationRequested.preview")}
      heading={props.t("emails.validationRequested.heading")}
      lead={props.t("emails.validationRequested.lead")}
    />
  );
}

/**
 * Un dossier a été rejeté.
 *
 * ⚠️ Le MOTIF est repris — c'est la seule exception à la règle « rien du
 * contenu ». Un rejet sans son motif oblige le destinataire à ouvrir
 * l'application pour apprendre ce qu'il aurait dû lire ici, et le motif est une
 * appréciation sur le travail, pas une donnée fiscale.
 */
export function SubmissionRejected(props: OccurrenceEmailProps & { readonly reason: string }) {
  const { t } = props;
  return (
    <EmailLayout
      preview={t("emails.submissionRejected.preview")}
      heading={t("emails.submissionRejected.heading")}
      actionLabel={t("emails.common.viewOccurrence")}
      actionUrl={props.occurrenceUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.submissionRejected.lead")}</EmailText>
      <OccurrenceFacts {...props} />
      <EmailText>
        <strong>{t("emails.submissionRejected.reasonLabel")} :</strong> {props.reason}
      </EmailText>
    </EmailLayout>
  );
}

/**
 * Escalade : le destinataire n'est PAS le porteur du dossier.
 *
 * Le libellé le dit explicitement. Un responsable de service qui reçoit une
 * alerte rédigée comme si elle lui était destinée cherche d'abord ce qu'il a
 * lui-même oublié de faire.
 */
export function EscalationNotice(
  props: OccurrenceEmailProps & { readonly daysAfter: number; readonly ownerName: string },
) {
  const { t } = props;
  return (
    <EmailLayout
      preview={t("emails.escalation.preview")}
      heading={t("emails.escalation.heading")}
      actionLabel={t("emails.common.viewOccurrence")}
      actionUrl={props.occurrenceUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>
        {t("emails.escalation.lead", { days: props.daysAfter, owner: props.ownerName })}
      </EmailText>
      <OccurrenceFacts {...props} />
    </EmailLayout>
  );
}
