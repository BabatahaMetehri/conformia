/**
 * ACCÈS À MAILPIT — la boîte aux lettres locale de Supabase.
 *
 * ⚠️ AUCUN SIMULACRE D'ENVOI ICI, ET C'EST LE POINT.
 *
 * Un `vi.mock` du fournisseur vérifierait qu'on a appelé une fonction ; il ne
 * vérifierait ni que le message part, ni qu'il porte le bon destinataire, ni que
 * son corps HTML tient debout, ni que le texte brut existe. Or c'est exactement
 * ce qui casse en production : une adresse mal formée, un sujet vide, un gabarit
 * qui lève. Mailpit reçoit de VRAIS messages par SMTP et les rend interrogeables
 * — il n'y a aucune raison de simuler ce qu'on peut observer.
 *
 * ⚠️ LE PORT EST LU, PAS SUPPOSÉ. `supabase status` fait autorité : l'interface
 * web et le port SMTP sont configurables dans `config.toml`, et les coder en dur
 * ferait échouer la suite sur le poste de quiconque les aurait changés — avec
 * une erreur de connexion qui n'expliquerait rien.
 */

import { execFileSync } from "node:child_process";

export interface MailpitMessage {
  readonly id: string;
  readonly subject: string;
  readonly to: readonly string[];
  readonly from: string;
}

export interface MailpitBody {
  readonly html: string;
  readonly text: string;
}

interface RawSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[] | null;
  From: { Address: string } | null;
}

/** Adresse de l'interface web, d'où sort l'API. */
let cachedBaseUrl: string | null = null;

export function mailpitBaseUrl(): string {
  if (cachedBaseUrl !== null) return cachedBaseUrl;

  const fromEnv = process.env["MAILPIT_URL"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    cachedBaseUrl = fromEnv;
    return cachedBaseUrl;
  }

  /*
   * `supabase status -o json` est lent (~2 s) : on ne l'appelle qu'une fois par
   * processus. L'échec est SILENCIEUX et retombe sur le port par défaut — sur un
   * poste où la CLI n'est pas dans le chemin, mieux vaut essayer 54324 que
   * refuser de démarrer.
   */
  try {
    const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    });
    const parsed = JSON.parse(raw) as Record<string, string>;
    cachedBaseUrl = parsed["MAILPIT_URL"] ?? parsed["INBUCKET_URL"] ?? "http://127.0.0.1:54324";
  } catch {
    cachedBaseUrl = "http://127.0.0.1:54324";
  }

  return cachedBaseUrl;
}

/** Port SMTP d'écoute. Mailpit expose l'un et l'autre sur des ports distincts. */
export function mailpitSmtpPort(): number {
  const fromEnv = process.env["MAILPIT_SMTP_PORT"];
  if (fromEnv !== undefined && Number.isInteger(Number(fromEnv))) return Number(fromEnv);

  /*
   * ⚠️ DÉDUIT DE L'INTERFACE WEB, et non écrit en dur séparément. Supabase
   * expose l'interface sur `port` et le SMTP sur `smtp_port`, contigus par
   * convention (54324 / 54325). Deux constantes indépendantes divergeraient le
   * jour où quelqu'un décale la plage dans `config.toml`.
   */
  const web = Number(new URL(mailpitBaseUrl()).port || "54324");
  return web + 1;
}

/** Vide la boîte. À appeler AVANT chaque scénario, jamais après. */
export async function clearMailbox(): Promise<void> {
  /*
   * ⚠️ AVANT, ET NON APRÈS. Un nettoyage en fin de test laisse la boîte pleine
   * si le test échoue en cours de route, et le suivant compte alors des messages
   * qui ne sont pas les siens — un échec qui se déplace d'un test à l'autre à
   * chaque exécution. Nettoyer en entrée rend chaque scénario indépendant de la
   * façon dont le précédent s'est terminé.
   */
  await fetch(`${mailpitBaseUrl()}/api/v1/messages`, { method: "DELETE" });
}

/** Tous les messages reçus, du plus récent au plus ancien. */
export async function listMessages(): Promise<readonly MailpitMessage[]> {
  const response = await fetch(`${mailpitBaseUrl()}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error(`Mailpit injoignable : ${String(response.status)}`);

  const payload = (await response.json()) as { messages: RawSummary[] };

  return payload.messages.map((message) => ({
    id: message.ID,
    subject: message.Subject,
    to: (message.To ?? []).map((entry) => entry.Address),
    from: message.From?.Address ?? "",
  }));
}

/** Messages adressés à cette adresse. */
export async function messagesTo(address: string): Promise<readonly MailpitMessage[]> {
  const all = await listMessages();
  return all.filter((message) => message.to.includes(address));
}

/** Corps HTML et texte d'un message. */
export async function messageBody(id: string): Promise<MailpitBody> {
  const response = await fetch(`${mailpitBaseUrl()}/api/v1/message/${id}`);
  if (!response.ok) throw new Error(`Message ${id} introuvable`);

  const payload = (await response.json()) as { HTML?: string; Text?: string };
  return { html: payload.HTML ?? "", text: payload.Text ?? "" };
}

/**
 * Attend qu'au moins `count` messages soient arrivés.
 *
 * ⚠️ SMTP EST ASYNCHRONE. Le fournisseur rend la main dès que le serveur a
 * accusé réception ; Mailpit indexe ensuite. Lire immédiatement après l'envoi
 * donne un compte trop bas de façon INTERMITTENTE — le pire des défauts de test,
 * puisqu'il passe sur une machine lente et échoue sur une rapide, ou l'inverse.
 * On attend donc un FAIT, avec une borne, plutôt que de dormir un temps deviné.
 */
export async function waitForMessages(
  count: number,
  timeoutMs = 15_000,
): Promise<readonly MailpitMessage[]> {
  const deadline = Date.now() + timeoutMs;
  let seen: readonly MailpitMessage[] = [];

  while (Date.now() < deadline) {
    seen = await listMessages();
    if (seen.length >= count) return seen;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return seen;
}

/**
 * Vérifie qu'aucun message supplémentaire n'arrive.
 *
 * ⚠️ Prouver une ABSENCE demande d'attendre : conclure « aucun doublon » à
 * l'instant du second appel confondrait « rien n'est parti » avec « rien n'est
 * encore arrivé ». Deux secondes suffisent — un envoi SMTP local prend quelques
 * dizaines de millisecondes.
 */
export async function settle(ms = 2_000): Promise<readonly MailpitMessage[]> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return listMessages();
}
