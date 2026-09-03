"use client";

/**
 * File d'envois directs vers le stockage, avec progression individuelle et
 * reprise après échec.
 *
 * ⚠️ Placé dans `components/shared` et non dans une feature : l'onglet
 * « Dossier » d'une occurrence et l'écran /documents en ont tous deux besoin, et
 * la barrière inter-features interdit à l'un d'importer l'autre. Le hook ne
 * connaît aucune Server Action : elles lui sont REMISES en paramètre. C'est ce
 * qui lui permet de servir deux features sans en dépendre d'aucune.
 *
 * Il ne décide d'aucun droit. Les contrôles qu'il applique avant l'envoi —
 * extension bannie, type hors liste, fichier trop gros — sont du CONFORT : ils
 * évitent un aller-retour, ils ne protègent rien. Le serveur les refait, et la
 * base refait l'essentiel.
 */

import { useCallback, useRef, useState } from "react";

import { MAX_UPLOAD_MB } from "@/config/constants";
import { HEADER_SNIFF_BYTES, inspectHeader, type FileRejection } from "@/lib/files";
import { hashFile, uploadToSignedUrl } from "@/lib/upload-transport";

const MEGABYTE = 1024 * 1024;

export type UploadStage =
  "QUEUED" | "REQUESTING" | "UPLOADING" | "HASHING" | "CONFIRMING" | "DONE" | "FAILED";

export interface UploadEntry {
  readonly key: string;
  readonly file: File;
  readonly checklistItemId: string | null;
  readonly stage: UploadStage;
  /** Fraction envoyée, de 0 à 1. */
  readonly progress: number;
  /** Code de refus, à traduire par l'appelant. `null` tant que rien n'a échoué. */
  readonly failure: string | null;
  readonly documentId: string | null;
  readonly normalizedFilename: string | null;
}

/** Forme minimale attendue des Server Actions, sans lier le hook à une feature. */
type ActionResult<T> =
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly error: { readonly details?: unknown } };

export interface UploadTicketShape {
  readonly ticketId: string;
  readonly uploadUrl: string;
  readonly normalizedFilename: string;
}

export interface DirectUploadPorts {
  readonly requestTicket: (input: {
    occurrenceId: string;
    checklistItemId: string | null;
    filename: string;
    declaredMimeType: string;
    sizeBytes: number;
  }) => Promise<ActionResult<UploadTicketShape>>;
  readonly confirm: (input: {
    ticketId: string;
    sha256: string;
  }) => Promise<ActionResult<{ documentId: string; normalizedFilename: string }>>;
  /**
   * Ordonnance le dépôt. Le hook ne décide pas COMMENT il est lancé.
   *
   * ⚠️ L'APPELANT NE DOIT PAS ENCHAÎNER UN `router.refresh()` SUR LA FIN DE
   * `run()`. Mesuré dans un build de production, sur une quinzaine
   * d'exécutions : demandé dans la même boucle que la fin de la Server Action,
   * le rafraîchissement part et le navigateur l'interrompt
   * (`net::ERR_ABORTED`) — la requête ne revient jamais jusqu'à React. Selon la
   * vitesse de la machine, l'écran se met à jour ou reste figé sur les anciennes
   * données pendant que la pièce, elle, est bien enregistrée. C'est le pire des
   * états : l'utilisateur croit son dépôt perdu et le recommence.
   *
   * Ces formes ont toutes été essayées et MESURÉES intermittentes :
   *   • `void run().then(() => router.refresh())` ;
   *   • `startTransition(async () => { await run(); router.refresh(); })` ;
   *   • le même, décalé d'un `setTimeout(..., 0)`.
   *
   * La forme qui tient est ailleurs : l'appelant lance le dépôt seul, et
   * REDEMANDE la page tant qu'elle n'a pas vu la pièce — condition d'arrêt
   * factuelle, pas temporelle. Voir `occurrence-checklist.tsx`.
   */
  readonly runInTransition?: ((run: () => Promise<void>) => void) | undefined;
}

/** Extrait le code de refus rendu par le serveur, à défaut un code générique. */
function failureCodeOf(error: { readonly details?: unknown }): string {
  const details = error.details;
  if (typeof details === "object" && details !== null && "reason" in details) {
    const reason = (details as { reason?: unknown }).reason;
    if (typeof reason === "string") return reason;
  }
  return "UPLOAD_FAILED";
}

export function useDirectUpload(occurrenceId: string, ports: DirectUploadPorts) {
  const [entries, setEntries] = useState<readonly UploadEntry[]>([]);
  // Compteur de clés : deux fichiers homonymes déposés d'affilée doivent rester
  // deux lignes distinctes dans la file.
  const sequence = useRef(0);

  const patch = useCallback((key: string, change: Partial<UploadEntry>): void => {
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)),
    );
  }, []);

  const run = useCallback(
    async (entry: UploadEntry): Promise<void> => {
      patch(entry.key, { stage: "REQUESTING", failure: null, progress: 0 });

      const ticket = await ports.requestTicket({
        occurrenceId,
        checklistItemId: entry.checklistItemId,
        filename: entry.file.name,
        declaredMimeType: entry.file.type,
        sizeBytes: entry.file.size,
      });

      if (ticket.status === "error") {
        patch(entry.key, { stage: "FAILED", failure: failureCodeOf(ticket.error) });
        return;
      }

      patch(entry.key, { stage: "UPLOADING" });

      const sent = await uploadToSignedUrl({
        url: ticket.data.uploadUrl,
        file: entry.file,
        contentType: entry.file.type,
        onProgress: (fraction) => {
          patch(entry.key, { progress: fraction });
        },
      });

      if (!sent.ok) {
        patch(entry.key, { stage: "FAILED", failure: sent.error ?? "NETWORK" });
        return;
      }

      // L'empreinte est calculée APRÈS l'envoi : elle n'a de sens qu'une fois les
      // octets partis, et la calculer avant retarderait le début du transfert de
      // plusieurs secondes sur un gros fichier, sans rien apporter.
      patch(entry.key, { stage: "HASHING", progress: 1 });
      const sha256 = await hashFile(entry.file);

      patch(entry.key, { stage: "CONFIRMING" });
      const confirmed = await ports.confirm({ ticketId: ticket.data.ticketId, sha256 });

      if (confirmed.status === "error") {
        patch(entry.key, { stage: "FAILED", failure: failureCodeOf(confirmed.error) });
        return;
      }

      patch(entry.key, {
        stage: "DONE",
        progress: 1,
        documentId: confirmed.data.documentId,
        normalizedFilename: confirmed.data.normalizedFilename,
      });
    },
    [occurrenceId, patch, ports],
  );

  /**
   * Refus décidés sans quitter le navigateur — pour éviter une attente inutile.
   *
   * ⚠️ La signature binaire est vérifiée ICI AUSSI, sur les premiers kilo-octets
   * lus dans le navigateur. Ce n'est PAS ce qui protège : un client hostile ne
   * fait pas tourner ce code. C'est ce qui évite à un utilisateur honnête
   * d'attendre l'envoi complet de 20 Mo pour apprendre que son fichier portait
   * la mauvaise extension. Le contrôle qui fait foi est celui du serveur, sur
   * l'objet réellement stocké.
   */
  const preflight = useCallback(async (file: File): Promise<FileRejection | null> => {
    if (file.size === 0) return "EMPTY_FILE";
    if (file.size > MAX_UPLOAD_MB * MEGABYTE) return "TOO_LARGE";

    const header = new Uint8Array(await file.slice(0, HEADER_SNIFF_BYTES).arrayBuffer());
    return inspectHeader(file.name, file.type, header).rejection;
  }, []);

  const enqueue = useCallback(
    (files: readonly File[], checklistItemId: string | null): void => {
      const created = files.map((file) => {
        sequence.current += 1;
        return {
          key: `${String(sequence.current)}:${file.name}`,
          file,
          checklistItemId,
          stage: "QUEUED" as const,
          progress: 0,
          failure: null,
          documentId: null,
          normalizedFilename: null,
        } satisfies UploadEntry;
      });

      setEntries((current) => [...current, ...created]);

      // Les envois partent en parallèle : chacun a sa propre barre, et rien ne
      // justifie de faire attendre le second fichier que le premier soit fini.
      const start =
        ports.runInTransition ??
        ((task: () => Promise<void>) => {
          void task();
        });

      for (const entry of created) {
        void preflight(entry.file).then((rejection) => {
          if (rejection !== null) {
            patch(entry.key, { stage: "FAILED", failure: rejection });
            return;
          }
          start(() => run(entry));
        });
      }
    },
    [patch, ports, preflight, run],
  );

  /**
   * Reprise après échec.
   *
   * ⚠️ Reprend au DÉBUT, avec un billet neuf. Reprendre l'envoi interrompu au
   * bon octet supposerait un protocole de reprise partielle que le stockage
   * n'offre pas pour une URL signée ; et le billet précédent, lui, a pu expirer.
   * Le fichier étant toujours dans le navigateur, tout renvoyer coûte du temps,
   * jamais une ressaisie.
   */
  const retry = useCallback(
    (key: string): void => {
      setEntries((current) => {
        const entry = current.find((candidate) => candidate.key === key);
        if (entry !== undefined && entry.stage === "FAILED") void run(entry);
        return current;
      });
    },
    [run],
  );

  const dismiss = useCallback((key: string): void => {
    setEntries((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const clearFinished = useCallback((): void => {
    setEntries((current) => current.filter((entry) => entry.stage !== "DONE"));
  }, []);

  const isBusy = entries.some(
    (entry) => entry.stage !== "DONE" && entry.stage !== "FAILED" && entry.stage !== "QUEUED",
  );

  return { entries, enqueue, retry, dismiss, clearFinished, isBusy };
}
