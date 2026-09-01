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
 * Contrôle d'un fichier sur ses PREMIERS OCTETS.
 *
 * ⚠️ Ne porte PAS sur la taille, délibérément. Depuis 0009 le serveur ne voit
 * jamais le fichier entier : il relit l'en-tête de l'objet stocké, quelques
 * kilo-octets. Y appliquer une borne de taille conclurait « fichier de 4 Ko »
 * sur un PDF de 8 Mo. La taille réelle est vérifiée ailleurs, en confrontant
 * celle de l'objet stocké à celle qu'annonçait le billet.
 *
 * Tout le reste — extension bannie, type hors liste blanche, signature qui
 * dément le type annoncé — se tranche sur l'en-tête seul, et c'est là que se
 * joue le refus d'un exécutable rebaptisé en .pdf.
 *
 * ⚠️ Un format TEXTE n'a aucune signature : refuser l'absence de signature
 * bloquerait tout CSV. On accepte donc « pas de signature » UNIQUEMENT quand le
 * type annoncé est lui-même textuel, et jamais l'inverse.
 */
export function inspectHeader(
  filename: string,
  declaredMime: string,
  headerBytes: Uint8Array,
): FileInspection {
  const extension = extensionOf(filename);
  const detected = sniffFamily(headerBytes);

  const rejection = ((): FileRejection | null => {
    if (headerBytes.length === 0) return "EMPTY_FILE";
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
 * Racine du nom normalisé, SANS le numéro de version ni l'extension.
 *
 * ⚠️ Cette découpe n'est pas cosmétique. Depuis 0009, le numéro de version est
 * arrêté par la base au moment où elle émet le billet de dépôt — c'est ce qui
 * empêche deux envois simultanés de revendiquer tous deux « v2 ». Le nom complet
 * ne peut donc plus être composé ici : le serveur fournit la racine assainie,
 * `create_document_upload_ticket` y appose la version qu'elle vient de réserver.
 *
 * Le jeu de caractères produit est celui qu'exige la contrainte de forme de cette
 * fonction SQL (`^[A-Za-z0-9_-]{1,180}$`) : les deux doivent rester d'accord.
 */
export function buildNormalizedStem(parts: Omit<NormalizedNameParts, "version" | "extension">) {
  return [
    sanitize(parts.obligationCode, 40).toUpperCase() || "OBLIGATION",
    sanitize(parts.periodKey, 40) || "periode",
    sanitize(parts.documentKind ?? "PIECE", 40).toUpperCase() || "PIECE",
    slugify(parts.pieceLabel, 40) || "piece",
  ].join("_");
}

/** Nombre d'octets de tête suffisant pour trancher toutes les signatures connues. */
export const HEADER_SNIFF_BYTES = 4096;

/**
 * Nom sûr pour un en-tête `Content-Disposition`.
 *
 * ⚠️ Un `\r` ou un `\n` dans un nom de fichier permet d'injecter un en-tête HTTP
 * entier. Le nom que nous servons est déjà produit par `buildNormalizedFilename`
 * et ne peut pas en contenir — raison de plus pour ne pas s'en remettre à cette
 * propriété : elle est vraie aujourd'hui parce que personne n'a encore introduit
 * un chemin où le nom d'origine ressortirait tel quel.
 */
export function sanitizeDownloadFilename(filename: string, fallback = "document"): string {
  const cleaned = filename
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
    .trim()
    .slice(0, 200);

  return cleaned.length > 0 ? cleaned : fallback;
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
