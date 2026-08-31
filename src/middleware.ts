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
import { carryOverCookies, updateSession } from "@/lib/supabase/middleware";

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
    `style-src 'self' 'nonce-${nonce}'`,
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

function applySecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
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
}

function splitLocale(pathname: string): LocalizedPath {
  const segments = pathname.split("/");
  const candidate = segments[1];
  const locale = LOCALES.find((known) => known === candidate);

  if (locale === undefined) {
    return { locale: DEFAULT_LOCALE, path: pathname };
  }
  const rest = segments.slice(2).join("/");
  return { locale, path: rest.length === 0 ? "/" : `/${rest}` };
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

  const clientIp = readClientIp(request);
  const { response, user, gates } = await updateSession(request, requestHeaders, clientIp);
  const { pathname, search } = request.nextUrl;

  // Les Route Handlers s'authentifient autrement (CRON_SECRET, webhooks signés) :
  // les rediriger vers une page de connexion casserait le planificateur.
  if (pathname.startsWith("/api/")) {
    return applySecurityHeaders(response, csp);
  }

  const { locale, path } = splitLocale(pathname);
  const onAuthPage = isAuthPath(path);

  if (user === null && !onAuthPage) {
    const destination = redirectTo(request, `/${locale}/login`, `${pathname}${search}`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp);
  }

  if (user === null) {
    return applySecurityHeaders(response, csp);
  }

  // ── Session présente : les portes se referment une à une. ──────────────────

  // Compte désactivé : la session existe encore côté cookie, mais l'accès cesse
  // immédiatement. Renvoyé vers la connexion, pas vers une page d'erreur.
  if (gates !== null && !gates.active) {
    const destination = redirectTo(request, `/${locale}/login`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp);
  }

  // Liste blanche d'origine : applicable au SEUL rôle ADMIN. Un porteur d'ADMIN
  // connecté depuis une adresse non listée est déconnecté de fait — les autres
  // rôles ne sont jamais concernés.
  if (gates !== null && gates.isAdmin && !gates.ipAllowed) {
    const destination = redirectTo(request, `/${locale}/login`);
    destination.cookies.delete("sb-access-token");
    return applySecurityHeaders(carryOverCookies(response, destination), csp);
  }

  // Second facteur EXIGÉ mais absent (ADMIN, DIRECTION, ou require_mfa_all_users) :
  // l'enrôlement devient la seule page atteignable. Les autres rôles ne passent
  // jamais ici — ils reçoivent une invitation à l'écran, sans blocage.
  const mustEnrollMfa = gates !== null && gates.mfaRequired && !gates.mfaEnrolled;
  const onMfaPath = path === MFA_ENROLLMENT_PATH || path === MFA_CHALLENGE_PATH;

  if (mustEnrollMfa && !onMfaPath) {
    const destination = redirectTo(request, `/${locale}${MFA_ENROLLMENT_PATH}`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp);
  }

  // Utilisateur en règle sur une page d'authentification : on le renvoie chez lui.
  if (!mustEnrollMfa && onAuthPage) {
    const destination = redirectTo(request, `/${locale}${HOME_PATH}`);
    return applySecurityHeaders(carryOverCookies(response, destination), csp);
  }

  return applySecurityHeaders(response, csp);
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
