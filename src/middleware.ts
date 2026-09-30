/**
 * Middleware de bord : session, redirections d'accès, en-têtes de sécurité.
 *
 * Il s'exécute avant chaque route rendue. Il ne remplace PAS la RLS : un
 * utilisateur qui contournerait cette redirection ne verrait toujours aucune
 * donnée, les policies s'appliquant en base. Le middleware protège l'expérience
 * et la surface HTTP, pas la donnée (cf. CLAUDE.md §1).
 */

import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/config/constants";
import { APP_LOCALE_HEADER, detectLocale, LOCALE_COOKIE } from "@/lib/locale-detection";
import { carryOverCookies, consumeMutationBudget, updateSession } from "@/lib/supabase/middleware";

/** Pages du groupe (auth) : accessibles sans session. */
const AUTH_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/set-password",
  "/mfa",
] as const;

/**
 * Écrans atteignables avec une session mais SANS second facteur enrôlé. Tout le
 * reste est bloqué tant que l'enrôlement n'est pas fait, pour les rôles qui
 * l'exigent — c'est la différence entre « invité à activer » et « contraint ».
 */
const MFA_ENROLLMENT_PATH = "/mfa/enroll";
const MFA_CHALLENGE_PATH = "/mfa";

/** Destination après connexion, et cible de sortie du groupe (auth). */
const HOME_PATH = "/dashboard";

const NONCE_BYTES = 16;

/**
 * Écritures autorisées par minute et par utilisateur.
 *
 * ⚠️ Le seuil est calibré sur l'USAGE HUMAIN, pas sur la capacité du serveur.
 * Une personne qui travaille vite enchaîne quelques actions par minute ; sur
 * l'écran le plus dense — validation groupée, dépôt de plusieurs pièces — on
 * dépasse rarement la dizaine. Soixante laisse donc toute la place au travail
 * réel tout en arrêtant net une boucle ou un onglet qui se relance seul.
 */
const MUTATIONS_PER_MINUTE = 60;

/**
 * Inactivité tolérée avant déconnexion.
 *
 * ⚠️ Trente minutes est un compromis, pas une valeur de sécurité absolue. Plus
 * court, l'outil devient hostile : préparer un dossier suppose de lire des
 * pièces hors écran, de téléphoner à un organisme, de chercher un justificatif.
 * Plus long, un poste abandonné le reste jusqu'au lendemain.
 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Marqueur d'activité. Ne porte rien d'autre qu'un horodatage. */
const ACTIVITY_COOKIE = "conformia-last-seen";

// ─── Nonce ───────────────────────────────────────────────────────────────────

/**
 * Nonce aléatoire par requête. `crypto.getRandomValues` et `btoa` sont les
 * seules primitives disponibles sur le runtime Edge — `Buffer` n'y existe pas.
 */
function createNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// ─── En-têtes de sécurité ────────────────────────────────────────────────────

function supabaseOrigins(): readonly string[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url === undefined || url.length === 0) return [];
  // Le temps réel passe en WebSocket sur la même origine.
  return [url, url.replace(/^http/, "ws")];
}

function buildContentSecurityPolicy(nonce: string): string {
  const isDevelopment = process.env.NODE_ENV !== "production";

  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  const connectSrc = ["'self'", ...supabaseOrigins()];

  if (isDevelopment) {
    // Fast Refresh et l'overlay d'erreur de Next reposent sur `eval`. Cette
    // tolérance est strictement limitée au développement : la politique servie
    // en production ne contient ni 'unsafe-eval' ni 'unsafe-inline'.
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("ws://localhost:*", "http://localhost:*");
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    /*
     * ⚠️ `'unsafe-inline'` POUR LES STYLES, ET C'EST UNE DÉCISION MESURÉE.
     *
     * Avec un nonce, `style-src` bloque les ATTRIBUTS `style="…"` rendus par le
     * serveur : un nonce ne peut pas s'attacher à un attribut. React sérialise
     * `style={{…}}` exactement ainsi. Constaté sur la barre de complétude d'un
     * dossier à « 0 sur 2 » : `transform: translateX(-100%)` était refusé, la
     * valeur calculée retombait à `none`, et la barre s'affichait PLEINE.
     * Chaque jauge de l'application annonçait « complet » quelle que soit la
     * réalité — sur un outil de conformité, c'est une information fausse là où
     * elle compte le plus.
     *
     * Ce que cela coûte : une injection de CSS devient possible SI une faille
     * d'injection existe par ailleurs. Elle n'exécute aucun script — c'est
     * `script-src`, resté strict avec nonce et `'strict-dynamic'`, qui porte
     * cette garantie-là.
     *
     * ⚠️ Le nonce est RETIRÉ d'ici volontairement : sa seule présence ferait
     * ignorer `'unsafe-inline'` (CSP niveau 3), et le défaut reviendrait.
     */
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function applySecurityHeaders(
  response: NextResponse,
  csp: string,
  requestId?: string,
): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  /*
   * L'identifiant part AUSSI dans la réponse. Un utilisateur qui signale un
   * incident peut alors donner ce seul nombre, et la ligne d'audit, le journal
   * serveur et sa capture d'écran se rejoignent sans enquête.
   */
  if (requestId !== undefined) response.headers.set("x-request-id", requestId);
  // Deux ans, sous-domaines inclus : les documents ne transitent jamais en clair.
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Aucun capteur n'est utile à une application de conformité documentaire.
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  );
  response.headers.set("X-DNS-Prefetch-Control", "off");
  return response;
}

// ─── Chemins ─────────────────────────────────────────────────────────────────

interface LocalizedPath {
  readonly locale: Locale;
  /** Chemin débarrassé du préfixe de locale : `/fr/login` → `/login`. */
  readonly path: string;
  /** Faux quand l'URL n'était pas préfixée : il faut alors rediriger. */
  readonly prefixed: boolean;
}

function splitLocale(pathname: string): LocalizedPath {
  const segments = pathname.split("/");
  const candidate = segments[1];
  const locale = LOCALES.find((known) => known === candidate);

  if (locale === undefined) {
    return { locale: DEFAULT_LOCALE, path: pathname, prefixed: false };
  }
  const rest = segments.slice(2).join("/");
  return { locale, path: rest.length === 0 ? "/" : `/${rest}`, prefixed: true };
}

/** Les groupes de routes n'apparaissent pas dans l'URL : la liste fait foi. */
function isAuthPath(path: string): boolean {
  return AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`));
}

function redirectTo(request: NextRequest, pathname: string, next?: string): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  if (next !== undefined) {
    target.searchParams.set("next", next);
  }
  return NextResponse.redirect(target);
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/** IP de l'appelant derrière le proxy de l'hébergeur. */
function readClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return request.headers.get("x-real-ip");
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next relit la CSP sur la requête pour apposer le nonce sur les balises
  // qu'il génère lui-même. Sans cela, ses scripts seraient bloqués.
  requestHeaders.set("content-security-policy", csp);

  /*
   * ⚠️ IDENTIFIANT DE CORRÉLATION — posé ici, une fois, pour toute la requête.
   *
   * Il descend ensuite jusqu'à `audit_log.request_id` : le client Supabase le
   * recopie en en-tête HTTP, PostgREST l'expose, et `current_request_id()` le
   * lit. C'est ce qui permet, à partir d'une ligne d'audit, de retrouver la
   * requête entière — et l'inverse.
   *
   * Un identifiant reçu de l'amont est CONSERVÉ : derrière un répartiteur de
   * charge ou une passerelle, la corrélation commence avant nous, et en forger
   * un nouveau couperait la trace en deux.
   */
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);

  /*
   * ⚠️ LA LOCALE EST TRANSMISE PAR EN-TÊTE, ET C'EST INDISPENSABLE.
   *
   * next-intl alimente normalement `requestLocale` depuis SON PROPRE
   * middleware. Ce projet a le sien — session, CSP, corrélation, débit — et ne
   * monte donc jamais celui de next-intl : `requestLocale` restait vide, et
   * `resolveLocale(undefined)` retombait sur le français. Résultat mesuré :
   * `/ar/echeancier` rendait « Échéancier », et les 1416 clés du catalogue
   * arabe n'ont jamais été lues.
   *
   * Le défaut était invisible parce que `lang` et `dir` viennent de `params` et
   * basculaient correctement : la page avait TOUT l'air d'être en arabe, sauf
   * le texte.
   *
   * L'en-tête est la source la plus fiable disponible ici : il est posé avant
   * tout rendu, il traverse les Server Components comme les Server Actions, et
   * il ne dépend d'aucun ordre d'exécution entre la disposition et la page.
   */
  requestHeaders.set(APP_LOCALE_HEADER, splitLocale(request.nextUrl.pathname).locale);

  const clientIp = readClientIp(request);
  const { response, user, gates, supabase, isRecoverySession } = await updateSession(
    request,
    requestHeaders,
    clientIp,
  );
  const { pathname, search } = request.nextUrl;

  /*
   * ⚠️ LIMITATION DE DÉBIT DES ÉCRITURES — posée ICI, une fois, pour toutes.
   *
   * Une Server Action se reconnaît à son en-tête `next-action` : c'est le seul
   * endroit du système où TOUTES les écritures de l'interface passent, quelles
   * que soient leur feature et leur permission. Les borner ici couvre les
   * soixante et une actions du projet sans en toucher une seule — et surtout
   * sans risquer d'en oublier une, ce qui est le mode de défaillance habituel
   * d'une garde recopiée soixante et une fois.
   *
   * ⚠️ Les LECTURES ne sont pas limitées. Un utilisateur qui parcourt
   * rapidement l'échéancier produit des dizaines de requêtes légitimes ; les
   * compter reviendrait à punir l'usage normal pour un risque nul.
   *
   * ⚠️ LES ÉCRITURES ANONYMES NE SONT PAS COMPTÉES ICI, ET C'EST DÉLIBÉRÉ.
   *
   * Sans session, le seul sujet disponible est l'adresse IP — or tout un bureau
   * derrière un même accès partage la sienne. Une borne par IP y compte les
   * connexions de VINGT personnes comme celles d'une seule : mesuré en faisant
   * tourner la suite de bout en bout, qui se connecte depuis une adresse unique
   * et s'est vue refuser la moitié de ses ouvertures de session. En production,
   * c'est l'équipe entière bloquée à neuf heures du matin.
   *
   * La seule écriture réellement atteignable sans session est la connexion, et
   * elle a déjà sa protection propre — `is_auth_throttled`, qui compte les
   * ÉCHECS par adresse ET par courriel. C'est la bonne granularité : elle
   * n'entrave pas vingt collègues qui se connectent en même temps, et elle
   * arrête une salve d'essais sur un compte.
   */
  if (request.headers.has("next-action") && supabase !== undefined && user !== null) {
    const verdict = await consumeMutationBudget(
      supabase,
      user.id,
      "mutation",
      MUTATIONS_PER_MINUTE,
      60,
    );

    if (!verdict.allowed) {
      const refusal = NextResponse.json(
        { code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
      );
      return applySecurityHeaders(carryOverCookies(response, refusal), csp, requestId);
    }
  }

  // Les Route Handlers s'authentifient autrement (CRON_SECRET, webhooks signés) :
  // les rediriger vers une page de connexion casserait le planificateur.
  if (pathname.startsWith("/api/")) {
    return applySecurityHeaders(response, csp, requestId);
  }

  const split = splitLocale(pathname);

  /*
   * URL sans préfixe de locale (`/`, `/documents`, un lien copié à la main).
   * `localePrefix: "always"` interdit de la servir telle quelle : on choisit la
   * locale — cookie, puis `Accept-Language`, puis `fr` — et on redirige.
   *
   * La redirection est faite AVANT toute décision de session : une redirection
   * de langue ne doit pas dépendre de l'état de connexion, sinon la même URL
   * change de destination selon qu'on est connecté ou non.
   */
  if (!split.prefixed) {
    const detected = detectLocale(
      request.cookies.get(LOCALE_COOKIE)?.value,
      request.headers.get("accept-language"),
    );
    const destination = request.nextUrl.clone();
    destination.pathname = `/${detected}${pathname === "/" ? HOME_PATH : pathname}`;
    return applySecurityHeaders(
      carryOverCookies(response, NextResponse.redirect(destination)),
      csp,
      requestId,
    );
  }

  const { locale, path } = split;
  const onAuthPage = isAuthPath(path);

  if (user === null && !onAuthPage) {
    const destination = redirectTo(request, `/${locale}/login`, `${pathname}${search}`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  if (user === null) {
    return applySecurityHeaders(response, csp, requestId);
  }

  if (isRecoverySession && path !== "/reset-password") {
    const destination = redirectTo(request, `/${locale}/reset-password`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  // ── Session présente : les portes se referment une à une. ──────────────────

  /*
   * ⚠️ EXPIRATION PAR INACTIVITÉ — trente minutes.
   *
   * Le poste laissé ouvert est le risque réel de cette plateforme : un écran non
   * verrouillé dans un bureau partagé donne accès aux déclarations fiscales et
   * aux données sociales de l'entreprise. La session Supabase, elle, dure des
   * heures.
   *
   * ⚠️ CE QUE CETTE MESURE PROTÈGE, ET CE QU'ELLE NE PROTÈGE PAS. Elle ferme un
   * poste abandonné. Elle n'arrête PAS un vol de cookie : qui détient le cookie
   * de session détient aussi celui-ci, et peut le réécrire. Le prétendre serait
   * se raconter une histoire — c'est la durée de vie du jeton Supabase et la
   * révocation qui répondent à ce risque-là.
   *
   * L'horodatage est réécrit à chaque requête : toute navigation compte comme
   * activité, y compris le préchargement d'un lien, qui ne se produit que dans
   * un onglet ouvert devant quelqu'un.
   */
  const lastSeen = Number(request.cookies.get(ACTIVITY_COOKIE)?.value ?? "");
  const idleMs = Number.isFinite(lastSeen) && lastSeen > 0 ? Date.now() - lastSeen : 0;

  if (idleMs > IDLE_TIMEOUT_MS) {
    const destination = redirectTo(request, `/${locale}/login`, `${pathname}${search}`);
    // Le marqueur part avec la session : le laisser ferait expirer d'emblée la
    // connexion suivante, sur une valeur qui n'a plus de sens.
    destination.cookies.delete(ACTIVITY_COOKIE);
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  response.cookies.set(ACTIVITY_COOKIE, String(Date.now()), {
    // `httpOnly` : aucun script de page n'a de raison de prolonger une session.
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(IDLE_TIMEOUT_MS / 1000),
  });

  // Compte désactivé : la session existe encore côté cookie, mais l'accès cesse
  // immédiatement. Renvoyé vers la connexion, pas vers une page d'erreur.
  if (gates !== null && !gates.active) {
    const destination = redirectTo(request, `/${locale}/login`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  // Liste blanche d'origine : applicable au SEUL rôle ADMIN. Un porteur d'ADMIN
  // connecté depuis une adresse non listée est déconnecté de fait — les autres
  // rôles ne sont jamais concernés.
  if (gates !== null && gates.isAdmin && !gates.ipAllowed) {
    const destination = redirectTo(request, `/${locale}/login`);
    destination.cookies.delete("sb-access-token");
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  // Une session issue d'un lien de récupération n'est jamais une session
  // applicative normale. Elle doit rester confinée à /reset-password jusqu'à
  // la vérification TOTP puis être détruite après changement du mot de passe.
  if (isRecoverySession && path !== "/reset-password") {
    const destination = redirectTo(request, `/${locale}/reset-password`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  // Second facteur EXIGÉ mais absent (ADMIN, DIRECTION, ou require_mfa_all_users) :
  // l'enrôlement devient la seule page atteignable. Les autres rôles ne passent
  // jamais ici — ils reçoivent une invitation à l'écran, sans blocage.
  const mustEnrollMfa = gates !== null && gates.mfaRequired && !gates.mfaEnrolled;
  const onMfaPath = path === MFA_ENROLLMENT_PATH || path === MFA_CHALLENGE_PATH;

  if (mustEnrollMfa && !onMfaPath) {
    const destination = redirectTo(request, `/${locale}${MFA_ENROLLMENT_PATH}`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  // Utilisateur en règle sur une page d'authentification : on le renvoie chez lui.
  if (!mustEnrollMfa && onAuthPage && path !== "/reset-password") {
    const destination = redirectTo(request, `/${locale}${HOME_PATH}`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp, requestId);
  }

  return applySecurityHeaders(response, csp, requestId);
}

export const config = {
  matcher: [
    /*
     * Tout sauf les fichiers servis tels quels. Faire passer les assets par le
     * middleware coûterait un rafraîchissement de session par image.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf)$).*)",
  ],
};
