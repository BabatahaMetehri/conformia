/**
 * Assainissement et empreinte des pièces déposées.
 *
 * Fonctions PURES, sans dépendance à Node : le seul appel externe est
 * `crypto.subtle`, disponible aussi bien côté serveur que navigateur. Aucune de
 * ces fonctions ne décide d'un droit — elles préparent une donnée sûre.
 *
 * ⚠️ Rien de ce qui vient du navigateur n'est digne de confiance : ni le nom du
 * fichier, ni son type MIME annoncé, ni son extension. Chacun est recoupé.
 */

import { ALLOWED_MIME_TYPES, BLOCKED_EXTENSIONS } from "@/config/constants";

/**
 * Familles de signature réellement distinguables sur les premiers octets.
 *
 * Un .xlsx, un .docx et un .zip sont le MÊME format de conteneur : les
 * distinguer exigerait d'ouvrir l'archive. On vérifie donc la FAMILLE, ce qui
 * suffit à écarter un exécutable renommé en .pdf — le cas qui compte.
 */
export type FileFamily = "pdf" | "jpeg" | "png" | "tiff" | "zip" | "ole2" | "text";

interface Signature {
  readonly family: FileFamily;
  readonly bytes: readonly number[];
}

const SIGNATURES: readonly Signature[] = [
  { family: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { family: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { family: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { family: "tiff", bytes: [0x49, 0x49, 0x2a, 0x00] }, // petit-boutiste
  { family: "tiff", bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // gros-boutiste
  { family: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { family: "zip", bytes: [0x50, 0x4b, 0x05, 0x06] }, // archive vide
  { family: "zip", bytes: [0x50, 0x4b, 0x07, 0x08] }, // fragmentée
  { family: "ole2", bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }, // .doc / .xls
];

const FAMILY_BY_MIME: Readonly<Record<string, FileFamily>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/tiff": "tiff",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/vnd.ms-excel": "ole2",
  "application/msword": "ole2",
  "text/csv": "text",
  "text/plain": "text",
  "application/xml": "text",
  "text/xml": "text",
};

/** Famille déduite des premiers octets, ou `null` si aucune signature connue. */
export function sniffFamily(bytes: Uint8Array): FileFamily | null {
  for (const signature of SIGNATURES) {
    if (bytes.length < signature.bytes.length) continue;
    let matches = true;
    for (const [index, expected] of signature.bytes.entries()) {
      if (bytes[index] !== expected) {
        matches = false;
        break;
      }
    }
    if (matches) return signature.family;
  }
  return null;
}

export function familyOfMime(mimeType: string): FileFamily | null {
  return FAMILY_BY_MIME[mimeType.toLowerCase()] ?? null;
}

export type FileRejection =
  "MIME_NOT_ALLOWED" | "EXTENSION_BLOCKED" | "SIGNATURE_MISMATCH" | "EMPTY_FILE" | "TOO_LARGE";

export interface FileInspection {
  readonly detectedMimeFamily: FileFamily | null;
  readonly extension: string;
  readonly rejection: FileRejection | null;
}

/**
 * Contrôle complet d'un fichier avant dépôt.
 *
 * ⚠️ Un format TEXTE n'a aucune signature : refuser l'absence de signature
 * bloquerait tout CSV. On accepte donc « pas de signature » UNIQUEMENT quand le
 * type annoncé est lui-même textuel, et jamais l'inverse — un .exe annoncé en
 * PDF n'a pas la signature PDF et se fait refuser.
 */
export function inspectFile(
  filename: string,
  declaredMime: string,
  bytes: Uint8Array,
  maxSizeBytes: number,
): FileInspection {
  const extension = extensionOf(filename);
  const detected = sniffFamily(bytes);

  const rejection = ((): FileRejection | null => {
    if (bytes.length === 0) return "EMPTY_FILE";
    if (bytes.length > maxSizeBytes) return "TOO_LARGE";
    if (BLOCKED_EXTENSIONS.includes(extension)) return "EXTENSION_BLOCKED";
    if (!ALLOWED_MIME_TYPES.includes(declaredMime.toLowerCase())) return "MIME_NOT_ALLOWED";

    const declaredFamily = familyOfMime(declaredMime);
    if (declaredFamily === null) return "MIME_NOT_ALLOWED";
    if (detected === null) return declaredFamily === "text" ? null : "SIGNATURE_MISMATCH";
    return detected === declaredFamily ? null : "SIGNATURE_MISMATCH";
  })();

  return { detectedMimeFamily: detected, extension, rejection };
}

/** Extension en minuscules, sans point. Chaîne vide si le nom n'en porte pas. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Réduit un texte à `[a-z0-9-]`.
 *
 * ⚠️ C'est ce qui empêche un « ../ », un octet nul ou un caractère de contrôle
 * venu du navigateur d'atteindre le stockage. La normalisation NFD sépare les
 * diacritiques pour que « Déclaration » devienne « declaration » et non « d-claration ».
 */
export function slugify(value: string, maxLength = 60): string {
  return sanitize(value, maxLength).toLowerCase();
}

/**
 * Même assainissement, casse conservée.
 *
 * ⚠️ La plage de diacritiques est écrite en échappements `\uXXXX`, jamais avec les
 * caractères combinants eux-mêmes : des combinants littéraux rendent le fichier
 * source illisible et se perdent au premier outil qui renormalise l'encodage.
 */
export function sanitize(value: string, maxLength = 60): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned.slice(0, maxLength).replace(/-+$/, "");
}

export interface StoragePathParts {
  readonly entityCode: string;
  readonly domainCode: string;
  readonly obligationCode: string;
  readonly periodKey: string;
  readonly documentId: string;
  readonly originalFilename: string;
}

/**
 * Chemin de stockage, CONSTRUIT CÔTÉ SERVEUR EXCLUSIVEMENT.
 *
 * Chaque segment est passé au slug, y compris ceux qui viennent de la base :
 * un code d'obligation reste une saisie humaine.
 */
export function buildStoragePath(parts: StoragePathParts): string {
  const extension = extensionOf(parts.originalFilename);
  const stem = parts.originalFilename.replace(/\.[^.]*$/, "");
  const slug = slugify(stem) || "piece";
  const suffix = extension.length > 0 ? `.${extension}` : "";

  return [
    slugify(parts.entityCode) || "entite",
    slugify(parts.domainCode) || "domaine",
    slugify(parts.obligationCode) || "obligation",
    slugify(parts.periodKey) || "periode",
    `${parts.documentId}_${slug}${suffix}`,
  ].join("/");
}

export interface NormalizedNameParts {
  readonly obligationCode: string;
  readonly periodKey: string;
  readonly documentKind: string | null;
  /** Libellé de la pièce attendue, ou nom d'origine pour une pièce libre. */
  readonly pieceLabel: string;
  readonly version: number;
  readonly extension: string;
}

/**
 * Nom proposé au téléchargement.
 *
 * ⚠️ La convention de 0003 s'arrêtait à `{CODE}_{PERIODE}_{KIND}_v{N}` : deux
 * pièces DIFFÉRENTES de même nature sur le même dossier — deux JUSTIFICATIF —
 * produisaient le même nom en v1 et violaient la contrainte d'unicité
 * (occurrence_id, normalized_filename, version). Le libellé de la pièce a donc
 * été intercalé ; il est ce qui les distingue aux yeux de l'utilisateur.
 */
export function buildNormalizedFilename(parts: NormalizedNameParts): string {
  const segments = [
    sanitize(parts.obligationCode, 40).toUpperCase() || "OBLIGATION",
    sanitize(parts.periodKey, 40) || "periode",
    sanitize(parts.documentKind ?? "PIECE", 40).toUpperCase() || "PIECE",
    slugify(parts.pieceLabel, 40) || "piece",
    `v${String(parts.version)}`,
  ];
  const suffix = parts.extension.length > 0 ? `.${parts.extension}` : "";

  return `${segments.join("_")}${suffix}`;
}

/** Empreinte SHA-256 en hexadécimal minuscule, calculée à la frontière du dépôt. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `Uint8Array` porte un ArrayBufferLike ; `crypto.subtle` attend un BufferSource.
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Type MIME canonique d'une famille détectée.
 *
 * `detected_mime_type` doit rester un type MIME — c'est ce que la colonne
 * annonce et ce qu'un contrôle d'intégrité ultérieur comparera. Les conteneurs
 * ZIP et OLE2 rendent le type du CONTENEUR, pas celui du document qu'il porte :
 * distinguer un .xlsx d'un .docx exigerait d'ouvrir l'archive, et ce n'est pas
 * ce que cette vérification cherche à établir.
 */
export function canonicalMimeOfFamily(family: FileFamily | null): string | null {
  switch (family) {
    case "pdf":
      return "application/pdf";
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "tiff":
      return "image/tiff";
    case "zip":
      return "application/zip";
    case "ole2":
      return "application/x-ole-storage";
    // Un format textuel n'a pas de signature : rien à affirmer, donc rien d'écrit.
    case "text":
    case null:
      return null;
  }
}
