import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { createTransport } from "nodemailer";

import { mailpitSmtpPort } from "./mailpit";

/**
 * RELAIS HTTP → SMTP, pour éprouver le fournisseur Resend EN VRAI.
 *
 * ⚠️ CE N'EST PAS UN SIMULACRE DE NOTRE CODE, ET LA DISTINCTION EST TOUT.
 *
 * `ResendProvider` s'exécute ici SANS AUCUNE MODIFICATION : c'est le vrai SDK
 * `resend` qui construit la requête, la signe avec la clé, l'envoie en HTTP et
 * interprète la réponse. Ce relais ne remplace que le DATACENTRE de Resend —
 * qu'on ne peut évidemment pas avoir en local — et il fait de la requête reçue
 * un vrai message SMTP, remis à Mailpit. Un défaut de notre fournisseur (un
 * champ mal nommé, un texte brut oublié, une adresse mal formée) se voit donc
 * exactement là où il se verrait en production : dans le message qui arrive, ou
 * qui n'arrive pas.
 *
 * ⚠️ LE SDK LE TROUVE SEUL, PAR `RESEND_BASE_URL`. Le paquet `resend` lit cette
 * variable à la construction du client. Il n'a donc fallu toucher NI
 * `resend.ts`, NI la fabrique de fournisseurs : l'interchangeabilité éprouvée
 * est celle du code de production, pas celle d'une variante écrite pour le test.
 *
 * ⚠️ POURQUOI PAS UN `vi.mock` DE `resend` : parce qu'il vérifierait qu'on
 * appelle une fonction. Il ne vérifierait ni que la requête part, ni qu'elle
 * porte le bon destinataire, ni que le corps HTML et le texte brut y sont tous
 * les deux, ni que la réponse est correctement dépliée. C'est précisément la
 * liste de ce qui casse.
 */

/** Réponse d'erreur de Resend, telle que son SDK l'attend. */
interface ErreurResend {
  readonly statusCode: number;
  readonly message: string;
  readonly name: string;
}

export interface ResendShim {
  /** À placer dans `RESEND_BASE_URL` avant la diffusion. */
  readonly baseUrl: string;
  /** Nombre de requêtes d'envoi reçues — donc de TENTATIVES, reprises comprises. */
  requestCount(): number;
  /** Adresses des messages effectivement relayés vers Mailpit. */
  relayed(): readonly string[];
  /**
   * Fait REFUSER cette adresse, comme Resend refuse une adresse invalide.
   *
   * ⚠️ Un refus par le fournisseur, et non une exception de notre code : c'est
   * la seule façon d'éprouver que l'échec d'UN destinataire n'emporte pas les
   * autres. Une erreur levée dans notre boucle prouverait autre chose.
   */
  reject(address: string): void;
  /**
   * Fait répondre « 200, corps vide » pour cette adresse.
   *
   * ⚠️ LE CAS DU FOURNISSEUR QUI RÉPOND MAL, et non de celui qui refuse. Le SDK
   * rend alors `{ data: null, error: null }` : ni succès exploitable, ni erreur
   * déclarée. C'est l'unique façon d'atteindre le filet de `ResendProvider`, et
   * c'est un incident réel — une passerelle d'entreprise, un proxy mal configuré
   * ou une maintenance côté fournisseur produisent exactement cela.
   */
  respondEmpty(address: string): void;
  /** Coupe le relais. Le port cesse de répondre : panne totale du fournisseur. */
  stop(): Promise<void>;
}

interface CorpsEnvoi {
  readonly from?: string;
  readonly to?: string[] | string;
  readonly subject?: string;
  readonly html?: string;
  readonly text?: string;
}

function lireCorps(chunks: Buffer[]): CorpsEnvoi {
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as CorpsEnvoi;
  } catch {
    return {};
  }
}

function premierDestinataire(corps: CorpsEnvoi): string {
  const { to } = corps;
  if (typeof to === "string") return to;
  return to?.[0] ?? "";
}

export async function startResendShim(): Promise<ResendShim> {
  const transport = createTransport({
    host: "127.0.0.1",
    port: mailpitSmtpPort(),
    secure: false,
    // Mailpit n'exige aucune authentification ; le relais n'en présente donc pas.
    ignoreTLS: true,
    /*
     * ⚠️ CONNEXION RÉUTILISÉE, ET UNE SEULE. Sans mise en réserve, chaque message
     * ouvre puis referme une session SMTP : sur un lot de cinquante, l'une
     * d'elles finit par échouer, et l'échec s'impute alors au diffuseur alors
     * qu'il vient du relais de test. Une seule connexion, tenue ouverte, rend le
     * relais neutre — ce qu'un instrument de mesure doit être.
     */
    pool: true,
    maxConnections: 1,
  });

  const refusees = new Set<string>();
  const vides = new Set<string>();
  const relayes: string[] = [];
  let requetes = 0;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));

    request.on("end", () => {
      void (async () => {
        if (request.method !== "POST" || !(request.url ?? "").startsWith("/emails")) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ message: "not found", name: "not_found" }));
          return;
        }

        requetes += 1;
        const corps = lireCorps(chunks);
        const destinataire = premierDestinataire(corps);

        if (refusees.has(destinataire)) {
          /*
           * 422, le code que Resend rend pour une adresse invalide. Notre
           * fournisseur le traduit en `Result` en erreur, et le diffuseur doit
           * alors consommer une tentative POUR CETTE LIGNE SEULEMENT.
           */
          const erreur: ErreurResend = {
            statusCode: 422,
            message: `Invalid recipient: ${destinataire}`,
            name: "validation_error",
          };
          response.writeHead(422, { "Content-Type": "application/json" });
          response.end(JSON.stringify(erreur));
          return;
        }

        if (vides.has(destinataire)) {
          // 200, et un corps que le SDK déplie en `data: null, error: null`.
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("null");
          return;
        }

        try {
          await transport.sendMail({
            from: corps.from ?? "",
            to: destinataire,
            subject: corps.subject ?? "",
            html: corps.html ?? "",
            text: corps.text ?? "",
          });
          relayes.push(destinataire);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ id: randomUUID() }));
        } catch (cause) {
          const erreur: ErreurResend = {
            statusCode: 500,
            message: cause instanceof Error ? cause.message : String(cause),
            name: "application_error",
          };
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify(erreur));
        }
      })();
    });
  });

  await new Promise<void>((resolve) => {
    // Port ÉPHÉMÈRE : deux exécutions concurrentes ne doivent pas se disputer un
    // numéro écrit en dur, et un port resté occupé par une exécution précédente
    // ferait échouer la suite sur « address in use » plutôt que sur un défaut.
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requestCount: () => requetes,
    relayed: () => [...relayes],
    reject: (address_) => refusees.add(address_),
    respondEmpty: (address_) => vides.add(address_),
    stop: () =>
      new Promise<void>((resolve) => {
        transport.close();
        // `closeAllConnections` évite que le serveur reste ouvert sur une
        // connexion persistante du SDK et fasse expirer le `afterAll`.
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
