import "server-only";

import { Resend } from "resend";

import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import type { EmailMessage, EmailProvider, ProviderConfig } from "./types";

/**
 * Fournisseur par défaut.
 *
 * Retenu pour sa délivrabilité et parce que son offre gratuite (3 000 messages
 * par mois) dépasse largement le besoin estimé — de l'ordre de 300 par mois.
 * Ce n'est donc pas un choix définitif : c'est le choix qui coûte le moins tant
 * que le volume reste ce qu'il est, et la bascule vers le serveur d'entreprise
 * est un réglage en base.
 *
 * ⚠️ SEUL FICHIER de l'application à importer `resend`. La règle ESLint
 * `no-restricted-imports` le vérifie ; sans elle, la promesse « changer de
 * fournisseur ne touche aucun autre fichier » s'éroderait au premier raccourci.
 */
export class ResendProvider implements EmailProvider {
  public readonly name = "resend" as const;

  private readonly client: Resend;
  private readonly sender: string;

  constructor(apiKey: string, config: ProviderConfig) {
    this.client = new Resend(apiKey);
    this.sender = config.sender;
  }

  public async send(message: EmailMessage): Promise<Result<string>> {
    try {
      const response = await this.client.emails.send({
        from: this.sender,
        // Le nom du destinataire n'est PAS repris dans l'en-tête `to` : il vient
        // de la base et pourrait contenir une virgule ou un chevron, qui font
        // basculer l'analyseur d'adresses sur un second destinataire.
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      if (response.error !== null) {
        return err(
          AppError.externalServiceFailed(this.name, {
            details: { reason: response.error.message },
          }),
        );
      }

      return ok(response.data.id);
    } catch (cause) {
      return err(AppError.externalServiceFailed(this.name, { cause }));
    }
  }
}
