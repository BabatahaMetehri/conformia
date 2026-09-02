// @vitest-environment node

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decryptFile,
  encryptFile,
  HEADER_BYTES,
  MIN_KEY_LENGTH,
  TAG_BYTES,
} from "../../scripts/lib/archive-crypto.ts";

/**
 * Le chiffrement des sauvegardes.
 *
 * ⚠️ C'EST LE CODE DONT L'ÉCHEC EST LE PLUS TARDIF ET LE PLUS COÛTEUX. Une erreur
 * ici ne se voit pas à la sauvegarde : elle se voit à la restauration, des mois
 * plus tard, quand l'archive refuse de s'ouvrir et qu'il n'y a plus de recours.
 * L'aller-retour ci-dessous est la seule chose qui interdit ce scénario.
 */

const KEY = "0123456789abcdef0123456789abcdef";
let workDir = "";

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "conformia-crypto-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function write(name: string, content: Buffer | string): string {
  const path = join(workDir, name);
  writeFileSync(path, content);
  return path;
}

describe("aller-retour", () => {
  it("rend EXACTEMENT le contenu d'origine", async () => {
    const original = randomBytes(64 * 1024);
    const source = write("source.bin", original);
    const encrypted = join(workDir, "source.bin.enc");
    const restored = join(workDir, "source.restored.bin");

    await encryptFile(source, encrypted, KEY);
    await decryptFile(encrypted, restored, KEY);

    expect(readFileSync(restored).equals(original)).toBe(true);
  });

  it("survit à un fichier vide", async () => {
    const source = write("vide.bin", Buffer.alloc(0));
    const encrypted = join(workDir, "vide.enc");
    const restored = join(workDir, "vide.restored");

    await encryptFile(source, encrypted, KEY);
    await decryptFile(encrypted, restored, KEY);

    expect(readFileSync(restored).byteLength).toBe(0);
  });

  it("survit à un contenu plus gros qu'un tampon de flux", async () => {
    // 3 Mo : plusieurs blocs, donc plusieurs passages dans le chiffreur. Un
    // aller-retour qui ne tient que sur un petit fichier ne prouve rien d'une
    // archive de plusieurs gigaoctets.
    const original = randomBytes(3 * 1024 * 1024);
    const source = write("gros.bin", original);
    const encrypted = join(workDir, "gros.enc");
    const restored = join(workDir, "gros.restored");

    await encryptFile(source, encrypted, KEY);
    await decryptFile(encrypted, restored, KEY);

    expect(readFileSync(restored).equals(original)).toBe(true);
  });
});

describe("format", () => {
  it("préfixe un sel et un vecteur, suffixe un marqueur", async () => {
    const original = randomBytes(1000);
    const source = write("format.bin", original);
    const encrypted = join(workDir, "format.enc");

    const { bytes } = await encryptFile(source, encrypted, KEY);

    expect(bytes).toBe(HEADER_BYTES + original.byteLength + TAG_BYTES);
  });

  it("produit DEUX FICHIERS DIFFÉRENTS pour un contenu identique", async () => {
    /*
     * ⚠️ Sel aléatoire par archive. Avec un sel fixe, deux sauvegardes d'un
     * contenu inchangé donneraient des fichiers identiques — et un observateur
     * qui voit passer les archives apprendrait, sans les déchiffrer, quels jours
     * l'entreprise n'a rien fait.
     */
    const source = write("meme.bin", Buffer.from("contenu identique"));
    const first = join(workDir, "meme-1.enc");
    const second = join(workDir, "meme-2.enc");

    await encryptFile(source, first, KEY);
    await encryptFile(source, second, KEY);

    expect(readFileSync(first).equals(readFileSync(second))).toBe(false);
  });
});

describe("refus", () => {
  it("REFUSE une clé trop courte", async () => {
    const source = write("court.bin", Buffer.from("x"));
    await expect(encryptFile(source, join(workDir, "court.enc"), "trop-court")).rejects.toThrow(
      new RegExp(String(MIN_KEY_LENGTH)),
    );
  });

  it("REFUSE de déchiffrer avec la mauvaise clé", async () => {
    const source = write("cle.bin", randomBytes(2048));
    const encrypted = join(workDir, "cle.enc");
    await encryptFile(source, encrypted, KEY);

    await expect(
      decryptFile(encrypted, join(workDir, "cle.restored"), "f".repeat(32)),
    ).rejects.toThrow();
  });

  it("DÉTECTE UN OCTET MODIFIÉ", async () => {
    /*
     * ⚠️ La raison d'être de GCM plutôt que CBC. Avec un mode qui n'authentifie
     * pas, une archive altérée se déchiffrerait en données FAUSSES — et une
     * restauration silencieusement corrompue est pire qu'une restauration
     * impossible : on lui ferait confiance.
     */
    const source = write("altere.bin", randomBytes(4096));
    const encrypted = join(workDir, "altere.enc");
    await encryptFile(source, encrypted, KEY);

    const bytes = readFileSync(encrypted);
    const middle = Math.floor(bytes.byteLength / 2);
    bytes[middle] = (bytes[middle] ?? 0) ^ 0xff;
    writeFileSync(encrypted, bytes);

    await expect(decryptFile(encrypted, join(workDir, "altere.restored"), KEY)).rejects.toThrow();
  });

  it("DÉTECTE UNE TRONCATURE", async () => {
    const source = write("tronque.bin", randomBytes(4096));
    const encrypted = join(workDir, "tronque.enc");
    await encryptFile(source, encrypted, KEY);

    const bytes = readFileSync(encrypted);
    writeFileSync(encrypted, bytes.subarray(0, bytes.byteLength - 500));

    await expect(decryptFile(encrypted, join(workDir, "tronque.restored"), KEY)).rejects.toThrow();
  });

  it("refuse un fichier trop court pour porter un en-tête", async () => {
    const encrypted = write("minuscule.enc", Buffer.alloc(10));
    await expect(decryptFile(encrypted, join(workDir, "minuscule.restored"), KEY)).rejects.toThrow(
      /trop courte/,
    );
  });
});
