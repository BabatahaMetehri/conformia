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
import { cookies } from "next/headers";

import { env } from "@/config/env";
import type { Database } from "@/types/database.types";

export type SupabaseServerClient = SupabaseClient<Database>;

/**
 * Une instance par requête : le client capture les cookies de l'appelant, il ne
 * doit jamais être mis en cache entre deux requêtes.
 */
export async function createSupabaseServerClient(): Promise<SupabaseServerClient> {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
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
