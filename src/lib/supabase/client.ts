/**
 * Client Supabase du NAVIGATEUR.
 *
 * Porte la clé anon : chaque requête est soumise à la RLS. Une donnée lisible
 * avec ce client l'est parce qu'une policy l'autorise — si ce n'est pas voulu,
 * c'est la policy qu'il faut corriger, pas l'appel.
 *
 * Rappel de couche : un composant n'importe pas ce module directement, il passe
 * par un hook de feature ou une Server Action (cf. CLAUDE.md §3.2).
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import type { Database } from "@/types/database.types";

export type SupabaseBrowserClient = SupabaseClient<Database>;

let cachedClient: SupabaseBrowserClient | undefined;

/**
 * Instance unique par onglet. Deux instances concurrentes se disputeraient le
 * rafraîchissement du jeton et produiraient des déconnexions aléatoires.
 */
export function createSupabaseBrowserClient(): SupabaseBrowserClient {
  cachedClient ??= createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return cachedClient;
}
