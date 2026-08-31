import { describe, expect, it } from "vitest";

import { isSafeHref, markdownToPlainText, parseInline, parseMarkdown } from "@/lib/markdown";

describe("parseMarkdown", () => {
  it("reconnaît les titres jusqu'au niveau 3", () => {
    const blocks = parseMarkdown("# Un\n## Deux\n### Trois\n#### Quatre");
    expect(blocks.map((block) => (block.type === "heading" ? block.level : null))).toEqual([
      1, 2, 3, 3,
    ]);
  });

  it("replie les lignes consécutives en un seul paragraphe", () => {
    const blocks = parseMarkdown("Première ligne\nseconde ligne\n\nAutre paragraphe");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe("paragraph");
  });

  it("distingue liste à puces et liste numérotée", () => {
    const blocks = parseMarkdown("- a\n- b\n\n1. x\n2. y");
    expect(blocks.map((block) => (block.type === "list" ? block.ordered : null))).toEqual([
      false,
      true,
    ]);
  });

  it("regroupe une citation sur plusieurs lignes", () => {
    const blocks = parseMarkdown("> une\n> deux");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("quote");
  });

  it("conserve un bloc de code sans l'interpréter", () => {
    const blocks = parseMarkdown("```\n**pas gras**\n```");
    expect(blocks[0]).toEqual({ type: "codeBlock", value: "**pas gras**" });
  });

  it("reconnaît un séparateur", () => {
    expect(parseMarkdown("---")[0]?.type).toBe("rule");
  });

  it("ne boucle pas sur une entrée dégénérée", () => {
    // Une analyse mal bornée ne rendrait jamais la main sur ces entrées.
    for (const source of ["", "\n\n\n", "#", "- ", "```", ">", "****", "[]()"]) {
      expect(() => parseMarkdown(source)).not.toThrow();
    }
  });

  it("borne l'entrée analysée", () => {
    const blocks = parseMarkdown("a ".repeat(40_000));
    expect(blocks.length).toBeGreaterThan(0);
  });
});

describe("parseInline", () => {
  it("reconnaît gras, italique et code", () => {
    expect(parseInline("**g** *i* `c`").map((node) => node.type)).toEqual([
      "strong",
      "text",
      "emphasis",
      "text",
      "code",
    ]);
  });

  it("garde le texte autour des marques", () => {
    const nodes = parseInline("avant **milieu** après");
    expect(nodes[0]).toEqual({ type: "text", value: "avant " });
    expect(nodes[2]).toEqual({ type: "text", value: " après" });
  });

  it("produit un lien pour http, https et mailto", () => {
    for (const href of ["https://impots.dz", "http://x.dz", "mailto:a@b.dz"]) {
      const nodes = parseInline(`[libellé](${href})`);
      expect(nodes[0]?.type).toBe("link");
    }
  });
});

describe("sûreté des liens", () => {
  it("refuse les schémas exécutables", () => {
    // Liste BLANCHE : ces schémas ne sont pas refusés un par un, ils ne sont
    // simplement pas autorisés.
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      expect(isSafeHref(href)).toBe(false);
    }
  });

  it("dégrade un lien dangereux en texte, sans perdre le libellé", () => {
    const nodes = parseInline("[cliquez ici](javascript:alert(1))");
    expect(nodes[0]).toEqual({ type: "text", value: "cliquez ici" });
    expect(nodes.some((node) => node.type === "link")).toBe(false);
  });

  it("accepte un chemin relatif", () => {
    expect(isSafeHref("/referentiel")).toBe(true);
    expect(isSafeHref("#section")).toBe(true);
  });

  it("ne laisse passer aucune balise : le rendu ne produit pas de HTML", () => {
    // La structure ne contient que du texte. Le composant construit des éléments
    // React à partir d'elle — il n'existe aucun point où du HTML serait interprété.
    const blocks = parseMarkdown('<script>alert(1)</script>\n<img onerror="x">');
    const serialised = JSON.stringify(blocks);

    expect(serialised).toContain("script");
    // …mais uniquement comme VALEUR textuelle, jamais comme nœud de balise.
    expect(blocks.every((block) => block.type === "paragraph")).toBe(true);
  });
});

describe("markdownToPlainText", () => {
  it("retire les marques et replie les espaces", () => {
    expect(markdownToPlainText("# Titre\n\nUn **mot** et `du code`.")).toBe(
      "Titre Un mot et du code.",
    );
  });

  it("tronque au-delà de la longueur demandée", () => {
    const text = markdownToPlainText("mot ".repeat(200), 20);
    expect(text).toHaveLength(20);
    expect(text.endsWith("…")).toBe(true);
  });
});
