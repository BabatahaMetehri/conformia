// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * GARDE ANTI-RÉCIDIVE DE LA SUITE D'INTÉGRATION.
 *
 * ⚠️ CE FICHIER N'ÉPROUVE PAS L'APPLICATION : IL ÉPROUVE LA SUITE.
 *
 * Le défaut qu'il empêche est celui qui a rendu impossible d'avoir en même temps
 * une application utilisable et une suite verte : des tests qui affirment sur
 * des comptages GLOBAUX. `select count(*) from obligation_occurrences` ne mesure
 * pas le cloisonnement, il mesure la vacuité de la base. Il passe sur une base
 * vide, il échoue au chargement du référentiel réel, et la seule façon de le
 * rendre vert est alors de retirer le référentiel — c'est-à-dire d'éprouver une
 * situation qui n'existera jamais en production.
 *
 * Ce genre de défaut ne se voit pas à la relecture : le test est court, il est
 * vert, et il a l'air de dire quelque chose. Il ne se voit qu'au moment où
 * quelqu'un charge des données réelles, souvent des mois plus tard. D'où une
 * garde MÉCANIQUE, qui nomme le fichier et la ligne.
 *
 * ⚠️ CE QU'IL FAUT SAVOIR AVANT D'AJOUTER UN FICHIER ICI : la garde n'a de
 * valeur que si elle ne se contourne pas. Il n'existe volontairement AUCUNE
 * liste d'exemption. Un fichier qui ne peut pas satisfaire ces règles est un
 * fichier dont les assertions dépendent de l'état initial de la base — et c'est
 * exactement ce qu'on refuse.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Ce fichier s'exclut : il ne parle à aucune table métier. */
const SELF = "suite-hygiene.test.ts";

/**
 * Tables métier dont un comptage non filtré est une faute.
 *
 * Les tables de RÉFÉRENCE en sont absentes à dessein : `roles`, `permissions`,
 * `domains` et `status_transition_rules` décrivent le modèle, pas des données.
 * Compter les rôles est légitime — c'est même ce que fait la vérification de la
 * matrice — parce que leur nombre est une décision, pas un état.
 */
const BUSINESS_TABLES = [
  "obligation_occurrences",
  "obligation_types",
  "documents",
  "commercial_registers",
  "user_absences",
  "validation_delegations",
  "occurrence_transitions",
  "notifications",
];

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly excerpt: string;
}

function integrationFiles(): string[] {
  return readdirSync(HERE)
    .filter((name) => name.endsWith(".test.ts") && name !== SELF)
    .sort();
}

function read(file: string): string[] {
  return readFileSync(`${HERE}${file}`, "utf8").split(/\r?\n/);
}

/**
 * Le fichier borne-t-il ses données à une entité qui lui est propre ?
 *
 * Deux formes sont acceptées, et une seule idée : tout ce que le fichier
 * fabrique appartient à UNE entité, et rien de ce qu'il affirme ne regarde
 * au-delà.
 *
 *   • `createTestScope()` — la fabrique commune, à préférer pour tout
 *     nouveau fichier ;
 *   • une constante `ENTITY` employée dans son propre jeu d'essai — la forme
 *     des fichiers antérieurs au helper, qui atteint la même isolation.
 */
function declaresScope(lines: string[]): boolean {
  /*
   * ⚠️ LES COMMENTAIRES SONT RETIRÉS AVANT L'EXAMEN, et il a fallu voir la
   * garde se faire berner pour le comprendre. Un fichier dont l'en-tête
   * mentionnait `createTestScope()` — pour dire qu'il s'en servait — la
   * satisfaisait ALORS MÊME que l'appel avait été retiré du code. Une garde
   * qu'un commentaire suffit à contenter ne garde rien.
   */
  const source = lines.filter((line) => !isComment(line)).join("\n");
  if (source.includes("createTestScope(")) return true;
  if (/const ENTITY\s*[:=]/.test(source) && source.includes("entity_id")) return true;

  /*
   * ⚠️ TROISIÈME FORME : L'ISOLATION PAR ÉTAT DE RÉFÉRENCE.
   *
   * Un fichier dont le SUJET est le référentiel partagé ne peut pas le ranger
   * dans une entité à lui : il éprouve précisément ce que la production
   * contient. Il s'isole autrement, et tout aussi rigoureusement — il RELÈVE
   * l'état AVANT d'agir, puis n'affirme que sur l'ÉCART. Le résultat est le
   * même : rien de ce qu'il affirme ne dépend de ce qu'il n'a pas produit.
   *
   * Ce n'est pas une exemption. C'est une technique, reconnue à ce qu'elle
   * FAIT — relever un avant, et s'y comparer — et non à un commentaire magique
   * qu'il suffirait de recopier pour faire taire la garde.
   */
  return source.includes("preexisting") && source.includes("idsOf(");
}

/**
 * Le nom de table apparaît-il en tant que TEL, et non comme préfixe d'un autre ?
 *
 * ⚠️ `documents_search` contient `documents`. Une recherche par sous-chaîne
 * dénonçait donc trois lectures d'une VUE — qui porte son propre cloisonnement
 * et n'a rien à voir avec la table. Le caractère suivant doit être autre chose
 * qu'une lettre, un chiffre ou un souligné.
 */
function mentions(haystack: string, needle: string): boolean {
  let from = haystack.indexOf(needle);
  while (from >= 0) {
    const after = haystack.charAt(from + needle.length);
    if (!/[a-z0-9_]/.test(after)) return true;
    from = haystack.indexOf(needle, from + 1);
  }
  return false;
}

/**
 * Une ligne de commentaire n'exécute rien.
 *
 * ⚠️ Sans ce filtre, la garde accusait les COMMENTAIRES qui expliquent
 * pourquoi tel comptage a été borné — elle dénonçait sa propre documentation,
 * et le seul moyen d'obtenir le silence était de cesser d'expliquer.
 */
function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/**
 * L'assertion attend-elle le VIDE ?
 *
 * ⚠️ UN COMPTAGE GLOBAL ATTENDU À ZÉRO EST PLUS FORT QU'UN COMPTAGE BORNÉ, pas
 * plus faible. « cet administrateur ne voit AUCUN dossier, dans la base
 * entière » ne peut pas devenir faux parce qu'un voisin a créé des données :
 * il ne peut devenir faux que si le cloisonnement cède — ce qui est exactement
 * ce qu'on veut apprendre. L'interdire aurait affaibli la suite au nom de son
 * hygiène.
 */
function expectsNothing(window: string): boolean {
  return (
    window.includes("tobe(0)") ||
    window.includes("toequal([])") ||
    window.includes("tohavelength(0)")
  );
}

/** Un `count(*)` sur une table métier, sans `entity_id` ni identifiant en vue. */
function unscopedCounts(file: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];

  lines.forEach((line, index) => {
    if (isComment(line)) return;
    const lowered = line.toLowerCase();
    if (!lowered.includes("count(")) return;

    const table = BUSINESS_TABLES.find((name) => mentions(lowered, name));
    if (table === undefined) return;

    /*
     * ⚠️ LA FENÊTRE COUVRE LA REQUÊTE, PAS LA LIGNE. Un `where` vit souvent sur
     * la ligne suivante d'un gabarit SQL multiligne ; ne regarder que la ligne
     * du `count(` produirait des accusations fausses, et une garde qui crie à
     * tort finit désactivée.
     */
    const window = lines
      .slice(index, index + 6)
      .join(" ")
      .toLowerCase();

    /*
     * ⚠️ LA RÈGLE EST « AUCUN FILTRE », PAS « UN FILTRE QUI ME PLAÎT ».
     *
     * Une première version exigeait la présence de colonnes nommées —
     * `entity_id`, `occurrence_id`… Elle dénonçait un assistant dont la clause
     * `where` est fournie par l'appelant, et donc juste. Une garde qui accuse
     * du code correct enseigne à l'ignorer ; on ne retient donc que ce qui est
     * indiscutable : compter une table métier ENTIÈRE, sans la moindre clause
     * restrictive.
     */
    const scoped = expectsNothing(window) || window.includes("where");

    if (!scoped) {
      findings.push({
        file,
        line: index + 1,
        rule: `comptage non borné sur ${table}`,
        excerpt: line.trim().slice(0, 110),
      });
    }
  });

  return findings;
}

/** Une lecture de table métier sans le moindre filtre. */
function unfilteredSelects(file: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];

  lines.forEach((line, index) => {
    const lowered = line.toLowerCase();
    if (!/\bfrom\s+public\.\w+/.test(lowered)) return;

    const table = BUSINESS_TABLES.find((name) => mentions(lowered, `public.${name}`));
    if (table === undefined) return;

    const window = lines
      .slice(index, index + 6)
      .join(" ")
      .toLowerCase();

    // Une jointure est bornée par sa condition ; un `where`, un `using` ou une
    // insertion le sont aussi. Reste la lecture nue, qui ramène la base.
    const bounded =
      expectsNothing(window) ||
      window.includes("where") ||
      window.includes("join") ||
      window.includes("using") ||
      window.includes("insert into") ||
      window.includes("delete from") ||
      window.includes("update ");

    if (!bounded) {
      findings.push({
        file,
        line: index + 1,
        rule: `lecture non filtrée de ${table}`,
        excerpt: line.trim().slice(0, 110),
      });
    }
  });

  return findings;
}

function report(findings: readonly Finding[]): string {
  return findings
    .map((f) => `  ${f.file}:${String(f.line)} — ${f.rule}\n      ${f.excerpt}`)
    .join("\n");
}

// ═════════════════════════════════════════════════════════════════════════════

describe("hygiène de la suite d'intégration", () => {
  it("chaque fichier borne ses données à une entité qui lui est propre", () => {
    const coupables = integrationFiles().filter((file) => !declaresScope(read(file)));

    expect(
      coupables,
      `Ces fichiers ne bornent leurs données à aucune entité. Sans cela, leurs\n` +
        `assertions dépendent de ce que d'autres ont laissé en base :\n` +
        coupables.map((file) => `  ${file}`).join("\n") +
        `\n\nEmployer createTestScope() — voir tests/helpers/test-scope.ts.`,
    ).toEqual([]);
  });

  it("aucun comptage ne porte sur une table métier entière", () => {
    const findings = integrationFiles().flatMap((file) => unscopedCounts(file, read(file)));

    expect(
      findings,
      `Comptages non bornés — ils mesurent l'état de la base, pas le\n` +
        `comportement éprouvé :\n${report(findings)}`,
    ).toEqual([]);
  });

  it("aucune lecture de table métier ne se fait sans filtre", () => {
    const findings = integrationFiles().flatMap((file) => unfilteredSelects(file, read(file)));

    expect(
      findings,
      `Lectures non filtrées — elles ramènent ce que d'autres ont créé :\n${report(findings)}`,
    ).toEqual([]);
  });

  it("se détecte elle-même : une entorse fabriquée est bien vue", () => {
    /*
     * ⚠️ UNE GARDE QU'ON N'A PAS VUE ÉCHOUER N'EST PAS UNE GARDE. Une expression
     * rationnelle trop stricte, un chemin qui ne trouve aucun fichier, et le
     * test devient un vert permanent qui ne garde rien. On lui soumet donc une
     * entorse fabriquée, et on vérifie qu'elle la nomme.
     */
    const faute = [
      "const total = await countRows(",
      "  'select count(*) from obligation_occurrences',",
      ");",
    ];

    const findings = unscopedCounts("fichier-imaginaire.test.ts", faute);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toContain("obligation_occurrences");
    expect(findings[0]?.line).toBe(2);

    // Et la même chose, correctement bornée, ne déclenche rien.
    const correct = [
      "const total = await countRows(",
      "  'select count(*) from obligation_occurrences where entity_id = $1',",
      ");",
    ];
    expect(unscopedCounts("fichier-imaginaire.test.ts", correct)).toEqual([]);
  });
});
