/**
 * Téléchargement de l'archive d'un dossier.
 *
 * ⚠️ UN GESTIONNAIRE DE ROUTE, PAS UNE SERVER ACTION. Une action rend une valeur
 * sérialisée : l'archive devrait passer en base64, ce qui la charge entièrement
 * en mémoire et l'alourdit d'un tiers. Ici la réponse est un FLUX — les octets
 * partent vers le navigateur pendant que les pièces sont encore lues du
 * stockage, et la mémoire du serveur ne dépend pas de la taille du dossier.
 *
 * ⚠️ AUCUN CONTOURNEMENT DE LA RLS : le client est celui de la session. Un
 * utilisateur qui ne voit pas l'occurrence reçoit 404 — le même écran
 * qu'ailleurs, jamais « accès refusé », qui confirmerait l'existence du dossier.
 */

import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LOCALE } from "@/config/constants";
import { appTranslator } from "@/lib/translator";
import { logger } from "@/lib/logger";
import { finishExportRun, logExport, startExportRun } from "@/data/queries/export";
import { buildDossierArchive, type DossierLabels } from "@/services/export/dossier";
import { requirePermission } from "@/services/auth/context";

/** Node, jamais Edge : l'archive s'appuie sur `node:crypto` et `node:stream`. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * ⚠️ CLÉS ÉCRITES EN TOUTES LETTRES, pas composées.
 *
 * `t(\`occurrences.status.${status}\`)` compile en apparence mais échappe au
 * typage des clés de next-intl : un statut ajouté à l'énumération produirait un
 * libellé manquant DANS L'ARCHIVE, découvert par le destinataire. Les deux
 * tables ci-dessous rendent l'oubli impossible à la compilation.
 */
const STATUS_KEYS = {
  TODO: "occurrences.status.TODO",
  IN_PROGRESS: "occurrences.status.IN_PROGRESS",
  PENDING_VALIDATION: "occurrences.status.PENDING_VALIDATION",
  REJECTED: "occurrences.status.REJECTED",
  VALIDATED: "occurrences.status.VALIDATED",
  SUBMITTED: "occurrences.status.SUBMITTED",
  ARCHIVED: "occurrences.status.ARCHIVED",
  NOT_APPLICABLE: "occurrences.status.NOT_APPLICABLE",
} as const;

const ACTION_KEYS = {
  TRANSITION: "exports.actions.TRANSITION",
  INSERT: "exports.actions.INSERT",
  UPDATE: "exports.actions.UPDATE",
  DELETE: "exports.actions.DELETE",
  VIEW: "exports.actions.VIEW",
  DOWNLOAD: "exports.actions.DOWNLOAD",
  EXPORT: "exports.actions.EXPORT",
  UNLOCK: "exports.actions.UNLOCK",
  LOGIN: "exports.actions.LOGIN",
  LOGOUT: "exports.actions.LOGOUT",
  PERMISSION_CHANGE: "exports.actions.PERMISSION_CHANGE",
} as const;

function isKnown<T extends Record<string, string>>(
  table: T,
  value: string,
): value is Extract<keyof T, string> {
  return Object.hasOwn(table, value);
}

function labels(): DossierLabels {
  const t = appTranslator(DEFAULT_LOCALE);

  return {
    title: t("exports.dossier.title"),
    generatedAt: t("exports.dossier.generatedBy"),
    page: (current, total) => t("exports.common.page", { current, total }),
    identification: t("exports.dossier.identification"),
    obligation: t("exports.columns.obligation"),
    code: t("exports.columns.code"),
    domain: t("exports.columns.domain"),
    authority: t("exports.columns.authority"),
    period: t("exports.columns.period"),
    legalBasis: t("exports.dossier.legalBasis"),
    deadlines: t("exports.dossier.deadlines"),
    internalDue: t("exports.columns.internalDue"),
    legalDue: t("exports.columns.legalDue"),
    submittedAt: t("exports.columns.submittedAt"),
    lateDays: t("exports.columns.lateDays"),
    notSubmitted: t("exports.dossier.notSubmitted"),
    status: t("exports.columns.status"),
    people: t("exports.dossier.people"),
    owner: t("exports.columns.owner"),
    validator: t("exports.columns.validator"),
    lateReason: t("exports.columns.lateReason"),
    documents: t("exports.dossier.documents"),
    documentName: t("exports.dossier.documentName"),
    documentSize: t("exports.dossier.documentSize"),
    documentHash: t("exports.dossier.documentHash"),
    noDocument: t("exports.dossier.noDocument"),
    timeline: t("exports.dossier.timeline"),
    when: t("exports.dossier.when"),
    who: t("exports.dossier.who"),
    what: t("exports.dossier.what"),
    detail: t("exports.dossier.detail"),
    noTimeline: t("exports.dossier.noTimeline"),
    rectifications: t("exports.dossier.rectifications"),
    onBehalfOf: (name) => t("exports.dossier.onBehalfOf", { name }),
    historyHeaders: [
      t("exports.history.when"),
      t("exports.history.source"),
      t("exports.history.actor"),
      t("exports.history.onBehalfOf"),
      t("exports.history.action"),
      t("exports.history.fromStatus"),
      t("exports.history.toStatus"),
      t("exports.history.reason"),
    ],
    manifestNote: t("exports.dossier.manifestNote"),
    // Un code inconnu s'affiche tel quel : une archive avec « FOO » se lit,
    // une archive avec une case vide laisse croire à une donnée absente.
    statusOf: (status) => (isKnown(STATUS_KEYS, status) ? t(STATUS_KEYS[status]) : status),
    actionOf: (action) => (isKnown(ACTION_KEYS, action) ? t(ACTION_KEYS[action]) : action),
    system: t("exports.dossier.system"),
  };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ occurrenceId: string }> },
): Promise<NextResponse> {
  const { occurrenceId } = await context.params;

  if (!UUID.test(occurrenceId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // La permission est vérifiée ici ET par `start_export_run` en base. Ce n'est
  // pas redondant : la première donne une erreur lisible, la seconde tient même
  // si un jour quelqu'un appelle la fonction autrement.
  const allowed = await requirePermission("export.generate");
  if (!allowed.ok) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const run = await startExportRun({
    kind: "DOSSIER",
    format: "ZIP",
    scope: { occurrenceId },
  });
  if (!run.ok) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const archive = await buildDossierArchive(occurrenceId, labels());

  if (!archive.ok) {
    await finishExportRun({
      runId: run.value,
      status: "FAILED",
      occurrences: 0,
      documents: 0,
      sizeBytes: 0,
      fileName: "",
      error: archive.error.code,
    });
    logger.warn("Archive de dossier refusée", { occurrenceId, code: archive.error.code });
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  /*
   * ⚠️ Le journal se ferme APRÈS l'archive, sur la promesse d'achèvement — pas
   * avant. Consigner « réussi » au moment où l'on commence à répondre
   * enregistrerait un succès pour un export qui peut encore échouer à la
   * troisième pièce.
   */
  void archive.value.completion.then(
    async (summary) => {
      await finishExportRun({
        runId: run.value,
        status: "SUCCEEDED",
        occurrences: 1 + summary.rectificationCount,
        documents: summary.documentCount,
        sizeBytes: summary.bytes,
        fileName: archive.value.fileName,
      });
      await logExport("DOSSIER", "obligation_occurrences", occurrenceId, {
        documents: summary.documentCount,
        bytes: summary.bytes,
        fileName: archive.value.fileName,
      });
    },
    async (cause: unknown) => {
      await finishExportRun({
        runId: run.value,
        status: "FAILED",
        occurrences: 0,
        documents: 0,
        sizeBytes: 0,
        fileName: archive.value.fileName,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    },
  );

  return new NextResponse(archive.value.stream as unknown as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      /*
       * ⚠️ Le nom est construit par le SERVEUR à partir du code d'obligation et
       * de la période, tous deux normalisés (cf. buildArchiveName). Aucune part
       * ne vient d'une saisie : un en-tête `Content-Disposition` bâti sur une
       * chaîne libre permet d'injecter des directives et de renommer le fichier
       * chez le destinataire.
       */
      "Content-Disposition": `attachment; filename="${archive.value.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
