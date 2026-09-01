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

/*
 * ⚠️ DEUXIÈME SIGNAL, ajouté après un FAUX POSITIF constaté en production.
 *
 * La lecture de pile ne survit pas au bundling : dans un build Next.js, les
 * chemins deviennent `.next/server/chunks/8340.js` et le fragment
 * `/server/jobs/` disparaît. La garde refusait donc un job LÉGITIME dès qu'il
 * était invoqué depuis le serveur applicatif plutôt que depuis un script — cas
 * qui s'est présenté avec la route de secours de génération, et qui aurait
 * touché n'importe quel job déclenché par HTTP.
 *
 * Le marqueur ci-dessous est posé par `src/server/jobs/_job-context.ts`, importé
 * EN PREMIER par chaque job. L'ordre d'évaluation des modules ES garantit qu'il
 * est posé avant que `admin.ts` ne s'évalue.
 *
 * Le niveau de sécurité ne baisse pas : seul un fichier de `src/server/jobs/`
 * peut importer ce module — la règle ESLint `no-restricted-imports` l'impose
 * statiquement, et c'est elle, avec `import 'server-only'`, qui constitue la
 * barrière principale. La lecture de pile n'a jamais été qu'une défense en
 * profondeur ; elle le reste, complétée plutôt que remplacée.
 */
let jobContext = false;

/** Déclare que l'on entre dans un script de `src/server/jobs/`. */
export function markJobContext(): void {
  jobContext = true;
}

/** À l'usage des tests : rétablit l'état initial. */
export function resetJobContext(): void {
  jobContext = false;
}

export function isJobContext(): boolean {
  return jobContext;
}

/**
 * Vrai si la pile d'appels traverse `src/server/jobs/`.
 *
 * Limite assumée : la vérification lit des chemins de fichiers. Elle est fiable
 * pour un script exécuté tel quel et devient aveugle si le code est bundlé, les
 * chemins étant alors réécrits — d'où le marqueur explicite ci-dessus.
 */
export function isLoadedFromJobs(stack: string | undefined): boolean {
  if (stack === undefined || stack.length === 0) return false;
  return stack.replaceAll("\\", "/").includes(JOBS_PATH_FRAGMENT);
}

/**
 * Lève si le module appelant n'est pas un script de `src/server/jobs/`.
 *
 * Deux signaux, l'un OU l'autre : le chemin dans la pile (script exécuté tel
 * quel) ou le marqueur explicite (code bundlé).
 */
export function assertLoadedFromJobs(stack: string | undefined): void {
  if (isJobContext() || isLoadedFromJobs(stack)) return;
  throw new Error(ADMIN_CLIENT_MISUSE_MESSAGE);
}
