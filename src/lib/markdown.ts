/**
 * Analyseur Markdown minimal, réduit à ce qu'une procédure administrative
 * emploie : titres, listes, gras, italique, code, liens, citations, séparateurs.
 *
 * ⚠️ POURQUOI PAS UNE BIBLIOTHÈQUE. CLAUDE.md §7 interdit d'ajouter une
 * dépendance hors de la pile du §2 sans validation. Mais l'argument décisif est
 * ailleurs : ce module rend une STRUCTURE, jamais une chaîne HTML. Le composant
 * de rendu construit des éléments React à partir de ces nœuds, sans jamais
 * toucher à `dangerouslySetInnerHTML`. La classe entière des injections par
 * balise disparaît — il n'y a aucun endroit où du HTML puisse être interprété.
 *
 * Le sous-ensemble est assumé : pas de tableaux, pas de HTML en ligne, pas
 * d'images. Une procédure de dépôt n'en a pas besoin, et chaque construction
 * supportée est une surface à vérifier.
 *
 * Module PUR : aucune dépendance, aucun React. Testable tel quel.
 */

// ─── Nœuds en ligne ──────────────────────────────────────────────────────────

export type InlineNode =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "strong"; readonly children: readonly InlineNode[] }
  | { readonly type: "emphasis"; readonly children: readonly InlineNode[] }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "link"; readonly href: string; readonly label: string };

// ─── Nœuds de bloc ───────────────────────────────────────────────────────────

export type BlockNode =
  | {
      readonly type: "heading";
      readonly level: 1 | 2 | 3;
      readonly children: readonly InlineNode[];
    }
  | { readonly type: "paragraph"; readonly children: readonly InlineNode[] }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly InlineNode[])[];
    }
  | { readonly type: "quote"; readonly children: readonly InlineNode[] }
  | { readonly type: "codeBlock"; readonly value: string }
  | { readonly type: "rule" };

/**
 * Schémas d'URL autorisés dans un lien.
 *
 * Liste BLANCHE, jamais noire : `javascript:` est le cas connu, mais `data:` et
 * `vbscript:` le sont tout autant, et la prochaine ne figurerait dans aucune
 * liste noire écrite aujourd'hui. Un lien dont le schéma n'est pas reconnu est
 * rendu en texte, pas en lien.
 */
const ALLOWED_SCHEMES = ["http:", "https:", "mailto:"] as const;

export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  // Un chemin relatif ne porte aucun schéma : il est sûr par construction.
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;

  try {
    const url = new URL(trimmed);
    return ALLOWED_SCHEMES.some((scheme) => scheme === url.protocol);
  } catch {
    return false;
  }
}

// ─── Analyse en ligne ────────────────────────────────────────────────────────

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]*\]\([^)\s]+\))/;

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (match === null) {
      nodes.push({ type: "text", value: rest });
      break;
    }

    if (match.index > 0) {
      nodes.push({ type: "text", value: rest.slice(0, match.index) });
    }

    const token = match[0];
    nodes.push(toInlineNode(token));
    rest = rest.slice(match.index + token.length);
  }

  return nodes.filter((node) => node.type !== "text" || node.value.length > 0);
}

function toInlineNode(token: string): InlineNode {
  if (token.startsWith("`")) {
    return { type: "code", value: token.slice(1, -1) };
  }
  if (token.startsWith("**") || token.startsWith("__")) {
    return { type: "strong", children: parseInline(token.slice(2, -2)) };
  }
  if (token.startsWith("[")) {
    const separator = token.indexOf("](");
    const label = token.slice(1, separator);
    const href = token.slice(separator + 2, -1);
    // Un schéma non reconnu retombe en TEXTE : le lien disparaît, le libellé reste.
    return isSafeHref(href)
      ? { type: "link", href, label: label.length > 0 ? label : href }
      : { type: "text", value: label.length > 0 ? label : href };
  }
  return { type: "emphasis", children: parseInline(token.slice(1, -1)) };
}

// ─── Analyse en blocs ────────────────────────────────────────────────────────

/**
 * Jusqu'à six dièses, ramenés à trois au rendu.
 *
 * Borner la CAPTURE à trois laisserait « #### Titre » retomber en paragraphe, et
 * l'écran afficherait les dièses tels quels. Un niveau trop profond est une
 * maladresse de rédaction, pas une raison de montrer la syntaxe brute.
 */
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM = /^[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|_{3,}|\*{3,})$/;

/** Longueur au-delà de laquelle on cesse d'analyser : garde-fou de rendu. */
const MAX_SOURCE_LENGTH = 20_000;

export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.slice(0, MAX_SOURCE_LENGTH).replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockNode[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const collected: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        collected.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // referme la clôture
      blocks.push({ type: "codeBlock", value: collected.join("\n") });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading !== null) {
      const level = Math.min((heading[1] ?? "#").length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline(heading[2] ?? "") });
      index += 1;
      continue;
    }

    const quote = QUOTE.exec(trimmed);
    if (quote !== null) {
      const collected: string[] = [quote[1] ?? ""];
      index += 1;
      let next = QUOTE.exec((lines[index] ?? "").trim());
      while (index < lines.length && next !== null) {
        collected.push(next[1] ?? "");
        index += 1;
        next = QUOTE.exec((lines[index] ?? "").trim());
      }
      blocks.push({ type: "quote", children: parseInline(collected.join(" ")) });
      continue;
    }

    const listBlock = readList(lines, index);
    if (listBlock !== null) {
      blocks.push(listBlock.block);
      index = listBlock.nextIndex;
      continue;
    }

    // Paragraphe : les lignes consécutives se replient en un seul bloc.
    const paragraph: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const candidate = (lines[index] ?? "").trim();
      if (candidate.length === 0 || startsNewBlock(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

function startsNewBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    UNORDERED_ITEM.test(line) ||
    ORDERED_ITEM.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    line.startsWith("```")
  );
}

function readList(
  lines: readonly string[],
  start: number,
): { readonly block: BlockNode; readonly nextIndex: number } | null {
  const first = (lines[start] ?? "").trim();
  const ordered = ORDERED_ITEM.test(first);
  const pattern = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
  if (!pattern.test(first)) return null;

  const items: InlineNode[][] = [];
  let index = start;

  while (index < lines.length) {
    const match = pattern.exec((lines[index] ?? "").trim());
    if (match === null) break;
    items.push(parseInline(match[1] ?? ""));
    index += 1;
  }

  return { block: { type: "list", ordered, items }, nextIndex: index };
}

/** Résumé en texte brut — utile pour un extrait de liste ou une infobulle. */
export function markdownToPlainText(source: string, maxLength = 200): string {
  const text = parseMarkdown(source)
    .map((block) => (block.type === "codeBlock" ? block.value : inlineText(block)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function inlineText(block: BlockNode): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return block.children.map(flatten).join("");
    case "list":
      return block.items.map((item) => item.map(flatten).join("")).join(" ");
    case "codeBlock":
      return block.value;
    case "rule":
      return "";
  }
}

function flatten(node: InlineNode): string {
  switch (node.type) {
    case "text":
    case "code":
      return node.value;
    case "link":
      return node.label;
    case "strong":
    case "emphasis":
      return node.children.map(flatten).join("");
  }
}
