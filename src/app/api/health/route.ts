/**
 * SONDE DE SANTÉ — ce que la supervision interroge.
 *
 * Répond sur quatre choses, et rien d'autre : la base répond, le stockage
 * répond, la génération d'occurrences a tourné récemment, une sauvegarde a
 * réussi récemment.
 *
 * ⚠️ ELLE RÉPOND SUR CE QUI N'A PAS EU LIEU, et c'est sa raison d'être. Une
 * panne bruyante se voit : elle remplit les journaux, elle réveille quelqu'un.
 * Une génération qui cesse simplement de tourner ne produit RIEN — pas d'erreur,
 * pas de ligne, pas d'alerte — et la plateforme continue d'afficher sereinement
 * les dossiers du mois dernier. C'est ce silence-là que la sonde transforme en
 * signal.
 *
 * ⚠️ DEUX NIVEAUX DE RÉPONSE, DÉLIBÉRÉMENT.
 *
 *   • Sans secret : le verdict et le nom des vérifications. De quoi alimenter
 *     une supervision externe, rien qui renseigne un tiers.
 *   • Avec `x-cron-secret` : le détail opérationnel — dates, ancienneté,
 *     compteurs. « La dernière sauvegarde date de six jours » est précisément le
 *     genre de phrase qu'on ne publie pas.
 *
 * ⚠️ LE TRAVAIL EST IMPORTÉ DYNAMIQUEMENT. La sonde a besoin de la clé de
 * service — répondre quand l'authentification est en panne est tout son objet —
 * et CLAUDE.md §6 interdit cette clé dans une route handler. L'import dynamique
 * garde le module hors du graphe statique de la route : la clé reste dans
 * `src/server/jobs/`. Même montage, même raison, que `/api/cron/generate`.
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/config/env";

/** Node, jamais Edge : le travail sous-jacent ouvre le client de service. */
export const runtime = "nodejs";

/** Aucune mise en cache : une santé figée est pire qu'une absence de sonde. */
export const dynamic = "force-dynamic";

/** Comparaison à temps constant — même raison qu'aux routes de planification. */
function secretMatches(provided: string, expected: string): boolean {
  const given = Buffer.from(provided, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { runHealthCheck } = await import("@/server/jobs/health-check");
  const report = await runHealthCheck();

  const trusted = secretMatches(request.headers.get("x-cron-secret") ?? "", env.CRON_SECRET);

  const body = trusted
    ? report
    : {
        status: report.status,
        checkedAt: report.checkedAt,
        checks: report.checks.map((check) => ({ name: check.name, ok: check.ok })),
      };

  return NextResponse.json(body, {
    /*
     * ⚠️ 503 quand une brique essentielle est à terre. La supervision lit le
     * CODE, pas le corps : rendre 200 avec `{"status":"down"}` produirait un
     * tableau de bord tout vert au milieu d'une panne. `degraded` reste en 200 —
     * la plateforme sert encore, et un redémarrage automatique n'aiderait pas.
     */
    status: report.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
