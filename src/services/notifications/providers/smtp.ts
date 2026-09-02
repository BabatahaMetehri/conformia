import "server-only";

import { createTransport, type Transporter } from "nodemailer";

import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import type { EmailMessage, EmailProvider, ProviderConfig } from "./types";

export interface SmtpCredentials {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

/**
 * Fournisseur de repli : le serveur de messagerie d'AGROESPACE.
 *
 * Existe pour une raison précise et prévisible — le jour où la direction des
 * systèmes d'information exigera que le courrier sortant passe par
 * l'infrastructure maison. Ce jour-là, la bascule est une ligne dans
 * `app_settings.email_provider` ; l'écrire après coup aurait demandé de démonter
 * le diffuseur en urgence.
 *
 * ⚠️ SEUL FICHIER de l'application à importer `nodemailer`.
 */
export class SmtpProvider implements EmailProvider {
  public readonly name = "smtp" as const;

  private readonly transporter: Transporter;
  private readonly sender: string;

  constructor(credentials: SmtpCredentials, config: ProviderConfig) {
    this.transporter = createTransport({
      host: credentials.host,
      port: credentials.port,
      /*
       * 465 est le port du TLS implicite ; 587 celui de STARTTLS, où la
       * connexion s'ouvre en clair puis se chiffre. Déduire le mode du port
       * plutôt que de le configurer évite la combinaison qui échoue en silence :
       * `secure: true` sur 587 attend une poignée de main TLS qui ne vient
       * jamais, et le lot expire sans message d'erreur utile.
       */
      secure: credentials.port === 465,
      auth: { user: credentials.user, pass: credentials.password },
      // Un serveur d'entreprise injoignable ne doit pas bloquer le lot horaire.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.sender = config.sender;
  }

  public async send(message: EmailMessage): Promise<Result<string>> {
    try {
      /*
       * ⚠️ VÉRIFIÉ À L'EXÉCUTION plutôt que promis par un type. nodemailer déclare
       * son retour `SentMessageInfo`, qui est un alias de `any` : l'annoter
       * n'apporterait aucune garantie, seulement l'apparence d'une. On regarde
       * donc ce qui revient — un serveur SMTP d'entreprise peut parfaitement
       * répondre sans identifiant de message.
       */
      const info: unknown = await this.transporter.sendMail({
        from: this.sender,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      const messageId =
        typeof info === "object" &&
        info !== null &&
        "messageId" in info &&
        typeof info.messageId === "string"
          ? info.messageId
          : "";

      return ok(messageId);
    } catch (cause) {
      return err(AppError.externalServiceFailed(this.name, { cause }));
    }
  }
}
