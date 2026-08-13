import "server-only";

/**
 * Lecture de l'utilisateur connecté, côté serveur.
 *
 * Appelé une fois par rendu, dans le layout racine, puis descendu par contexte
 * jusqu'au hook `useCurrentUser()`. Aucun composant ne refait cet appel.
 */

import { tryCatch, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/types/current-user";

/**
 * Rend `null` en l'absence de session — ce n'est pas une erreur : les pages du
 * groupe (auth) se rendent précisément sans utilisateur.
 *
 * TODO Phase 2 : `profile`, `roles` et `permissions` restent vides tant que les
 * tables correspondantes n'existent pas. Ils seront résolus par une requête de
 * `src/data/queries/` dès la première migration.
 */
export async function getCurrentUser(): Promise<Result<CurrentUser | null>> {
  return tryCatch(async (): Promise<CurrentUser | null> => {
    const supabase = await createSupabaseServerClient();

    // `getUser()` revalide le jeton auprès du serveur d'authentification ;
    // `getSession()` se contenterait de lire un cookie potentiellement forgé.
    // Le type de retour garantit `data.user` non nul dès que `error` est nul :
    // tester les deux serait une condition morte.
    const { data, error } = await supabase.auth.getUser();
    if (error !== null) return null;

    return {
      id: data.user.id,
      email: data.user.email ?? null,
      profile: null,
      roles: [],
      permissions: [],
    };
  });
}
