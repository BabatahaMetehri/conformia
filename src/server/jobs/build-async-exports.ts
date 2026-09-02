/**
 * EXPORTS ASYNCHRONES — construction en tâche de fond.
 *
 * Un export d'exercice complet dépasse le temps qu'un navigateur accepte
 * d'attendre. Le planificateur a inscrit la demande ; cette tâche la réalise,
 * dépose l'archive dans un bucket privé, et prévient l'auteur.
 *
 * ⚠️ LE PÉRIMÈTRE RESTE CELUI DU DEMANDEUR. La tâche emprunte la clé de service —
 * elle n'a pas de session — mais elle interroge `exportable_occurrences` AVEC
 * L'IDENTIFIANT DE L'AUTEUR. C'est le seul endroit du produit où un export
 * pourrait cesser d'être cloisonné, et c'est pourquoi la fonction paramétrée est
 * révoquée pour les sessions : elle n'existe que pour ce cas, et il est ici.
 *
 * ⚠️ L'archive n'est JAMAIS lue par un autre que son auteur : la politique du
 * bucket `exports` remonte à `export_runs.requested_by`. Un export est un
 * instantané d'un périmètre ; le partager donnerait par la bande des dossiers
 * que la RLS refuse en direct.
 */

// ⚠️ EN PREMIER, avant le client de service : ce module pose le marqueur
// que la garde d'emplacement attend (cf. admin-guard.ts).
import "@/server/jobs/_job-context";

import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";

import { ZipArchive } from "archiver";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildCsv } from "@/lib/csv";
import { logger } from "@/lib/logger";
import {
  finishAsyncExport,
  listOccurrenceDocumentsAs,
  listPendingAsyncExports,
  loadExportScopeFor,
  openDocumentStreamAs,
  uploadExportArtifact,
  type ExportClient,
  type ExportableOccurrence,
} from "@/data/queries/export";

export const JOB_NAME = "build-async-exports";

/** Combien de demandes par cycle. Au-delà, la suivante attend une heure. */
const BATCH = 3;

export interface AsyncExportOutcome {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
}

function recapCsv(rows: readonly ExportableOccurrence[]): string {
  return buildCsv({
    headers: [
      "Code",
      "Obligation",
      "Domaine",
      "Organisme",
      "Période",
      "Échéance interne",
      "Échéance légale",
      "Statut",
      "Responsable",
      "Déposé le",
      "Jours de retard",
      "Pièces",
    ],
    rows: rows.map((row) => [
      row.obligationCode,
      row.obligationName,
      row.domainCode,
      row.authorityName,
      row.periodKey,
      row.internalDueDate,
      row.legalDueDate,
      row.status,
      row.ownerName,
      row.submittedAt,
      row.lateDays,
      row.documentCount,
    ]),
  });
}

/** Copie un flux dans l'archive en calculant son empreinte au passage. */
async function appendHashed(
  archive: ZipArchive,
  source: ReadableStream<Uint8Array>,
  entryPath: string,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;

  const relay = new PassThrough();
  archive.append(relay, { name: entryPath });

  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      bytes += value.byteLength;
      if (!relay.write(value)) {
        await new Promise<void>((resolve) => relay.once("drain", resolve));
      }
    }
  } finally {
    reader.releaseLock();
    relay.end();
  }

  return { sha256: hash.digest("hex"), bytes };
}

async function buildOne(
  client: ExportClient,
  run: { id: string; requestedBy: string; scope: Record<string, unknown> },
): Promise<{ occurrences: number; documents: number; bytes: number; fileName: string }> {
  const filters = {
    ...(typeof run.scope["from"] === "string" ? { from: run.scope["from"] } : {}),
    ...(typeof run.scope["to"] === "string" ? { to: run.scope["to"] } : {}),
    ...(typeof run.scope["domainId"] === "string" ? { domainId: run.scope["domainId"] } : {}),
    ...(typeof run.scope["authorityId"] === "string"
      ? { authorityId: run.scope["authorityId"] }
      : {}),
  };

  const scope = await loadExportScopeFor(client, run.requestedBy, filters);
  if (!scope.ok) throw new Error(`périmètre illisible : ${scope.error.code}`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const sink = new PassThrough();
  const chunks: Buffer[] = [];

  archive.pipe(sink);
  sink.on("data", (chunk: Buffer) => chunks.push(chunk));

  const manifest: { path: string; sha256: string; bytes: number; matches: boolean }[] = [];
  let documents = 0;

  archive.append(Buffer.from(recapCsv(scope.value), "utf8"), { name: "00_recapitulatif.csv" });

  for (const occurrence of scope.value) {
    const pieces = await listOccurrenceDocumentsAs(client, occurrence.occurrenceId);
    if (!pieces.ok) continue;

    for (const [index, document] of pieces.value.entries()) {
      const folder = `${occurrence.obligationCode}_${occurrence.periodKey}`.replaceAll(
        /[^A-Za-z0-9._-]/g,
        "-",
      );
      const entryPath = `${folder}/${String((document.checklistOrder ?? index) + 1).padStart(2, "0")}_${document.normalizedFilename}`;

      const stream = await openDocumentStreamAs(client, document.bucket, document.storagePath);
      if (!stream.ok) {
        // Une pièce illisible est SIGNALÉE, elle n'annule pas l'exercice entier.
        manifest.push({ path: entryPath, sha256: "", bytes: 0, matches: false });
        continue;
      }

      const written = await appendHashed(archive, stream.value, entryPath);
      manifest.push({
        path: entryPath,
        sha256: written.sha256,
        bytes: written.bytes,
        matches: written.sha256 === document.sha256,
      });
      documents += 1;
    }
  }

  archive.append(
    Buffer.from(
      `${JSON.stringify(
        { generatedAt: new Date().toISOString(), occurrences: scope.value.length, files: manifest },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    { name: "manifest.json" },
  );

  await archive.finalize();
  await new Promise<void>((resolve) => sink.on("end", resolve));

  const bytes = Buffer.concat(chunks);
  const fileName = `AGROESPACE_PERIODE_${new Date().toISOString().slice(0, 10)}.zip`;

  const uploaded = await uploadExportArtifact(
    client,
    // Le chemin commence par l'identifiant de l'export : c'est ce préfixe que la
    // politique du bucket remonte pour décider qui peut lire.
    `${run.id}/${fileName}`,
    bytes,
    "application/zip",
  );
  if (!uploaded.ok) throw new Error(`dépôt de l'archive impossible : ${uploaded.error.code}`);

  return { occurrences: scope.value.length, documents, bytes: bytes.byteLength, fileName };
}

export async function runAsyncExportJob(
  client: ExportClient = createSupabaseAdminClient(),
): Promise<AsyncExportOutcome> {
  const pending = await listPendingAsyncExports(client, BATCH);

  if (!pending.ok) {
    logger.error("File des exports asynchrones illisible", { code: pending.error.code });
    return { processed: 0, succeeded: 0, failed: 1 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const run of pending.value) {
    try {
      const built = await buildOne(client, run);
      await finishAsyncExport(client, {
        runId: run.id,
        status: "SUCCEEDED",
        occurrences: built.occurrences,
        documents: built.documents,
        sizeBytes: built.bytes,
        fileName: built.fileName,
      });
      succeeded += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      /*
       * ⚠️ L'échec est CLOS, pas laissé ouvert. Une demande restée à RUNNING
       * serait reprise à chaque cycle pendant six heures, et son auteur
       * n'apprendrait jamais que son export ne viendra pas.
       */
      await finishAsyncExport(client, {
        runId: run.id,
        status: "FAILED",
        occurrences: 0,
        documents: 0,
        sizeBytes: 0,
        fileName: "",
        error: message.slice(0, 500),
      });
      logger.error("Export asynchrone en échec", { runId: run.id, error: message });
      failed += 1;
    }
  }

  return { processed: pending.value.length, succeeded, failed };
}
