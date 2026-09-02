import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

/**
 * Coquille commune à tous les courriels.
 *
 * ⚠️ AUCUNE IMAGE, nulle part — ni logo, ni pixel, ni icône. Outlook bloque les
 * images distantes par défaut en entreprise : un courriel dont le sens dépend
 * d'une image arrive vide chez la moitié des destinataires, et personne ne le
 * signale. Le rendu doit être complet en texte seul.
 *
 * ⚠️ STYLES EN LIGNE et mise en page par blocs. Les clients de messagerie
 * d'entreprise ignorent `<style>`, les classes, la grille et les variables CSS.
 * Ce fichier est le SEUL endroit de l'application où l'on écrit des styles à la
 * main ; ailleurs, c'est Tailwind. La contrainte vient du support, pas du goût.
 *
 * ⚠️ AUCUNE DONNÉE CONFIDENTIELLE ne traverse cette coquille : un courriel
 * transite par des serveurs qu'on ne maîtrise pas et se conserve indéfiniment
 * dans des boîtes qu'on ne maîtrise pas davantage. Libellé, période, échéance,
 * lien. Jamais un montant, jamais une pièce jointe, jamais un extrait de
 * document.
 */

const colors = {
  text: "#1a1a1a",
  muted: "#5c5c5c",
  border: "#e2e2e2",
  surface: "#ffffff",
  page: "#f5f5f4",
} as const;

const styles = {
  body: {
    backgroundColor: colors.page,
    margin: "0",
    padding: "24px 0",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: colors.text,
  },
  container: {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: "6px",
    margin: "0 auto",
    maxWidth: "560px",
    padding: "28px 32px",
  },
  heading: { fontSize: "18px", fontWeight: 600, lineHeight: "26px", margin: "0 0 12px" },
  text: { fontSize: "14px", lineHeight: "22px", margin: "0 0 12px" },
  muted: { fontSize: "12px", lineHeight: "18px", color: colors.muted, margin: "0" },
  hr: { borderColor: colors.border, margin: "24px 0 16px" },
  /*
   * Le lien d'action est un LIEN, pas un bouton peint. Un bouton en HTML de
   * courriel est une table imbriquée avec un fond, que plusieurs clients rendent
   * comme un rectangle noir ou suppriment. Un lien souligné fonctionne partout,
   * y compris lu à voix haute.
   */
  action: { fontSize: "14px", fontWeight: 600, textDecoration: "underline", color: colors.text },
} as const;

export interface LayoutProps {
  /** Résumé affiché par le client avant ouverture. */
  readonly preview: string;
  readonly heading: string;
  readonly children: ReactNode;
  readonly actionLabel?: string;
  readonly actionUrl?: string;
  readonly footer: string;
}

export function EmailLayout({
  preview,
  heading,
  children,
  actionLabel,
  actionUrl,
  footer,
}: LayoutProps) {
  return (
    <Html lang="fr" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          {children}
          {actionUrl === undefined || actionLabel === undefined ? null : (
            <Section style={{ margin: "20px 0 0" }}>
              <Link href={actionUrl} style={styles.action}>
                {actionLabel}
              </Link>
            </Section>
          )}
          <Hr style={styles.hr} />
          <Text style={styles.muted}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Paragraphe courant. Exporté pour que les gabarits ne redéfinissent pas le style. */
export function EmailText({ children }: { readonly children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

/**
 * Liste « libellé : valeur ».
 *
 * Rendue en paragraphes et NON en table : les tables de mise en forme sont
 * annoncées comme telles par les lecteurs d'écran, qui énoncent alors « tableau
 * de deux colonnes » avant chaque ligne.
 */
export function EmailFacts({ facts }: { readonly facts: readonly (readonly [string, string])[] }) {
  return (
    <Section>
      {facts.map(([label, value]) => (
        <Text key={label} style={{ ...styles.text, margin: "0 0 4px" }}>
          <strong>{label} :</strong> {value}
        </Text>
      ))}
    </Section>
  );
}

/** Liste à puces, pour les résumés. */
export function EmailList({ items }: { readonly items: readonly string[] }) {
  return (
    <Section style={{ margin: "0 0 12px" }}>
      {items.map((item) => (
        <Text key={item} style={{ ...styles.text, margin: "0 0 2px" }}>
          — {item}
        </Text>
      ))}
    </Section>
  );
}

export const emailStyles = styles;
