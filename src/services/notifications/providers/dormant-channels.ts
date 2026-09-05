import { AppError, AppErrorCode } from "@/lib/errors";
import { err, type Result } from "@/lib/result";

/**
 * Canaux DÉCLARÉS, NON IMPLÉMENTÉS.
 *
 * ⚠️ DÉCISION ARRÊTÉE : LE COURRIEL EST LE SEUL CANAL EXTERNE. `SMS` et
 * `WHATSAPP` existent dans l'énumération `notification_channel` — le modèle les
 * prévoit — mais aucun ne part. Ce fichier existe pour rendre cette absence
 * EXPLICITE plutôt que silencieuse.
 *
 * Ce que cela évite : qu'un administrateur crée une règle de jalon sur le canal
 * SMS, ne reçoive rien, et cherche pendant une semaine où le message s'est
 * perdu. Deux barrières le lui disent :
 *
 *  1. `due_notification_candidates` écarte ces canaux À LA SOURCE — la file ne
 *     se remplit même pas, donc aucune ligne ne s'accumule en échec ;
 *  2. une invocation directe rend une erreur qui NOMME le canal.
 *
 * ⚠️ L'ERREUR EST RENDUE, PAS LEVÉE. Une exception ici interromprait la boucle
 * du diffuseur, donc les envois suivants : une règle SMS égarée ferait perdre
 * les courriels du même lot. C'est la même promesse que celle d'`EmailProvider`,
 * et elle vaut d'autant plus pour un canal qui échoue TOUJOURS.
 *
 * ⚠️ AUCUNE DÉPENDANCE SMS OU WHATSAPP N'EST INSTALLÉE, et il ne faut pas en
 * installer une « pour préparer ». Une passerelle suppose un contrat opérateur,
 * un format de numéro algérien vérifié, un budget par message et une politique
 * de reprise qui n'ont pas été arbitrés. Le jour où ils le seront, ce fichier
 * gagnera un corps ; il ne manquera rien d'autre.
 */

/** Les canaux que le modèle déclare sans les servir. */
export const DORMANT_CHANNELS = ["SMS", "WHATSAPP"] as const;

export type DormantChannel = (typeof DORMANT_CHANNELS)[number];

export interface DormantMessage {
  /** Numéro, identifiant de compte — la forme dépendra de la passerelle. */
  readonly to: string;
  readonly text: string;
}

export interface DormantChannelProvider {
  readonly name: string;
  readonly channel: DormantChannel;
  send(message: DormantMessage): Promise<Result<string>>;
}

/** Clé i18n du refus. Le canal concerné voyage dans `details`, pas dans le texte. */
export const CHANNEL_NOT_CONFIGURED = "notifications.errors.channelNotConfigured";

/*
 * L'implémentation IGNORE son argument, et sa signature le dit : elle n'en
 * déclare aucun. TypeScript accepte qu'une méthode en prenne moins que son
 * contrat — c'est plus honnête qu'un paramètre préfixé d'un souligné, qui
 * laisserait croire qu'on a un jour prévu de s'en servir.
 */
export class UnconfiguredChannelProvider implements DormantChannelProvider {
  public readonly name = "unconfigured";

  constructor(public readonly channel: DormantChannel) {}

  public send(): Promise<Result<string>> {
    return Promise.resolve(
      err(
        // Le détail NOMME le canal : dans un journal, « échec de service
        // externe » sans autre précision oblige à rouvrir le code pour
        // comprendre lequel des deux a été sollicité.
        new AppError(AppErrorCode.EXTERNAL_SERVICE_FAILED, CHANNEL_NOT_CONFIGURED, {
          details: { channel: this.channel, reason: "canal non configuré en v1" },
        }),
      ),
    );
  }
}
