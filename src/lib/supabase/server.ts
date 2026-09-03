/**
 * Client Supabase des Server Components et Server Actions.
 *
 * Porte la clé anon et la session de l'utilisateur via ses cookies : la RLS
 * s'applique intégralement. C'est le client par défaut de toute lecture ou
 * écriture faite au nom d'un utilisateur.
 *
 * Pour contourner la RLS (jobs planifiés), voir `admin.ts` — et ses conditions.
 */

import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import { env } from "@/config/env";
import type { Database } from "@/types/database.types";

export type SupabaseServerClient = SupabaseClient<Database>;

/**
 * Recopie l'identifiant de corrélation posé par le middleware.
 *
 * ⚠️ C'EST LA SEULE CHOSE QUI RELIE UNE LIGNE D'AUDIT À UNE REQUÊTE.
 *
 * `audit_log.request_id` existe depuis la première migration et restait vide :
 * il lisait un réglage de SESSION, or l'application atteint la base par
 * PostgREST, en HTTP, sans session. PostgREST expose en revanche les en-têtes
 * reçus, et `public.current_request_id()` y lit `x-request-id`. Sans cet
 * en-tête ici, la chaîne reste rompue et le champ reste NULL.
 *
 * L'absence d'en-tête n'est pas une erreur : un appel hors requête HTTP — un
 * test, un script — n'en a pas. La trace est alors simplement moins précise.
 */
async function correlationHeaders(): Promise<Record<string, string>> {
  try {
    const requestId = (await headers()).get("x-request-id");
    return requestId === null || requestId.length === 0 ? {} : { "x-request-id": requestId };
  } catch {
    return {};
  }
}

/**
 * Client ANONYME, sans session ni cookie.
 *
 * ⚠️ Porte la clé anon, comme le client de session — il n'a donc AUCUN droit
 * supplémentaire, et la RLS s'applique intégralement. La seule différence est
 * qu'il n'attache aucune identité : `auth.uid()` y vaut NULL.
 *
 * Un unique usage, et il ne doit pas s'étendre : le flux iCalendar, dont la
 * route est appelée par un agenda qui ne présente aucun cookie. Le porteur y est
 * désigné par son jeton, et le cloisonnement réappliqué en base pour ce profil.
 *
 * Ce n'est PAS un raccourci pour lire hors session : sans identité, les
 * politiques rendent zéro ligne. Tout ce qui passe par ici doit donc être une
 * fonction SECURITY DEFINER qui porte sa propre règle d'accès — et il n'y en a
 * qu'une.
 */
export function createSupabaseAnonClient(): SupabaseServerClient {
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // Aucun cookie, dans aucun sens : rien à lire, rien à écrire.
      cookies: { getAll: () => [], setAll: () => undefined },
    },
  );
}

/**
 * Une instance par requête : le client capture les cookies de l'appelant, il ne
 * doit jamais être mis en cache entre deux requêtes.
 */
export async function createSupabaseServerClient(): Promise<SupabaseServerClient> {
  const cookieStore = await cookies();
  const global = { headers: await correlationHeaders() };

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Appel depuis un Server Component : les cookies y sont en lecture
            // seule. Le middleware a déjà rafraîchi la session en amont, cette
            // écriture est donc redondante et peut être ignorée sans risque.
          }
        },
      },
    },
  );
}
