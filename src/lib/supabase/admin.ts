/**
 * ⛔ CLIENT `service_role` — CONTOURNE INTÉGRALEMENT LA RLS.
 *
 * Ce client voit et modifie TOUTES les lignes de TOUTES les tables, sans
 * exception, quelle que soit la policy. Une fuite de la clé qu'il porte
 * compromet l'ensemble des déclarations fiscales et des données sociales de
 * l'entreprise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEULS USAGES AUTORISÉS — la liste est fermée :
 *
 *   1. Génération planifiée des occurrences à partir du référentiel.
 *   2. Envoi des notifications d'échéance et des relances.
 *   3. Purge de rétention des documents arrivés à échéance de conservation.
 *   4. Sauvegardes chiffrées.
 *   5. Test d'intégrité documentaire (recalcul et comparaison des empreintes).
 *
 * Tout autre besoin passe par `@/lib/supabase/server`, soumis à la RLS. Si une
 * policy semble bloquer un usage légitime, on corrige la policy — on ne bascule
 * pas sur ce client.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Trois barrières, du plus fiable au moins fiable :
 *   • `import 'server-only'` — casse le build si le module atteint un bundle client.
 *   • règle ESLint `no-restricted-imports` — interdit l'import hors de src/server/jobs.
 *   • garde d'exécution ci-dessous — filet, lit la pile d'appels.
 *
 * Rappel : chaque écriture faite par un job produit une entrée d'audit, au même
 * titre qu'une action d'interface (cf. CLAUDE.md §3.6). Le contournement de la
 * RLS ne dispense jamais de la traçabilité.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import { assertLoadedFromJobs } from "@/lib/supabase/admin-guard";
import type { Database } from "@/types/database.types";

assertLoadedFromJobs(new Error().stack);

export type SupabaseAdminClient = SupabaseClient<Database>;

/**
 * Aucune persistance de session : un job n'a pas d'utilisateur, il ne doit pas
 * écrire de jeton sur le disque ni tenter de le rafraîchir.
 */
export function createSupabaseAdminClient(): SupabaseAdminClient {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
