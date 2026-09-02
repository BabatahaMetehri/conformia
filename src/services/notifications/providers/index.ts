import "server-only";

import { env } from "@/config/env";
import { AppError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { ResendProvider } from "./resend";
import { SmtpProvider } from "./smtp";
import type { EmailProvider } from "./types";

export type { EmailMessage, EmailProvider, ProviderConfig } from "./types";
export { UnconfiguredSmsProvider, SMS_NOT_CONFIGURED } from "./sms";
export type { SmsMessage, SmsProvider } from "./sms";

/**
 * Fabrique de fournisseur.
 *
 * ⚠️ LE POINT DE BASCULE, et il tient en un `switch` de six lignes. Le choix
 * vient de `app_settings.email_provider`, donc de la base : passer de Resend au
 * SMTP d'entreprise est une écriture dans une table, relue au lot suivant.
 * Aucun redéploiement, aucune variable à changer sur le serveur, aucun autre
 * fichier touché.
 *
 * La configuration est lue À CHAQUE LOT et non mise en cache dans un module :
 * un fournisseur mémorisé au démarrage survivrait au changement de réglage, et
 * la bascule ne prendrait effet qu'au prochain redémarrage — c'est-à-dire au
 * pire moment, puisqu'on bascule généralement parce que le premier fournisseur
 * ne répond plus.
 */
export function createEmailProvider(
  provider: "resend" | "smtp",
  sender: string,
): Result<EmailProvider> {
  switch (provider) {
    case "resend": {
      const apiKey = env.RESEND_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        return err(
          AppError.externalServiceFailed("resend", {
            details: {
              reason: "RESEND_API_KEY absente",
              // Le message nomme LES DEUX issues : renseigner la clé, ou
              // basculer le réglage. Une erreur qui n'indique qu'une porte
              // laisse chercher la seconde.
              remedy: "Renseigner RESEND_API_KEY, ou passer app_settings.email_provider à 'smtp'.",
            },
          }),
        );
      }
      return ok(new ResendProvider(apiKey, { sender }));
    }

    case "smtp":
      return ok(
        new SmtpProvider(
          {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            user: env.SMTP_USER,
            password: env.SMTP_PASSWORD,
          },
          { sender },
        ),
      );
  }
}
