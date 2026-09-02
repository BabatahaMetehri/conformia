import { EmailLayout, EmailList, EmailText } from "@/emails/layout";
import type { EmailTranslator } from "@/lib/translator";

/**
 * Plusieurs alertes, un seul message.
 *
 * ⚠️ ONZIÈME GABARIT, non demandé nommément — et pourtant imposé par la règle de
 * regroupement : « plusieurs alertes pour un même utilisateur dans la même heure
 * sont fusionnées en un unique message ». Il fallait bien que ce message unique
 * ait une forme.
 *
 * Les deux solutions sans nouveau gabarit étaient pires. Concaténer les corps
 * individuels produit un courriel à quatre en-têtes et quatre pieds de page.
 * Réutiliser le résumé hebdomadaire ferait arriver un mardi après-midi un
 * message intitulé « Votre semaine » — le genre de détail qui apprend au
 * destinataire que le système parle sans réfléchir, et donc qu'il peut ne pas
 * l'écouter.
 *
 * Une ligne par dossier, l'échéance, et un lien vers l'échéancier filtré. Le
 * détail de chaque dossier reste derrière l'authentification.
 */

export interface GroupedAlertsProps {
  readonly t: EmailTranslator;
  readonly recipientName: string;
  readonly items: readonly string[];
  readonly listUrl: string;
}

export function GroupedAlerts({ t, recipientName, items, listUrl }: GroupedAlertsProps) {
  return (
    <EmailLayout
      preview={t("emails.groupedAlerts.preview", { count: items.length })}
      heading={t("emails.groupedAlerts.heading", { count: items.length })}
      actionLabel={t("emails.groupedAlerts.openList")}
      actionUrl={listUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.groupedAlerts.lead", { name: recipientName })}</EmailText>
      <EmailList items={items} />
    </EmailLayout>
  );
}
