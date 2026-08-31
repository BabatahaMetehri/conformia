/**
 * Rafraîchissement de session pour le middleware Next.
 *
 * Le jeton d'accès Supabase est court. Sans ce passage à chaque requête, un
 * Server Component finirait par lire une session expirée et déconnecterait
 * l'utilisateur en pleine saisie.
 *
 * ⚠️ Ce module lit `process.env` directement au lieu de `@/config/env`, contrairement
 * au reste du code. Le middleware s'exécute sur le runtime Edge, où `process.env`
 * n'est pas un objet complet : seules les références statiques y sont substituées
 * à la compilation. Le `safeParse(process.env)` de `env.ts` y échouerait. Les deux
 * variables lues ici sont publiques et déjà validées côté application.
 */

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database.types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Verdicts d'accès, calculés en base en un seul appel. Le middleware n'a besoin
 * de rien d'autre : ni rôles, ni permissions, ni données métier.
 */
export interface SessionGates {
  readonly active: boolean;
  readonly isAdmin: boolean;
  readonly mfaRequired: boolean;
  readonly mfaEnrolled: boolean;
  readonly ipAllowed: boolean;
}

export interface SessionRefresh {
  /** Réponse portant les cookies de session réécrits. À renvoyer telle quelle. */
  readonly response: NextResponse;
  /** `null` si aucune session valide. */
  readonly user: User | null;
  /** `null` en l'absence de session, ou si le verdict n'a pas pu être obtenu. */
  readonly gates: SessionGates | null;
}

function readGates(value: unknown): SessionGates | null {
  if (typeof value !== "object" || value === null) return null;
  const raw: Record<string, unknown> = { ...value };
  const flag = (key: string): boolean => raw[key] === true;
  return {
    active: flag("active"),
    isAdmin: flag("is_admin"),
    mfaRequired: flag("mfa_required"),
    mfaEnrolled: flag("mfa_enrolled"),
    ipAllowed: flag("ip_allowed"),
  };
}

/**
 * Rafraîchit la session et rend la réponse à propager.
 *
 * `requestHeaders` est transmis à la requête aval : c'est ainsi que le nonce CSP
 * atteint les Server Components.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
  clientIp: string | null = null,
): Promise<SessionRefresh> {
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis dans le middleware.",
    );
  }

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // Les cookies sont écrits deux fois : sur la requête, pour que la suite
        // du middleware et les Server Components voient la session à jour ; sur
        // la réponse, pour que le navigateur la conserve.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getUser()` et non `getSession()` : seul le premier revalide le jeton auprès
  // du serveur d'authentification. `getSession()` se contente de lire le cookie,
  // qui peut être forgé.
  const { data } = await supabase.auth.getUser();

  if (data.user === null) {
    return { response, user: null, gates: null };
  }

  const { data: gates } = await supabase.rpc("session_gates", {
    ...(clientIp === null ? {} : { p_ip: clientIp }),
  });

  return { response, user: data.user, gates: readGates(gates) };
}

/** Recopie les cookies de session sur une réponse de redirection. */
export function carryOverCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}
