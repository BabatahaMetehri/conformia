import "server-only";

/**
 * EXPORT DE DOSSIER — une occurrence, en archive ZIP.
 *
 * Ce que produit ce module est destiné à quitter l'entreprise : un contrôleur
 * fiscal, un commissaire aux comptes, un avocat. Trois conséquences qui
 * gouvernent tout le fichier.
 *
 * ⚠️ 1. L'ARCHIVE SE CONSTRUIT EN FLUX. Les pièces d'un dossier pèsent jusqu'à
 * vingt-cinq mégaoctets chacune. Les charger toutes en mémoire pour compresser
 * ensuite ferait tomber le serveur sur un dossier chargé, et sur l'export d'un
 * exercice complet à coup sûr. `archiver` reçoit chaque pièce sous forme de flux
 * et écrit au fur et à mesure ; la mémoire ne dépend pas du nombre de pièces.
 *
 * ⚠️ 2. LE MANIFESTE PORTE LES EMPREINTES RÉELLES, recalculées pendant la
 * copie — pas recopiées depuis la base. Un manifeste qui répète ce que la base
 * croit ne prouve rien : il ne détecterait pas l'erreur qu'on cherche
 * précisément à exclure, celle d'un fichier altéré en stockage.
 *
 * ⚠️ 3. RIEN NE CONTOURNE LA RLS. Toutes les lectures passent par la session de
 * l'appelant. Un utilisateur qui ne voit pas l'occurrence obtient une erreur, pas
 * une archive vide qu'il croirait complète.
 */

import { createHash } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

// ⚠️ `new ZipArchive(...)`, pas `archiver("zip", ...)`. La version 8 du paquet
// n'exporte plus de fonction fabrique : le module rend des CLASSES, et l'ancien
// appel — encore partout dans les exemples en ligne — ne compile ni ne s'exécute.
import { ZipArchive, type Archiver } from "archiver";
import { renderToBuffer } from "@react-pdf/renderer";

import { buildCsv } from "@/lib/csv";
import { formatDateFr, formatDateTimeFr } from "@/lib/dates";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import {
  listOccurrenceDocuments,
  listRectifications,
  loadHistory,
  loadSubmissionFacts,
  openDocumentStream,
  type ExportableDocument,
  type HistoryRow,
  type SubmissionFacts,
} from "@/data/queries/export";
import { getOccurrenceDetail, type OccurrenceDetailView } from "@/services/occurrences/detail";
import { DossierSheet, type DossierSheetData, type DossierSheetLabels } from "./pdf/dossier-sheet";

/** Niveau de compression : 6 est le compromis par défaut de zlib. */
const COMPRESSION_LEVEL = 6;

export interface DossierLabels extends DossierSheetLabels {
  readonly historyHeaders: readonly string[];
  readonly manifestNote: string;
  readonly statusOf: (status: string) => string;
  readonly actionOf: (action: string) => string;
  readonly system: string;
}

export interface DossierArchive {
  readonly fileName: string;
  readonly stream: Readable;
  /** Résolue quand l'archive est close. Porte le compte final, pour le journal. */
  readonly completion: Promise<DossierSummary>;
}

export interface DossierSummary {
  readonly documentCount: number;
  readonly rectificationCount: number;
  readonly bytes: number;
}

/** `AGROESPACE_G50_2026-01_20260902-1430.zip` */
export function buildArchiveName(code: string, periodKey: string, now: Date): string {
  const stamp = now.toISOString().replaceAll(/[-:]/g, "").slice(0, 13).replace("T", "-");

  // Le code et la période viennent de la base : on ne laisse passer que ce qui
  // est sûr dans un nom de fichier, sur les trois systèmes d'exploitation.
  const safe = (value: string): string => value.replaceAll(/[^A-Za-z0-9._-]/g, "-");

  return `AGROESPACE_${safe(code)}_${safe(periodKey)}_${stamp}.zip`;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Nom d'une pièce dans l'archive, préfixé par son rang de checklist.
 *
 * ⚠️ Le préfixe numérique n'est pas décoratif : l'ordre alphabétique d'un
 * explorateur de fichiers reproduit alors l'ordre de la checklist, et le
 * destinataire retrouve les pièces dans l'ordre où l'obligation les demande.
 * Sans lui, un dossier de six pièces arrive dans un ordre arbitraire.
 */
export function documentEntryName(document: ExportableDocument, fallbackIndex: number): string {
  const order = document.checklistOrder ?? fallbackIndex;
  return `${String(order + 1).padStart(2, "0")}_${document.normalizedFilename}`;
}

interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Empreinte enregistrée au dépôt. Comparée à celle recalculée ici. */
  readonly recordedSha256: string | null;
  readonly matches: boolean | null;
}

/**
 * Copie un flux dans l'archive en calculant son empreinte au passage.
 *
 * ⚠️ Un SEUL parcours des octets. Lire une fois pour hacher puis une seconde
 * pour compresser doublerait le transfert depuis le stockage — et sur une
 * archive d'exercice, ce doublement se compte en minutes.
 */
async function appendHashed(
  archive: Archiver,
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
        // Contre-pression respectée : sans cette attente, un stockage rapide et
        // un compresseur lent feraient enfler le tampon jusqu'à la mémoire.
        await new Promise<void>((resolve) => relay.once("drain", resolve));
      }
    }
  } finally {
    reader.releaseLock();
    relay.end();
  }

  return { sha256: hash.digest("hex"), bytes };
}

function historyCsv(rows: readonly HistoryRow[], labels: DossierLabels): string {
  return buildCsv({
    headers: labels.historyHeaders,
    rows: rows.map((row) => [
      formatDateTimeFr(new Date(row.occurredAt)),
      row.source,
      row.actor ?? labels.system,
      row.onBehalfOf ?? "",
      labels.actionOf(row.action),
      row.fromStatus === null ? "" : labels.statusOf(row.fromStatus),
      row.toStatus === null ? "" : labels.statusOf(row.toStatus),
      row.reason ?? "",
    ]),
  });
}

/**
 * Construit l'archive d'un dossier.
 *
 * Rend immédiatement un flux : l'appelant peut commencer à répondre au navigateur
 * pendant que les pièces sont encore copiées. Le décompte final arrive par
 * `completion`, une fois l'archive close.
 */
export async function buildDossierArchive(
  occurrenceId: string,
  labels: DossierLabels,
  now: Date = new Date(),
): Promise<Result<DossierArchive>> {
  const detail = await getOccurrenceDetail(occurrenceId);
  if (!detail.ok) return err(detail.error);

  const [documents, rectifications, history, submission] = await Promise.all([
    listOccurrenceDocuments(occurrenceId),
    listRectifications(occurrenceId),
    loadHistory(occurrenceId),
    loadSubmissionFacts(occurrenceId),
  ]);

  if (!documents.ok) return err(documents.error);
  if (!rectifications.ok) return err(rectifications.error);
  if (!history.ok) return err(history.error);
  if (!submission.ok) return err(submission.error);

  const occurrence = detail.value;
  const fileName = buildArchiveName(occurrence.obligation.code, occurrence.periodKey, now);

  const archive = new ZipArchive({ zlib: { level: COMPRESSION_LEVEL } });
  const output = new PassThrough();
  archive.pipe(output);

  let totalBytes = 0;
  output.on("data", (chunk: Buffer) => {
    totalBytes += chunk.byteLength;
  });

  const completion = (async (): Promise<DossierSummary> => {
    const manifest: ManifestEntry[] = [];

    // ── 1. La fiche, en tête. Le « 00_ » la place première partout.
    const sheetData = toSheetData({
      occurrence,
      documents: documents.value,
      history: history.value,
      submission: submission.value,
      rectificationCount: rectifications.value.length,
      labels,
      now,
    });
    const sheet = await renderToBuffer(DossierSheet({ data: sheetData, labels }));
    archive.append(sheet, { name: "00_fiche_recapitulative.pdf" });
    manifest.push({
      path: "00_fiche_recapitulative.pdf",
      sha256: createHash("sha256").update(sheet).digest("hex"),
      bytes: sheet.byteLength,
      recordedSha256: null,
      matches: null,
    });

    // ── 2. Les pièces, dans l'ordre de la checklist.
    const ordered = [...documents.value].sort(
      (left, right) => (left.checklistOrder ?? 99) - (right.checklistOrder ?? 99),
    );

    for (const [index, document] of ordered.entries()) {
      const entryPath = documentEntryName(document, index);
      const source = await openDocumentStream(document.bucket, document.storagePath);

      if (!source.ok) {
        /*
         * ⚠️ Une pièce illisible ne fait PAS échouer l'archive : elle est
         * signalée dans le manifeste. Un dossier amputé d'une pièce, dont le
         * manifeste le dit, reste exploitable ; une archive qui échoue en entier
         * parce qu'un objet manque en stockage ne laisse rien du tout.
         */
        logger.error("Pièce illisible à l'export", {
          occurrenceId,
          documentId: document.id,
          code: source.error.code,
        });
        manifest.push({
          path: entryPath,
          sha256: "",
          bytes: 0,
          recordedSha256: document.sha256,
          matches: false,
        });
        continue;
      }

      const written = await appendHashed(archive, source.value, entryPath);
      manifest.push({
        path: entryPath,
        sha256: written.sha256,
        bytes: written.bytes,
        recordedSha256: document.sha256,
        matches: written.sha256 === document.sha256,
      });
    }

    // ── 3. Les rectificatives, dans leur sous-dossier.
    for (const rectification of rectifications.value) {
      const pieces = await listOccurrenceDocuments(rectification.id);
      if (!pieces.ok) continue;

      for (const [index, document] of pieces.value.entries()) {
        const entryPath = `rectificatives/${String(rectification.index).padStart(2, "0")}/${documentEntryName(document, index)}`;
        const source = await openDocumentStream(document.bucket, document.storagePath);
        if (!source.ok) continue;

        const written = await appendHashed(archive, source.value, entryPath);
        manifest.push({
          path: entryPath,
          sha256: written.sha256,
          bytes: written.bytes,
          recordedSha256: document.sha256,
          matches: written.sha256 === document.sha256,
        });
      }
    }

    // ── 4. Historique et manifeste, en dernier : le manifeste doit connaître
    //      les empreintes réellement écrites.
    const csv = historyCsv(history.value, labels);
    archive.append(Buffer.from(csv, "utf8"), { name: "historique.csv" });

    archive.append(
      Buffer.from(
        `${JSON.stringify(
          {
            generatedAt: now.toISOString(),
            occurrence: {
              id: occurrenceId,
              code: occurrence.obligation.code,
              period: occurrence.periodKey,
              status: occurrence.status,
            },
            note: labels.manifestNote,
            files: manifest,
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      { name: "manifest.json" },
    );

    await archive.finalize();

    return {
      documentCount: manifest.filter((entry) => entry.recordedSha256 !== null).length,
      rectificationCount: rectifications.value.length,
      bytes: totalBytes,
    };
  })();

  // Une erreur pendant la construction ne doit pas rester une promesse rejetée
  // sans écouteur : elle est journalisée, et le flux se ferme.
  completion.catch((cause: unknown) => {
    logger.error("Archive de dossier interrompue", {
      occurrenceId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    output.destroy(cause instanceof Error ? cause : new Error(String(cause)));
  });

  return ok({ fileName, stream: output, completion });
}

/** Traduit le détail d'occurrence en données de fiche. Aucune requête ici. */
function toSheetData(input: {
  readonly occurrence: OccurrenceDetailView;
  readonly documents: readonly ExportableDocument[];
  readonly history: readonly HistoryRow[];
  readonly submission: SubmissionFacts;
  readonly rectificationCount: number;
  readonly labels: DossierLabels;
  readonly now: Date;
}): DossierSheetData {
  const { occurrence, labels } = input;

  const ordered = [...input.documents].sort(
    (left, right) => (left.checklistOrder ?? 99) - (right.checklistOrder ?? 99),
  );

  return {
    obligationName: occurrence.obligation.name,
    obligationCode: occurrence.obligation.code,
    domainLabel: occurrence.obligation.domainLabel ?? "—",
    authorityName: occurrence.obligation.authorityName ?? "—",
    periodLabel: occurrence.periodKey,
    legalBasis: occurrence.obligation.legalBasis ?? "",
    internalDueDate: formatDateFr(new Date(`${occurrence.internalDueDate}T12:00:00Z`)),
    legalDueDate: formatDateFr(new Date(`${occurrence.legalDueDate}T12:00:00Z`)),
    submittedAt:
      input.submission.submittedAt === null
        ? null
        : formatDateTimeFr(new Date(input.submission.submittedAt)),
    lateDays: input.submission.lateDays,
    statusLabel: labels.statusOf(occurrence.status),
    ownerName: occurrence.ownerName ?? "—",
    validatorName: occurrence.validatorName ?? "—",
    lateReason: occurrence.lateReason,
    documents: ordered.map((document, index) => ({
      order: (document.checklistOrder ?? index) + 1,
      name: document.normalizedFilename,
      sizeLabel: humanSize(document.sizeBytes),
      sha256: document.sha256,
    })),
    timeline: input.history.map((row) => ({
      at: formatDateTimeFr(new Date(row.occurredAt)),
      who:
        row.onBehalfOf === null ? (row.actor ?? labels.system) : labels.onBehalfOf(row.onBehalfOf),
      what: labels.actionOf(row.action),
      detail:
        row.toStatus === null
          ? (row.reason ?? "")
          : `${row.fromStatus === null ? "" : labels.statusOf(row.fromStatus)} → ${labels.statusOf(row.toStatus)}`,
    })),
    rectificationCount: input.rectificationCount,
    generatedAtLabel: formatDateTimeFr(input.now),
    generatedByLabel: labels.generatedAt,
  };
}
