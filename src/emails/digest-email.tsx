import { Heading } from "@react-email/components";

import { EmailLayout, EmailList, EmailText, emailStyles } from "@/emails/layout";
import type { EmailTranslator } from "@/emails/translator";

/**
 * Résumé hebdomadaire — lundi 07 h 00, heure d'Alger.
 *
 * ⚠️ Le seul courriel qui énumère PLUSIEURS dossiers. Il reste soumis à la même
 * règle : une ligne par dossier, libellé et échéance, rien d'autre. Une liste
 * plus riche serait un extrait de la base envoyé par courriel.
 *
 * Chaque section est tronquée. Un résumé de quatre-vingts lignes n'est pas lu,
 * donc n'est pas un résumé ; le reste est derrière le lien.
 */

export interface DigestSection {
  /** Déjà traduit : voir occurrence-emails.tsx pour la raison. */
  readonly title: string;
  readonly items: readonly string[];
  readonly hiddenCount: number;
}

export interface WeeklyDigestProps {
  readonly t: EmailTranslator;
  readonly recipientName: string;
  readonly weekLabel: string;
  readonly sections: readonly DigestSection[];
  readonly dashboardUrl: string;
}

export function WeeklyDigest({
  t,
  recipientName,
  weekLabel,
  sections,
  dashboardUrl,
}: WeeklyDigestProps) {
  const populated = sections.filter((section) => section.items.length > 0);

  return (
    <EmailLayout
      preview={t("emails.weeklyDigest.preview", { week: weekLabel })}
      heading={t("emails.weeklyDigest.heading", { week: weekLabel })}
      actionLabel={t("emails.weeklyDigest.openDashboard")}
      actionUrl={dashboardUrl}
      footer={t("emails.common.footer")}
    >
      <EmailText>{t("emails.weeklyDigest.lead", { name: recipientName })}</EmailText>

      {populated.length === 0 ? (
        // Un résumé vide est une information : « rien ne vous attend » vaut mieux
        // qu'un silence, qui se confond avec une panne d'envoi.
        <EmailText>{t("emails.weeklyDigest.nothing")}</EmailText>
      ) : (
        populated.map((section) => (
          <div key={section.title}>
            <Heading
              as="h2"
              style={{ ...emailStyles.heading, fontSize: "15px", margin: "18px 0 8px" }}
            >
              {section.title}
            </Heading>
            <EmailList items={section.items} />
            {section.hiddenCount > 0 ? (
              <EmailText>
                {t("emails.weeklyDigest.andMore", { count: section.hiddenCount })}
              </EmailText>
            ) : null}
          </div>
        ))
      )}
    </EmailLayout>
  );
}
