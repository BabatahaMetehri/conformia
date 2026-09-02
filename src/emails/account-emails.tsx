import { EmailLayout, EmailText } from "@/emails/layout";
import type { EmailTranslator } from "@/lib/translator";

/**
 * Courriels de compte.
 *
 * ⚠️ Ces deux-là portent un LIEN À USAGE UNIQUE, et c'est tout ce qu'ils
 * portent. Jamais de mot de passe, jamais de mot de passe provisoire, jamais un
 * identifiant accompagné d'un secret : un courriel se conserve indéfiniment dans
 * des boîtes que nous ne maîtrisons pas, et se transfère.
 *
 * ⚠️ La durée de validité est ÉCRITE dans le message. Un lien expiré sans
 * explication se lit comme une panne, et produit un appel au support là où une
 * phrase suffisait.
 */

export interface InvitationProps {
  readonly t: EmailTranslator;
  readonly inviterName: string;
  readonly roleLabel: string;
  readonly acceptUrl: string;
  readonly expiresInHours: number;
}

export function UserInvitation({
  t,
  inviterName,
  roleLabel,
  acceptUrl,
  expiresInHours,
}: InvitationProps) {
  return (
    <EmailLayout
      preview={t("emails.userInvitation.preview")}
      heading={t("emails.userInvitation.heading")}
      actionLabel={t("emails.userInvitation.accept")}
      actionUrl={acceptUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.userInvitation.lead", { inviter: inviterName })}</EmailText>
      <EmailText>{t("emails.userInvitation.role", { role: roleLabel })}</EmailText>
      <EmailText>{t("emails.userInvitation.expiry", { hours: expiresInHours })}</EmailText>
      <EmailText>{t("emails.userInvitation.choosePassword")}</EmailText>
    </EmailLayout>
  );
}

export interface PasswordResetProps {
  readonly t: EmailTranslator;
  readonly resetUrl: string;
  readonly expiresInMinutes: number;
}

export function PasswordReset({ t, resetUrl, expiresInMinutes }: PasswordResetProps) {
  return (
    <EmailLayout
      preview={t("emails.passwordReset.preview")}
      heading={t("emails.passwordReset.heading")}
      actionLabel={t("emails.passwordReset.reset")}
      actionUrl={resetUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.passwordReset.lead")}</EmailText>
      <EmailText>{t("emails.passwordReset.expiry", { minutes: expiresInMinutes })}</EmailText>
      {/* Dire quoi faire si l'on n'a rien demandé : c'est ainsi qu'une tentative
          d'usurpation remonte, et le seul canal par lequel elle peut remonter. */}
      <EmailText>{t("emails.passwordReset.ignore")}</EmailText>
    </EmailLayout>
  );
}
