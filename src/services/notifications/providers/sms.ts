import { AppError, AppErrorCode } from "@/lib/errors";
import { err, type Result } from "@/lib/result";

/**
 * Canal SMS — DÉCLARÉ, NON IMPLÉMENTÉ.
 *
 * ⚠️ Ce fichier existe pour rendre l'absence explicite. L'énumération
 * `notification_channel` porte la valeur `SMS`, l'interface est écrite, et toute
 * tentative d'envoi échoue avec un message qui dit exactement pourquoi.
 *
 * Ce que cela évite : qu'un administrateur crée une règle de jalon sur le canal
 * SMS, ne reçoive rien, et cherche pendant une semaine où le message s'est
 * perdu. Ici, la file ne se remplit même pas — `due_notification_candidates`
 * écarte le canal à la source — et une invocation directe rend une erreur qui se
 * lit.
 *
 * ⚠️ AUCUNE DÉPENDANCE SMS N'EST INSTALLÉE, et il ne faut pas en installer une
 * « pour préparer ». Une passerelle SMS suppose un contrat opérateur, un format
 * de numéro algérien vérifié, un budget par message et une politique de reprise
 * qui n'ont pas été arbitrés. Le jour où ils le seront, ce fichier gagnera un
 * corps ; il ne manquera rien d'autre.
 */

export interface SmsMessage {
  readonly to: string;
  readonly text: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<Result<string>>;
}

/*
 * L'implémentation IGNORE son argument, et sa signature le dit : elle n'en
 * déclare aucun. TypeScript accepte qu'une méthode en prenne moins que son
 * contrat — c'est plus honnête qu'un paramètre préfixé d'un souligné, qui
 * laisserait croire qu'on a un jour prévu de s'en servir.
 */

export const SMS_NOT_CONFIGURED = "notifications.errors.smsNotConfigured";

export class UnconfiguredSmsProvider implements SmsProvider {
  public readonly name = "unconfigured";

  public send(): Promise<Result<string>> {
    return Promise.resolve(
      err(
        // Le détail nomme le canal : dans un journal, « échec de service externe »
        // sans autre précision oblige à rouvrir le code pour comprendre.
        new AppError(AppErrorCode.EXTERNAL_SERVICE_FAILED, SMS_NOT_CONFIGURED, {
          details: { channel: "SMS", reason: "canal non configuré en v1" },
        }),
      ),
    );
  }
}
