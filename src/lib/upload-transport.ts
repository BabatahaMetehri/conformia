/**
 * Transport d'envoi direct, côté NAVIGATEUR.
 *
 * ⚠️ Ce module est la raison pour laquelle le fichier ne traverse pas le serveur
 * applicatif : il envoie les octets du poste de l'utilisateur vers le stockage,
 * sans intermédiaire. Il ne décide d'aucun droit — l'autorisation lui est
 * remise sous forme d'URL signée, déjà bornée à un chemin unique et à une seule
 * écriture. Il ne connaît ni Supabase, ni React, ni aucune couche du projet :
 * c'est du HTTP et une empreinte.
 *
 * XHR plutôt que `fetch` : `fetch` ne rend toujours pas la progression d'un
 * ENVOI de façon portable. Or une pièce de 25 Mo sur une liaison ordinaire
 * prend assez de temps pour qu'une barre figée passe pour un blocage, et un
 * utilisateur qui croit l'outil bloqué renvoie le fichier — ou l'envoie par
 * courriel, ce que ce projet existe pour éviter.
 */

/** Erreurs de transport, distinctes des refus métier rendus par le serveur. */
export type UploadTransportError = "NETWORK" | "ABORTED" | "ALREADY_EXISTS" | "REJECTED_BY_STORAGE";

export interface UploadTransportResult {
  readonly ok: boolean;
  readonly error: UploadTransportError | null;
  readonly status: number;
}

export interface DirectUploadInput {
  readonly url: string;
  readonly file: Blob;
  readonly contentType: string;
  readonly onProgress: (fraction: number) => void;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Envoie le fichier vers l'URL signée.
 *
 * L'URL porte un jeton qui EMBARQUE le chemin de destination : le navigateur ne
 * peut donc pas rediriger l'envoi ailleurs dans le bucket, même en modifiant
 * l'adresse. Le stockage refuse par ailleurs d'écraser un objet existant — un
 * rejeu répond 409, ce qui est traité ici comme un succès déjà acquis plutôt
 * que comme une erreur, pour rendre la reprise après échec idempotente.
 */
export function uploadToSignedUrl(input: DirectUploadInput): Promise<UploadTransportResult> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", input.url, true);
    request.setRequestHeader("Content-Type", input.contentType);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress(event.loaded / event.total);
      }
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress(1);
        resolve({ ok: true, error: null, status: request.status });
        return;
      }

      // 400/409 « KeyAlreadyExists » : les octets sont DÉJÀ au bon endroit. Une
      // reprise après coupure retombe exactement là ; la traiter en échec
      // condamnerait l'utilisateur à ne jamais pouvoir finir son dépôt.
      const duplicate = request.responseText.includes("KeyAlreadyExists");
      if (duplicate) {
        input.onProgress(1);
        resolve({ ok: true, error: "ALREADY_EXISTS", status: request.status });
        return;
      }

      resolve({ ok: false, error: "REJECTED_BY_STORAGE", status: request.status });
    });

    request.addEventListener("error", () => {
      resolve({ ok: false, error: "NETWORK", status: request.status });
    });
    request.addEventListener("abort", () => {
      resolve({ ok: false, error: "ABORTED", status: 0 });
    });

    input.signal?.addEventListener("abort", () => {
      request.abort();
    });

    request.send(input.file);
  });
}

/**
 * Empreinte SHA-256 du fichier, calculée dans le navigateur.
 *
 * ⚠️ Cette empreinte est DÉCLARATIVE. Le serveur ne peut pas la recalculer au
 * dépôt puisqu'il ne voit pas les octets ; il la conserve telle quelle et laisse
 * `documents.integrity_status` à PENDING. C'est le contrôle mensuel qui la
 * confronte aux octets stockés et la fait passer à VERIFIED. Rien dans
 * l'interface ne doit présenter une empreinte PENDING comme une preuve.
 */
export async function hashFile(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
