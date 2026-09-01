/**
 * Marqueur de contexte « job ».
 *
 * ⚠️ DOIT ÊTRE IMPORTÉ EN PREMIER par chaque module de `src/server/jobs/`, AVANT
 * `@/lib/supabase/admin`. L'ordre d'évaluation des modules ES suit l'ordre des
 * imports : le marqueur est donc posé avant que la garde du client de service ne
 * s'exécute.
 *
 * Il existe parce que la lecture de pile d'appels ne survit pas au bundling
 * Next.js — voir `src/lib/supabase/admin-guard.ts`. Seuls les fichiers de ce
 * dossier peuvent l'importer : la règle ESLint qui protège le client de service
 * protège aussi ce marqueur, et c'est elle qui reste la barrière principale.
 */

import { markJobContext } from "@/lib/supabase/admin-guard";

markJobContext();
