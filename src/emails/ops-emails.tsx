import { EmailFacts, EmailLayout, EmailText } from "@/emails/layout";
import type { EmailTranslator } from "@/lib/translator";

/**
 * Courriels d'exploitation, adressés aux administrateurs.
 *
 * ⚠️ Ils nomment un incident et un ordre de grandeur, jamais un document. « 3
 * documents divergents » est actionnable ; nommer les fichiers concernés
 * publierait par courriel la liste des pièces sensibles à surveiller — soit
 * exactement ce qu'un attaquant cherche.
 *
 * ⚠️ Aucun de ces deux courriels n'est déclenché par un utilisateur. Ils
 * viennent des tâches planifiées, et leur destinataire est un rôle, pas une
 * personne : un administrateur en congé ne doit pas rendre l'alerte muette.
 */

export interface IntegrityAlertProps {
  readonly t: EmailTranslator;
  readonly checkedCount: number;
  readonly divergentCount: number;
  readonly checkedAt: string;
  readonly reportUrl: string;
}

export function IntegrityAlert({
  t,
  checkedCount,
  divergentCount,
  checkedAt,
  reportUrl,
}: IntegrityAlertProps) {
  return (
    <EmailLayout
      preview={t("emails.integrityAlert.preview", { count: divergentCount })}
      heading={t("emails.integrityAlert.heading")}
      actionLabel={t("emails.integrityAlert.openReport")}
      actionUrl={reportUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.integrityAlert.lead", { count: divergentCount })}</EmailText>
      <EmailFacts
        facts={[
          [t("emails.integrityAlert.checkedAt"), checkedAt],
          [t("emails.integrityAlert.checked"), String(checkedCount)],
          [t("emails.integrityAlert.divergent"), String(divergentCount)],
        ]}
      />
      <EmailText>{t("emails.integrityAlert.doNotDelete")}</EmailText>
    </EmailLayout>
  );
}

export interface BackupFailureProps {
  readonly t: EmailTranslator;
  readonly lastSuccessAt: string | null;
  readonly hoursSinceSuccess: number;
  readonly reportUrl: string;
}

export function BackupFailureAlert({
  t,
  lastSuccessAt,
  hoursSinceSuccess,
  reportUrl,
}: BackupFailureProps) {
  return (
    <EmailLayout
      preview={t("emails.backupFailure.preview", { hours: hoursSinceSuccess })}
      heading={t("emails.backupFailure.heading")}
      actionLabel={t("emails.backupFailure.openReport")}
      actionUrl={reportUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.backupFailure.lead", { hours: hoursSinceSuccess })}</EmailText>
      <EmailFacts
        facts={[
          [
            t("emails.backupFailure.lastSuccess"),
            // « Jamais » n'est pas « inconnu » : une installation qui n'a jamais
            // sauvegardé doit le lire en toutes lettres, pas voir un tiret.
            lastSuccessAt ?? t("emails.backupFailure.never"),
          ],
        ]}
      />
    </EmailLayout>
  );
}
