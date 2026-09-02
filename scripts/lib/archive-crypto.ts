/**
 * Chiffrement des archives de sauvegarde.
 *
 * ⚠️ EXTRAIT DES SCRIPTS POUR ÊTRE TESTÉ. C'est le code dont l'échec est le plus
 * coûteux et le plus tardif : une erreur ici ne se voit pas à la sauvegarde,
 * elle se voit à la restauration, des mois plus tard, quand l'archive refuse de
 * s'ouvrir et qu'il n'y a plus de recours. Le test d'aller-retour de
 * `tests/unit/archive-crypto.test.ts` est la seule chose qui interdit ce
 * scénario.
 *
 * Format : [sel 16][vecteur 12][chiffré …][marqueur d'authenticité 16]
 *
 * ⚠️ AES-256-GCM et non CBC : GCM AUTHENTIFIE en plus de chiffrer. Une archive
 * corrompue ou modifiée d'un seul octet fait ÉCHOUER le déchiffrement, au lieu
 * de rendre des données fausses. Une restauration silencieusement partielle
 * serait plus dangereuse qu'un échec franc — on lui ferait confiance.
 *
 * ⚠️ Sel ALÉATOIRE par archive : deux sauvegardes d'un contenu identique
 * produisent deux fichiers différents. Un sel fixe permettrait de reconnaître
 * qu'une journée n'a rien changé, ce qui renseigne un observateur sur l'activité
 * de l'entreprise.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = SALT_BYTES + IV_BYTES;

/** Longueur minimale de la clé. Une clé courte ne protège rien. */
export const MIN_KEY_LENGTH = 32;

export function deriveKey(secret: string, salt: Buffer): Buffer {
  // scrypt plutôt qu'un hachage direct : coûteux à calculer, donc coûteux à
  // attaquer par force brute si une archive et sa clé faible fuitaient ensemble.
  return scryptSync(secret, salt, 32);
}

export async function encryptFile(
  source: string,
  target: string,
  secret: string,
): Promise<{ bytes: number }> {
  if (secret.length < MIN_KEY_LENGTH) {
    throw new Error(
      `clé de chiffrement trop courte (${String(MIN_KEY_LENGTH)} caractères minimum).`,
    );
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, salt), iv);

  const output = createWriteStream(target);
  output.write(salt);
  output.write(iv);

  const handle = await open(source, "r");
  try {
    // `end: false` : le flux reste ouvert pour écrire le marqueur, qui n'existe
    // qu'une fois le dernier bloc chiffré.
    await pipeline(handle.createReadStream(), cipher, output, { end: false });
  } finally {
    await handle.close();
  }

  await new Promise<void>((resolve, reject) => {
    output.on("error", reject);
    output.end(cipher.getAuthTag(), () => {
      resolve();
    });
  });

  return { bytes: (await stat(target)).size };
}

export async function decryptFile(source: string, target: string, secret: string): Promise<void> {
  const size = (await stat(source)).size;

  // ⚠️ `<` et non `<=` : une charge utile vide produit EXACTEMENT
  // en-tête + marqueur. La borne stricte rejetait cette archive pourtant valide
  // — une erreur d'une unité, invisible jusqu'au jour où elle refuse une vraie
  // sauvegarde à la restauration.
  if (size < HEADER_BYTES + TAG_BYTES) {
    throw new Error("archive trop courte pour être valide.");
  }

  const handle = await open(source, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);

    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);

    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret, header.subarray(0, SALT_BYTES)),
      header.subarray(SALT_BYTES, HEADER_BYTES),
    );
    decipher.setAuthTag(tag);

    /*
     * ⚠️ Le marqueur est vérifié à la FERMETURE du flux, pas à l'ouverture : une
     * archive altérée écrit donc des octets avant d'échouer. Le fichier cible
     * est incomplet en cas d'erreur — c'est pourquoi l'appelant doit traiter
     * l'exception comme « archive inutilisable », et jamais reprendre ce qui a
     * été écrit.
     */
    /*
     * ⚠️ CHARGE UTILE VIDE traitée à part. `createReadStream` avec `start`
     * supérieur à `end` lève ERR_OUT_OF_RANGE : une archive de charge nulle —
     * en-tête et marqueur seuls — faisait donc échouer le déchiffrement sur une
     * erreur de plage, en la présentant comme une archive corrompue. Le
     * marqueur, lui, se vérifie quand même : `final()` lève si la clé est
     * fausse.
     */
    if (size === HEADER_BYTES + TAG_BYTES) {
      const empty = Buffer.concat([decipher.update(Buffer.alloc(0)), decipher.final()]);
      await writeFile(target, empty);
      return;
    }

    await pipeline(
      createReadStream(source, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(target),
    );
  } finally {
    await handle.close();
  }
}
