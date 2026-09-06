// @vitest-environment node

/**
 * LE GABARIT D'IMPORT, ÉPROUVÉ CONTRE L'ANALYSEUR QUI LE LIRA.
 *
 * ⚠️ CE FICHIER LIT LE VRAI GABARIT, pas une copie. `docs/templates/jours-feries.csv`
 * est ce qu'un administrateur ouvrira pour saisir le calendrier ; s'il ne se
 * comporte pas comme annoncé, la documentation ment à l'endroit exact où le
 * silence coûte le plus cher.
 *
 * La propriété tenue ici est un SENS D'ERREUR : les fêtes religieuses n'ont pas
 * de date dans le gabarit — elles portent `AAAA-MM-JJ` — et cette absence doit
 * être REFUSÉE bruyamment, jamais avalée. Une ligne rejetée se voit ; une date
 * inventée non.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseHolidayCsv } from "@/services/admin/holidays";

const TEMPLATE = readFileSync("docs/templates/jours-feries.csv", "utf8");

describe("analyse du CSV de jours fériés", () => {
  it("tolère l'en-tête, et ne le prend pas pour une date", () => {
    const { rows, rejected } = parseHolidayCsv("date,libelle,recurrent\n2026-05-01,Fête,true");
    expect(rows).toEqual([{ date: "2026-05-01", label: "Fête", isRecurring: true }]);
    expect(rejected).toEqual([]);
  });

  it("accepte `true`, `1` et `oui` pour la récurrence", () => {
    const { rows } = parseHolidayCsv(
      ["2026-01-01,A,true", "2026-01-02,B,1", "2026-01-03,C,oui", "2026-01-04,D,false"].join("\n"),
    );
    expect(rows.map((row) => row.isRecurring)).toEqual([true, true, true, false]);
  });

  it("⚠️ une date illisible est REJETÉE, jamais devinée", () => {
    /*
     * Le sens d'erreur est le sujet. Interpréter « 15/04/2027 » comme un
     * 15 avril serait commode et faux une fois sur deux ; l'ignorer en silence
     * serait pire encore. La ligne est rejetée, et son NUMÉRO est rendu pour
     * qu'on puisse la retrouver dans le fichier.
     */
    const { rows, rejected } = parseHolidayCsv(
      ["2026-01-01,Bonne,true", "15/04/2027,Mauvaise,false", "2027-3-1,Mauvaise aussi,false"].join(
        "\n",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rejected).toEqual([2, 3]);
  });

  it("une ligne sans libellé est rejetée : une date sans nom n'apprend rien", () => {
    const { rows, rejected } = parseHolidayCsv("2026-01-01,,true");
    expect(rows).toEqual([]);
    expect(rejected).toEqual([1]);
  });
});

describe("le gabarit livré", () => {
  it("porte les cinq fêtes civiles, toutes récurrentes", () => {
    const { rows } = parseHolidayCsv(TEMPLATE);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.isRecurring)).toBe(true);
    // Elles reviennent au même jour du même mois : c'est ce qui les rend
    // saisissables une fois pour toutes.
    expect(rows.map((row) => row.date.slice(5))).toEqual([
      "01-01",
      "01-12",
      "05-01",
      "07-05",
      "11-01",
    ]);
  });

  it("⚠️ AUCUNE fête religieuse n'y porte de date — et le gabarit REFUSE de les importer", () => {
    /*
     * Le cœur du garde-fou documentaire. Les lignes religieuses portent
     * `AAAA-MM-JJ` : elles doivent toutes tomber dans les rejets. Si l'une
     * d'elles passait, c'est qu'une date aurait été inventée quelque part — par
     * un « exemple » ajouté au gabarit, ou par un analyseur devenu tolérant.
     *
     * Les fêtes hégiriennes sont fixées par décret. Aucune formule ne les
     * calcule, et une date fausse ne produit aucune erreur visible : seulement
     * une échéance qui a l'air juste.
     */
    const { rows, rejected } = parseHolidayCsv(TEMPLATE);

    // Le gabarit nomme les cinq fêtes religieuses, sur deux années.
    for (const fete of ["Aïd el-Fitr", "Aïd el-Adha", "Awal Moharem", "Achoura", "Mawlid"]) {
      expect(TEMPLATE, `le gabarit doit nommer ${fete}`).toContain(fete);
    }

    // Et aucune n'est importable en l'état.
    expect(rejected.length).toBeGreaterThan(0);
    expect(rows.some((row) => /Aïd|Moharem|Achoura|Mawlid/.test(row.label))).toBe(false);

    // Toute ligne non civile est rejetée : le compte doit tomber juste.
    const lignes = TEMPLATE.trim().split("\n").length;
    expect(rows.length + rejected.length).toBe(lignes - 1); // − l'en-tête
  });

  it("marque les religieuses NON récurrentes, pour qu'elles ne couvrent pas une année de trop", () => {
    /*
     * Une fête religieuse marquée récurrente serait projetée sur toutes les
     * années à la même date grégorienne — faux par construction — et, pire,
     * ferait croire au contrôle de couverture que l'année est saisie. L'alerte
     * qui existe pour signaler l'oubli s'éteindrait sur un oubli.
     */
    for (const ligne of TEMPLATE.trim().split("\n").slice(1)) {
      if (!/Aïd|Moharem|Achoura|Mawlid/.test(ligne)) continue;
      expect(ligne, `${ligne} doit être non récurrente`).toMatch(/,false\s*$/);
    }
  });
});
