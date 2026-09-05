// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ⚠️ AUCUNE CLASSE TAILWIND PHYSIQUE.
 *
 * `ml-`, `pr-`, `left-`, `text-right` figent une direction. L'application est
 * bâtie pour basculer en arabe — `dir="rtl"` est posé par le layout, les
 * catalogues sont tenus clé pour clé — et le jour où la locale s'ouvrira, une
 * seule marge physique suffira à décaler un bouton du mauvais côté.
 *
 * Les équivalents LOGIQUES (`ms-`, `pe-`, `start-`, `text-start`) se retournent
 * seuls. Le coût est nul à l'écriture ; la dette, elle, est invisible jusqu'au
 * jour où elle coûte une relecture complète de l'interface.
 *
 * ⚠️ Ce test échouerait pour rien s'il ne visait que des sous-chaînes :
 * « normal- », « small- » ou une classe métier contenant « pr- » déclencheraient
 * de faux positifs. Il vise donc la classe ENTIÈRE, à ses frontières.
 */

/** Classe physique → son équivalent logique, pour que le message soit actionnable. */
const PHYSICAL: Readonly<Record<string, string>> = {
  ml: "ms",
  mr: "me",
  pl: "ps",
  pr: "pe",
  left: "start",
  right: "end",
  "border-l": "border-s",
  "border-r": "border-e",
  "rounded-l": "rounded-s",
  "rounded-r": "rounded-e",
  "text-left": "text-start",
  "text-right": "text-end",
};

/**
 * Fichiers dispensés, avec leur raison.
 *
 * ⚠️ Une dispense n'est pas un oubli toléré : c'est un endroit où la direction
 * physique est le SUJET, pas un accident.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "src/services/export/pdf/theme.ts":
    "Feuille de style PDF : react-pdf ne connaît pas les propriétés logiques CSS.",
  "src/emails/layout.tsx":
    "Styles en ligne pour clients de messagerie, qui ignorent les propriétés logiques.",
};

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (path.endsWith(".tsx") || path.endsWith(".ts") || path.endsWith(".css")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Construit l'expression qui reconnaît une classe physique entière.
 *
 * Frontières : début de chaîne, espace, apostrophe, guillemet, accent grave ou
 * accolade — c'est-à-dire tout ce qui sépare deux classes dans un attribut ou
 * un appel à `cn(...)`. Les variantes (`sm:`, `hover:`, `rtl:`) sont admises en
 * préfixe, et la classe est suivie d'un tiret ou d'une frontière.
 */
function patternFor(physical: string): RegExp {
  const boundary = "(?:^|[\\s\"'`{(])";
  const variants = "(?:[a-z-]+:)*";
  const suffix = physical.includes("-") ? "(?![a-z-])" : "(?:-[a-zA-Z0-9./[\\]-]+)";
  return new RegExp(`${boundary}-?${variants}${physical}${suffix}`);
}

const FILES = walk("src").filter((path) => {
  const normalised = path.replaceAll("\\", "/");
  return EXEMPT[normalised] === undefined;
});

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly physical: string;
  readonly logical: string;
}

function violationsOf(file: string): Violation[] {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const found: Violation[] = [];

  lines.forEach((text, index) => {
    // Les commentaires ne produisent aucune classe : les inclure ferait échouer
    // le test sur sa propre documentation.
    const trimmed = text.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;

    for (const [physical, logical] of Object.entries(PHYSICAL)) {
      if (patternFor(physical).test(text)) {
        found.push({ file, line: index + 1, text: trimmed.slice(0, 100), physical, logical });
      }
    }
  });

  return found;
}

// ═════════════════════════════════════════════════════════════════════════════

describe("propriétés logiques", () => {
  it("balaie bien des fichiers", () => {
    // Un balayage vide passerait au vert sans rien vérifier.
    expect(FILES.length).toBeGreaterThan(100);
  });

  /*
   * ⚠️ BUDGET DE TEMPS EXPLICITE. Ce test LIT ET ANALYSE tout `src/` — plus de
   * trois cents fichiers, ligne par ligne, contre une douzaine d'expressions
   * rationnelles. Il tient en une seconde sur une machine au repos, et dépassait
   * les cinq secondes par défaut de Vitest sur une machine chargée : la suite
   * devenait rouge par intermittence, pour une raison qui n'a rien à voir avec ce
   * qu'elle éprouve.
   *
   * Trente secondes ne relâchent aucune garantie — le test vérifie un RÉSULTAT,
   * pas une durée — et évitent qu'on finisse par ignorer ses échecs.
   */
  it("AUCUNE classe Tailwind physique dans les sources", { timeout: 30_000 }, () => {
    const violations = FILES.flatMap(violationsOf);

    const report = violations
      .map(
        (violation) =>
          `${violation.file}:${String(violation.line)} — « ${violation.physical} » → employer « ${violation.logical} »\n    ${violation.text}`,
      )
      .join("\n");

    expect(violations, `Classes physiques détectées :\n${report}`).toEqual([]);
  });

  it("chaque dispense porte une raison", () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, file).toBeGreaterThan(30);
    }
  });

  it("reconnaît une classe physique, et seulement elle", () => {
    /*
     * ⚠️ Le test du test. Une expression trop large ferait échouer la suite sur
     * « normal-case » ou « prose-lg », et la première réaction serait de la
     * désactiver — ce qui coûterait la garantie entière.
     */
    expect(patternFor("ml").test('className="ml-4"')).toBe(true);
    expect(patternFor("pr").test('className="pr-2"')).toBe(true);
    expect(patternFor("left").test('className="left-0"')).toBe(true);
    expect(patternFor("text-left").test('className="text-left"')).toBe(true);
    expect(patternFor("ml").test('className="sm:ml-4"')).toBe(true);
    expect(patternFor("mr").test('className="-mr-1"')).toBe(true);

    // Faux positifs qu'il ne faut PAS produire.
    expect(patternFor("pr").test('className="prose"')).toBe(false);
    expect(patternFor("ml").test('className="normal-case"')).toBe(false);
    expect(patternFor("left").test('className="text-left-ish"')).toBe(false);
    expect(patternFor("mr").test("const timer = 5;")).toBe(false);
    expect(patternFor("text-right").test('className="text-rights"')).toBe(false);
  });
});
