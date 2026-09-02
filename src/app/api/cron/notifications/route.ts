/**
 * Route de SECOURS pour le cycle horaire de notification.
 *
 * Même dessin que `/api/cron/generate`, et pour les mêmes raisons — voir ce
 * fichier pour le détail : comparaison du secret en temps constant, et import
 * DYNAMIQUE du job pour que la clé de service n'entre jamais dans le graphe de
 * modules d'une route handler (CLAUDE.md §6).
 *
 * Le chemin nominal reste pg_cron, planifié à la minute 5 de chaque heure.
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/config/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string, expected: string): boolean {
  const given = Buffer.from(provided, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const provided = request.headers.get("x-cron-secret") ?? "";

  if (!secretMatches(provided, env.CRON_SECRET)) {
    logger.warn("Appel de notification refusé", {
      hasHeader: request.headers.has("x-cron-secret"),
    });
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { runNotificationJob } = await import("@/server/jobs/process-notifications");
  const outcome = await runNotificationJob();

  // 200 pour SKIPPED et PARTIAL : l'appel a été traité, l'issue est dans le
  // corps. Un 5xx ferait recommencer l'ordonnanceur sur un cycle qui s'est
  // délibérément abstenu.
  return NextResponse.json(outcome, {
    status: outcome.status === "FAILED" ? 500 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
