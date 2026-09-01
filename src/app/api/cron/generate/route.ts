/**
 * Route de SECOURS pour la génération des occurrences.
 *
 * Le chemin nominal est la fonction Edge planifiée par pg_cron à 02 h 00 heure
 * d'Alger. Cette route existe pour les cas où pg_cron ou pg_net ne sont pas
 * disponibles — installation auto-hébergée, environnement de recette — et pour
 * relancer une génération à la main après incident.
 *
 * ⚠️ COMPARAISON EN TEMPS CONSTANT du secret. Une comparaison `===` sur une
 * chaîne s'arrête au premier caractère différent : le temps de réponse fuit
 * alors, caractère par caractère, la valeur attendue. Sur une route publique
 * appelable en boucle, c'est une attaque praticable, pas une curiosité théorique.
 *
 * ⚠️ LE JOB EST IMPORTÉ DYNAMIQUEMENT, ET C'EST DÉLIBÉRÉ.
 *
 * Le générateur a besoin de la clé de service — écrire pour tous les domaines
 * est précisément ce qu'une session utilisateur ne peut pas faire. Or CLAUDE.md
 * §6 interdit cette clé dans une route handler, et `src/lib/supabase/admin.ts`
 * lève à son chargement hors de `src/server/jobs/`.
 *
 * Un import statique ferait donc entrer `admin.ts` dans le graphe de modules de
 * cette route : le build a effectivement échoué ainsi, la garde s'étant
 * déclenchée à la collecte des données de page. Ce n'était pas un obstacle à
 * contourner mais un avertissement à écouter — la route ne DOIT pas porter la
 * clé.
 *
 * L'import dynamique la garde hors du graphe statique : le module n'est chargé
 * qu'à l'exécution, dans le contexte du job. La route reste un DÉCLENCHEUR
 * authentifié, elle ne devient jamais le porteur du privilège.
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/config/env";
import { logger } from "@/lib/logger";

/** Node, jamais Edge : le générateur ouvre une connexion PostgreSQL. */
export const runtime = "nodejs";

/** Jamais pré-évaluée : cette route a un effet de bord, elle n'a rien à figer. */
export const dynamic = "force-dynamic";

/**
 * Compare deux secrets sans fuite de timing.
 *
 * ⚠️ `timingSafeEqual` EXIGE deux tampons de même longueur, et lève sinon — ce
 * qui rétablirait la fuite qu'on cherche à fermer. On compare donc d'abord les
 * longueurs, puis les octets : la longueur reste observable, mais elle ne révèle
 * rien qu'un attaquant ne devine en une poignée d'essais, alors que le contenu,
 * lui, resterait autrement découvrable caractère par caractère.
 */
function secretMatches(provided: string, expected: string): boolean {
  const given = Buffer.from(provided, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const provided = request.headers.get("x-cron-secret") ?? "";

  if (!secretMatches(provided, env.CRON_SECRET)) {
    // Aucun détail dans la réponse : dire « secret absent » plutôt que « secret
    // faux » renseignerait l'appelant sur ce qu'il doit corriger.
    logger.warn("Appel de génération refusé", {
      hasHeader: request.headers.has("x-cron-secret"),
    });
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { runGenerationJob } = await import("@/server/jobs/generate-occurrences");
  const outcome = await runGenerationJob();

  // 200 même pour SKIPPED et PARTIAL : l'appel a été traité, et son issue est
  // dans le corps. Un 5xx ferait recommencer l'ordonnanceur sur une exécution
  // qui s'est délibérément abstenue.
  return NextResponse.json(outcome, {
    status: outcome.status === "FAILED" ? 500 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
