import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import ar from "@/i18n/messages/ar.json";
import fr from "@/i18n/messages/fr.json";

/**
 * Cohérence des catalogues de traduction.
 *
 * ⚠️ Ce fichier existe parce que la même classe de défaut est apparue DEUX fois :
 * une clé qui pointe vers un GROUPE au lieu d'un message, et une clé absente.
 * Aucun des deux ne casse la compilation ni le build — next-intl journalise
 * l'erreur côté serveur et affiche la clé brute à l'écran. Sans contrôle
 * mécanique, cela ne se voit qu'en ouvrant la page.
 */

type Catalogue = Record<string, unknown>;
type Resolution = "message" | "groupe" | "absent";

function resolve(catalogue: Catalogue, path: string): Resolution {
  let node: unknown = catalogue;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return "absent";
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "object" && node !== null ? "groupe" : "message";
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** `namespace` : l'espace déclaré. `key` : clé littérale. `prefix` : clé construite. */
type UsageKind = "namespace" | "key" | "prefix";

interface Usage {
  readonly file: string;
  readonly path: string;
  readonly kind: UsageKind;
}

interface Declaration {
  readonly variable: string;
  readonly namespace: string;
  readonly at: number;
}

/**
 * Relève les appels de traduction, fichier par fichier.
 *
 * ⚠️ Chaque déclaration ne capte que les appels situés AVANT la déclaration
 * suivante de la MÊME variable. Sans cette portée, un fichier qui déclare trois
 * fois `const t = useTranslations(...)` — un par composant — attribuerait chaque
 * appel aux trois espaces de noms à la fois, et le contrôle ne signalerait plus
 * que du bruit.
 */
function collectUsages(): Usage[] {
  const usages: Usage[] = [];

  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");

    const declarations: Declaration[] = [];
    const declarationPattern =
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g;

    for (const match of source.matchAll(declarationPattern)) {
      const variable = match[1];
      const namespace = match[2];
      if (variable === undefined || namespace === undefined) continue;
      declarations.push({ variable, namespace, at: match.index });
    }

    for (const [index, declaration] of declarations.entries()) {
      usages.push({ file, path: declaration.namespace, kind: "namespace" });

      const nextSameVariable = declarations
        .slice(index + 1)
        .find((candidate) => candidate.variable === declaration.variable);
      const scope = source.slice(declaration.at, nextSameVariable?.at ?? source.length);

      const literal = new RegExp(
        String.raw`\b` + declaration.variable + String.raw`\(\s*"([^"]+)"`,
        "g",
      );
      for (const call of scope.matchAll(literal)) {
        usages.push({ file, path: `${declaration.namespace}.${call[1] ?? ""}`, kind: "key" });
      }

      // Clé construite : `t(`groupe.${valeur}`)`. Seul le préfixe est vérifiable.
      const dynamic = new RegExp(
        String.raw`\b` + declaration.variable + String.raw`\(\s*\x60([^\x60$]*)\$\{`,
        "g",
      );
      for (const call of scope.matchAll(dynamic)) {
        const prefix = (call[1] ?? "").replace(/\.$/, "");
        if (prefix.length > 0) {
          usages.push({ file, path: `${declaration.namespace}.${prefix}`, kind: "prefix" });
        }
      }
    }
  }

  return usages;
}

const usages = collectUsages();
const report = (list: readonly Usage[]): string[] =>
  list.map((usage) => `${usage.path} (${usage.file})`);

describe("catalogues de traduction", () => {
  it("relève effectivement des usages — sinon le test ne prouve rien", () => {
    expect(usages.filter((usage) => usage.kind === "key").length).toBeGreaterThan(100);
    expect(usages.filter((usage) => usage.kind === "prefix").length).toBeGreaterThan(5);
  });

  it("chaque espace de noms et chaque clé existe en français", () => {
    const missing = usages.filter((usage) => resolve(fr as Catalogue, usage.path) === "absent");
    expect(report(missing)).toEqual([]);
  });

  it("aucune clé littérale ne pointe vers un GROUPE", () => {
    /*
     * next-intl répond INSUFFICIENT_PATH quand `t()` résout vers un objet. Le
     * cas typique : un intitulé de colonne et un dictionnaire d'énumération qui
     * se disputent la même clé.
     */
    const groups = usages
      .filter((usage) => usage.kind === "key")
      .filter((usage) => resolve(fr as Catalogue, usage.path) === "groupe");

    expect(report(groups)).toEqual([]);
  });

  it("chaque espace de noms désigne un groupe, jamais un message", () => {
    const wrong = usages
      .filter((usage) => usage.kind === "namespace")
      .filter((usage) => resolve(fr as Catalogue, usage.path) !== "groupe");

    expect(report(wrong)).toEqual([]);
  });

  it("chaque préfixe de clé construite désigne bien un groupe", () => {
    const wrong = usages
      .filter((usage) => usage.kind === "prefix")
      .filter((usage) => resolve(fr as Catalogue, usage.path) !== "groupe");

    expect(report(wrong)).toEqual([]);
  });

  it("les deux catalogues portent exactement les mêmes clés", () => {
    const paths = (node: unknown, prefix = ""): string[] =>
      typeof node === "object" && node !== null
        ? Object.entries(node).flatMap(([key, value]) => paths(value, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];

    const french = new Set(paths(fr));
    const arabic = new Set(paths(ar));

    // Une clé ajoutée d'un seul côté afficherait la clé brute dans l'autre langue.
    expect([...french].filter((key) => !arabic.has(key))).toEqual([]);
    expect([...arabic].filter((key) => !french.has(key))).toEqual([]);
  });
});
