/**
 * Garde d'emplacement du client `service_role`.
 *
 * Isolé de `admin.ts` pour une raison précise : `admin.ts` exécute cette
 * vérification à son chargement et lève. Un test qui l'importerait pour la
 * vérifier échouerait donc à l'import. Ici, aucun effet de bord.
 */

/** Fragment de chemin identifiant les scripts hors requête. */
const JOBS_PATH_FRAGMENT = "/server/jobs/";

export const ADMIN_CLIENT_MISUSE_MESSAGE =
  "Client Supabase service_role chargé hors de src/server/jobs/. " +
  "Cette clé contourne toutes les policies RLS : elle n'a sa place ni dans un " +
  "composant, ni dans un service, ni dans une Server Action, ni dans un Route " +
  "Handler. Utilisez @/lib/supabase/server, qui applique la RLS.";

/**
 * Vrai si la pile d'appels traverse `src/server/jobs/`.
 *
 * Limite assumée : la vérification lit des chemins de fichiers. Elle est fiable
 * pour un script exécuté tel quel (le cas d'usage des jobs) et devient
 * approximative si le code est bundlé, les chemins étant alors réécrits. C'est
 * une défense en profondeur, pas la barrière principale — celle-ci est
 * `import 'server-only'`, qui casse le build, et la règle ESLint qui interdit
 * l'import ailleurs.
 */
export function isLoadedFromJobs(stack: string | undefined): boolean {
  if (stack === undefined || stack.length === 0) return false;
  return stack.replaceAll("\\", "/").includes(JOBS_PATH_FRAGMENT);
}

/** Lève si le module appelant n'est pas un script de `src/server/jobs/`. */
export function assertLoadedFromJobs(stack: string | undefined): void {
  if (isLoadedFromJobs(stack)) return;
  throw new Error(ADMIN_CLIENT_MISUSE_MESSAGE);
}
