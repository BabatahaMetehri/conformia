import type { Result } from "@/lib/result";

/**
 * Contrat d'un fournisseur d'envoi.
 *
 * ⚠️ TOUT ce que le reste de l'application sait de l'envoi de courriel tient
 * dans ce fichier. Le planificateur, le diffuseur et les gabarits n'importent ni
 * Resend, ni nodemailer, ni aucune de leurs options : basculer d'un fournisseur
 * à l'autre ne doit toucher AUCUN autre fichier, et c'est vérifiable — il suffit
 * de chercher les importations de ces deux paquets, qui n'existent que dans
 * `resend.ts` et `smtp.ts`.
 *
 * L'interface est délibérément pauvre : un destinataire, un sujet, deux corps.
 * Pas de pièce jointe — l'absence de ce paramètre est ce qui rend l'interdiction
 * effective plutôt que déclarative. Pas de copie cachée, pas d'en-tête libre :
 * chaque option ajoutée ici devrait être implémentée par les deux fournisseurs,
 * et l'une des deux implémentations serait toujours en retard.
 */

export interface EmailMessage {
  readonly to: string;
  readonly toName: string | null;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface EmailProvider {
  /** Identifie le fournisseur dans les journaux. Jamais affiché à l'utilisateur. */
  readonly name: "resend" | "smtp";

  /**
   * Envoie un message.
   *
   * Rend l'identifiant attribué par le fournisseur en cas de succès. Ne lève
   * jamais : un échec d'envoi est un résultat attendu du domaine, pas un bug —
   * et une exception ici interromprait le lot, donc les envois suivants.
   */
  send(message: EmailMessage): Promise<Result<string>>;
}

/**
 * Adresse d'expédition.
 *
 * `conformia@agroespace.dz` par défaut, mais la valeur vient de
 * `app_settings.notification_sender` : changer d'expéditeur est un réglage, pas
 * un déploiement.
 */
export interface ProviderConfig {
  readonly sender: string;
}
