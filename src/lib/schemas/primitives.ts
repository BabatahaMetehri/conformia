import { z } from "zod";

/**
 * Briques de validation partagées.
 *
 * ⚠️ UNE RÈGLE VIT ICI, ET NULLE PART AILLEURS. Avant ce module, chaque fichier
 * d'actions redéclarait `z.uuid()`, `z.string().min(10)` et sa propre idée d'un
 * motif acceptable. Deux copies d'une règle divergent au premier ajustement, et
 * c'est toujours celle qu'on a oubliée qui laisse passer la saisie fautive.
 *
 * ⚠️ LES MESSAGES SONT DES CLÉS i18n, jamais du français. Le même schéma sert au
 * navigateur et au serveur : un message rédigé ici s'afficherait en dur dans un
 * formulaire, ce que CLAUDE.md §6 interdit. La traduction se fait au rendu, par
 * `translateIssue`.
 */

// ─── Identifiants ────────────────────────────────────────────────────────────

/**
 * UUID vérifié AVANT toute requête.
 *
 * ⚠️ Ce n'est pas une politesse d'affichage. PostgreSQL rejette un identifiant
 * mal formé par une erreur `22P02` que la couche d'erreurs traduit en
 * « validation », mais l'aller-retour a déjà eu lieu — et sur une route publique,
 * il devient un moyen de sonder la base. Le refus se fait ici.
 *
 * ⚠️ `z.guid()` ET NON `z.uuid()`, et la nuance est un défaut évité de peu.
 * `z.uuid()` impose les bits de version et de variante de la RFC 4122 ; le type
 * `uuid` de PostgreSQL, lui, accepte toute forme 8-4-4-4-12 hexadécimale. Un
 * validateur PLUS STRICT QUE LA BASE refuse des identifiants qui existent
 * réellement en table — ceux des jeux d'essai de ce dépôt, ou tout identifiant
 * repris d'un système tiers. L'entrée serait rejetée en 422 sans jamais
 * atteindre une requête qui, elle, aurait fonctionné. On valide donc ce que le
 * magasin accepte, ni plus, ni moins.
 */
export const uuidSchema = z.guid({ error: "validation.uuid" });

// ─── Textes ──────────────────────────────────────────────────────────────────

/**
 * Caractères invisibles refusés : contrôles C0/C1, largeur nulle, séparateurs
 * de ligne Unicode, marque d'ordre des octets. La tabulation et les sauts de
 * ligne restent autorisés — un motif multiligne est légitime.
 *
 * ⚠️ Ils ne se voient pas, et c'est tout le problème. Un caractère de largeur
 * nulle rend deux codes d'obligation visuellement identiques et non égaux ; un
 * séparateur de ligne Unicode casse le rendu d'un PDF ; un contrôle C0 corrompt
 * un export CSV. On les refuse à l'entrée plutôt que de les traquer à la sortie.
 *
 * ⚠️ COMPARAISON NUMÉRIQUE, pas expression régulière. Une classe de caractères
 * contenant ces points de code s'écrit avec des échappements que le moindre
 * reformatage ou changement d'encodage transforme en caractères BRUTS —
 * invisibles dans l'éditeur, et le fichier ne compile plus. C'est exactement ce
 * qui est arrivé en écrivant cette fonction.
 */
const ALLOWED_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (ALLOWED_CONTROLS.has(code)) continue;

    const isC0 = code <= 0x1f;
    const isC1 = code >= 0x7f && code <= 0x9f;
    const isZeroWidth = code >= 0x200b && code <= 0x200f;
    const isLineSeparator = code === 0x2028 || code === 0x2029;
    const isByteOrderMark = code === 0xfeff;

    if (isC0 || isC1 || isZeroWidth || isLineSeparator || isByteOrderMark) return true;
  }
  return false;
}

/** Longueur RÉELLE : espaces multiples repliés, extrémités coupées. */
export function significantLength(value: string): number {
  return value.trim().replaceAll(/\s+/g, " ").length;
}

/**
 * Reconnaît une saisie de remplissage.
 *
 * ⚠️ Le cas visé est réel et fréquent : « aaaaaaaaaa », « ........ », « azerty
 * azerty », saisis pour franchir un champ obligatoire. Un motif de retard qui ne
 * dit rien vaut moins qu'un champ vide — il fait croire qu'une explication
 * existe, et il pollue l'analyse des causes.
 *
 * Trois signaux, volontairement grossiers : un texte qui n'emploie presque aucun
 * caractère distinct, un motif court répété en boucle, ou une absence totale de
 * lettre. On ne cherche pas à juger la qualité d'une explication, seulement à
 * écarter ce qui n'en est manifestement pas une.
 */
export function isRepetitive(value: string): boolean {
  const compact = value.trim().replaceAll(/\s+/g, " ").toLowerCase();
  if (compact.length === 0) return true;

  // Aucune lettre : « 1234567890 », « ---------- ».
  if (!/\p{L}/u.test(compact)) return true;

  // Moins de quatre caractères distincts sur dix ou plus.
  const distinct = new Set(compact.replaceAll(" ", "")).size;
  if (compact.length >= 10 && distinct < 4) return true;

  // Un motif de 1 à 6 caractères répété au moins trois fois sur toute la chaîne.
  for (let size = 1; size <= 6; size += 1) {
    if (compact.length < size * 3) break;
    const pattern = compact.slice(0, size);
    if (compact.length % size === 0 && pattern.repeat(compact.length / size) === compact) {
      return true;
    }
  }

  return false;
}

export interface TextOptions {
  readonly min?: number;
  readonly max: number;
}

/** Texte libre : contrôle des caractères invisibles, bornes explicites. */
export function textSchema({ min = 1, max }: TextOptions) {
  return z
    .string()
    .trim()
    .min(min, { error: "validation.tooShort" })
    .max(max, { error: "validation.tooLong" })
    .refine((value) => !hasControlCharacters(value), { error: "validation.controlCharacters" });
}

/** Texte facultatif : la chaîne vide devient `undefined`, jamais `""`. */
export function optionalTextSchema(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: "validation.tooLong" })
    .refine((value) => !hasControlCharacters(value), { error: "validation.controlCharacters" })
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();
}

/**
 * Longueur minimale d'un motif obligatoire.
 *
 * Dix caractères SIGNIFICATIFS : assez pour « oubli du service », pas assez pour
 * « ok ». Le chiffre vient de l'énoncé ; ce qui compte est qu'il porte sur la
 * longueur repliée, sans quoi onze espaces suffiraient.
 */
export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 1000;

/**
 * Motif obligatoire — rejet, réouverture, désactivation, suppression.
 *
 * ⚠️ Ces motifs sont lus par quelqu'un d'autre, parfois des mois plus tard,
 * parfois par un contrôleur. C'est le seul champ du produit dont la QUALITÉ est
 * validée, et non seulement la forme.
 */
export const reasonSchema = z
  .string()
  .trim()
  .refine((value) => significantLength(value) >= REASON_MIN_LENGTH, {
    error: "validation.reasonTooShort",
  })
  .refine((value) => significantLength(value) <= REASON_MAX_LENGTH, {
    error: "validation.reasonTooLong",
  })
  .refine((value) => !hasControlCharacters(value), { error: "validation.controlCharacters" })
  .refine((value) => !isRepetitive(value), { error: "validation.reasonNotMeaningful" });

/** Code de référentiel : majuscules, chiffres, tiret, sous-tiret. */
export const codeSchema = z
  .string()
  .trim()
  .min(2, { error: "validation.tooShort" })
  .max(40, { error: "validation.tooLong" })
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, { error: "validation.codeFormat" });

export const emailSchema = z
  .email({ error: "validation.email" })
  .max(320, { error: "validation.tooLong" });

/**
 * Mot de passe.
 *
 * ⚠️ Douze caractères MINIMUM, aucune exigence de composition. Imposer une
 * majuscule et un chiffre produit « Password1! » ; la longueur produit une
 * phrase. C'est la recommandation qui a remplacé les règles de composition
 * partout où elles ont été mesurées.
 */
export const passwordSchema = z
  .string()
  .min(12, { error: "validation.passwordTooShort" })
  .max(200, { error: "validation.tooLong" })
  .refine((value) => !hasControlCharacters(value), { error: "validation.controlCharacters" });

// ─── Dates ───────────────────────────────────────────────────────────────────

/**
 * Bornes de plausibilité d'une date métier.
 *
 * ⚠️ Elles existent pour attraper la faute de frappe, pas pour légiférer. Une
 * échéance en 1926 ou en 2226 est une saisie erronée — dix ans en arrière, vingt
 * en avant couvrent la prescription fiscale la plus longue et tout horizon de
 * génération raisonnable.
 */
export const DATE_MIN_YEAR = new Date().getUTCFullYear() - 10;
export const DATE_MAX_YEAR = new Date().getUTCFullYear() + 20;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date civile `AAAA-MM-JJ`, existence réelle vérifiée. */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE, { error: "validation.dateFormat" })
  .refine(
    (value) => {
      // ⚠️ `new Date("2026-02-31")` ne lève pas : il rend le 3 mars. On compare
      // donc la date reconstruite à la saisie, seule façon de refuser un 31
      // février — que l'utilisateur croirait accepté.
      const parsed = new Date(`${value}T12:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    },
    { error: "validation.dateInvalid" },
  )
  .refine(
    (value) => {
      const year = Number(value.slice(0, 4));
      return year >= DATE_MIN_YEAR && year <= DATE_MAX_YEAR;
    },
    { error: "validation.dateOutOfRange" },
  );

export const optionalIsoDateSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional()
  .pipe(isoDateSchema.optional());

// ─── Nombres ─────────────────────────────────────────────────────────────────

export function positiveIntSchema(max: number) {
  return z.coerce
    .number({ error: "validation.numberExpected" })
    .int({ error: "validation.integerExpected" })
    .min(0, { error: "validation.numberTooSmall" })
    .max(max, { error: "validation.numberTooLarge" });
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Bornes communes à tous les filtres de liste. */
export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
