import { describe, expect, it } from "vitest";

import {
  CHANNEL_NOT_CONFIGURED,
  DORMANT_CHANNELS,
  UnconfiguredChannelProvider,
  type DormantChannelProvider,
} from "@/services/notifications/providers/dormant-channels";
import { AppErrorCode } from "@/lib/errors";
import fr from "@/i18n/messages/fr.json";
import ar from "@/i18n/messages/ar.json";

/**
 * CANAUX DORMANTS.
 *
 * ⚠️ DÉCISION ARRÊTÉE : le courriel est le SEUL canal externe. `SMS` et
 * `WHATSAPP` restent déclarés dans le modèle, et ne partent jamais.
 *
 * Un canal déclaré mais muet est un piège : un administrateur crée une règle,
 * n'obtient rien, et cherche l'incident dans les journaux d'envoi — où il n'y a
 * rien à trouver, puisque rien n'a été tenté. Ce fichier vérifie les deux
 * propriétés qui transforment ce piège en refus lisible : l'erreur NOMME le
 * canal, et elle est RENDUE plutôt que levée.
 */

describe("canaux dormants", () => {
  it("les deux canaux du modèle sont déclarés dormants", () => {
    /*
     * ⚠️ La liste est ici ET dans l'énumération `notification_channel`. Un canal
     * ajouté en base sans l'être ici n'aurait aucun refus à opposer : il
     * échouerait plus loin, sur un « fournisseur introuvable » qui ne dirait pas
     * qu'il s'agit d'un choix.
     */
    expect([...DORMANT_CHANNELS]).toEqual(["SMS", "WHATSAPP"]);
  });

  it.each([...DORMANT_CHANNELS])(
    "%s : l'envoi rend une erreur qui NOMME le canal",
    async (canal) => {
      /*
       * ⚠️ Typé par l'INTERFACE, et non par la classe. L'implantation ignore son
       * argument et n'en déclare aucun — un choix assumé, plus honnête qu'un
       * paramètre préfixé d'un souligné. Les appelants, eux, passent bien un
       * message : c'est donc leur point de vue qu'il faut éprouver.
       */
      const fournisseur: DormantChannelProvider = new UnconfiguredChannelProvider(canal);
      const resultat = await fournisseur.send({ to: "+213555000000", text: "Rappel" });

      expect(resultat.ok).toBe(false);
      if (resultat.ok) return;

      expect(resultat.error.code).toBe(AppErrorCode.EXTERNAL_SERVICE_FAILED);
      expect(resultat.error.message).toBe(CHANNEL_NOT_CONFIGURED);
      /*
       * ⚠️ Le canal est dans les DÉTAILS, pas dans le texte. Le message est une clé
       * i18n : y écrire « Canal SMS non configuré » obligerait à une clé par canal,
       * et la traduction arabe divergerait au premier ajout.
       */
      expect(resultat.error.details?.["channel"]).toBe(canal);
    },
  );

  it.each([...DORMANT_CHANNELS])("%s : l'envoi ne LÈVE jamais", async (canal) => {
    /*
     * ⚠️ C'EST LA PROPRIÉTÉ QUI PROTÈGE LE LOT. Une exception ici remonterait
     * dans la boucle du diffuseur et emporterait les envois suivants : une règle
     * SMS égarée ferait perdre les courriels du même cycle. On l'éprouve donc
     * explicitement, plutôt que de se fier à la lecture du corps de la méthode.
     */
    const fournisseur: DormantChannelProvider = new UnconfiguredChannelProvider(canal);
    await expect(fournisseur.send({ to: "", text: "" })).resolves.toBeDefined();
  });

  it("la clé du refus existe dans les DEUX catalogues", () => {
    // Un refus dont le libellé manque s'affiche sous forme de clé brute — le
    // destinataire lit alors « notifications.errors.channelNotConfigured ».
    const chemin = CHANNEL_NOT_CONFIGURED.split(".");
    for (const [nom, catalogue] of [
      ["fr", fr],
      ["ar", ar],
    ] as const) {
      let noeud: unknown = catalogue;
      for (const segment of chemin) {
        expect(
          typeof noeud === "object" && noeud !== null,
          `${nom} : ${CHANNEL_NOT_CONFIGURED}`,
        ).toBe(true);
        noeud = (noeud as Record<string, unknown>)[segment];
      }
      expect(typeof noeud, nom).toBe("string");
    }
  });
});
