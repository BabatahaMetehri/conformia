import { EmailFacts, EmailLayout, EmailText } from "@/emails/layout";
import type { OccurrenceEmailProps } from "@/emails/occurrence-emails";

/**
 * Les deux courriels que la triade a rendus nécessaires.
 *
 * ⚠️ MÊME DISCIPLINE QUE LES CINQ AUTRES : ni montant, ni pièce jointe, ni nom
 * de document, ni numéro de référence, ni motif détaillé. Ces courriels disent
 * qu'il y a quelque chose à faire, à quel titre, et où le faire. Le contenu
 * reste derrière l'authentification.
 *
 * Le seul NOM PROPRE qu'ils portent est celui d'un collègue — le responsable
 * absent, ou celui dont on devient suppléant. Ce n'est pas une donnée
 * confidentielle : c'est l'information sans laquelle le message serait
 * incompréhensible. « Vous recevez cette alerte en tant que suppléant » sans
 * dire de qui laisse chercher.
 */

/** Bloc de faits, identique à celui des courriels d'occurrence. */
function Facts(props: OccurrenceEmailProps) {
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

/**
 * Alerte DÉROUTÉE : le destinataire prévu est absent, son suppléant la reçoit.
 *
 * ⚠️ LA MENTION EST EN PREMIER, avant les faits. Sans elle, le suppléant reçoit
 * une alerte sur un dossier dont il n'est pas responsable et cherche d'abord ce
 * qu'il a lui-même oublié de faire — exactement le réflexe que l'escalade
 * provoque déjà chez un superviseur, et qu'on a corrigé là-bas pour la même
 * raison.
 */
export function AbsenceRouting(
  props: OccurrenceEmailProps & {
    readonly absentName: string;
    /** Jours restants (négatif) ou écoulés (positif) par rapport à l'échéance interne. */
    readonly offsetDays: number;
  },
) {
  const { t } = props;
  return (
    <EmailLayout
      preview={t("emails.absenceRouting.preview")}
      heading={t("emails.absenceRouting.heading")}
      actionLabel={t("emails.common.viewOccurrence")}
      actionUrl={props.occurrenceUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>
        <strong>{t("emails.absenceRouting.notice", { absent: props.absentName })}</strong>
      </EmailText>
      <EmailText>
        {props.offsetDays < 0
          ? t("emails.upcomingDeadline.lead", { days: Math.abs(props.offsetDays) })
          : t("emails.overdueAlert.lead", { days: props.offsetDays })}
      </EmailText>
      <Facts {...props} />
      {/*
       * ⚠️ On DIT que l'absent garde la trace. Sans cela, le suppléant peut
       * croire qu'il doit prévenir son collègue à son retour, et le collègue
       * peut croire qu'on a traité son dossier dans son dos.
       */}
      <EmailText>{t("emails.absenceRouting.inAppNote")}</EmailText>
    </EmailLayout>
  );
}

/**
 * Désignation comme SUPPLÉANT d'un dossier.
 *
 * ⚠️ CE COURRIEL EXISTE POUR ÉVITER UNE SURPRISE. Le suppléant a, dès sa
 * désignation, les mêmes droits que le responsable — il peut agir en
 * permanence, sans attendre aucune absence. Le lui apprendre le jour où une
 * alerte lui tombe dessus serait tardif : il faut qu'il sache AVANT qu'il porte
 * une responsabilité sur ce dossier, et que ses actes y seront tracés à ce
 * titre.
 */
export function DeputyNotice(props: OccurrenceEmailProps & { readonly ownerName: string }) {
  const { t } = props;
  return (
    <EmailLayout
      preview={t("emails.deputyNotice.preview")}
      heading={t("emails.deputyNotice.heading")}
      actionLabel={t("emails.common.viewOccurrence")}
      actionUrl={props.occurrenceUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.deputyNotice.lead", { owner: props.ownerName })}</EmailText>
      <Facts {...props} />
      <EmailText>{t("emails.deputyNotice.rights")}</EmailText>
    </EmailLayout>
  );
}
