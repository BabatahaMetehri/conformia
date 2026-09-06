// @vitest-environment node

/**
 * LA COUVERTURE DU CALENDRIER, ET L'ALERTE QUI ROMPT LE SILENCE.
 *
 * ⚠️ CE FICHIER ÉPROUVE LA CORRECTION D'UN DÉFAUT QUI NE SE VOYAIT PAS.
 *
 * Le calendrier ne portait que 2026, et `is_recurring` n'avait aucun effet :
 * toute échéance calculée en 2027 ignorait les jours chômés. Rien ne le
 * signalait — ni erreur, ni message, ni test rouge. La correction tient en deux
 * pièces, et celle-ci est la seconde : MESURER la couverture, et ALERTER tant
 * qu'une année de l'horizon n'a reçu aucune fête religieuse.
 *
 * Prérequis : `supabase start`. Lancement : `npm run test:rls`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { generateAllActive } from "@/services/scheduling/generator";
import type { Database } from "@/types/database.types";

import { createTestScope, destroyTestScope, type TestScope } from "../helpers/test-scope";

let scope: TestScope;
let adminId = "";

/** Client de service : le générateur travaille hors session utilisateur. */
const generationClient: SupabaseClient<Database> = createClient<Database>(
  process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321",
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

/** Année courante à Alger — le fuseau de la base, pas celui de la machine. */
const CURRENT_YEAR = new Date(
  new Date().toLocaleString("en-US", { timeZone: "Africa/Algiers" }),
).getFullYear();

/** Année suivante : celle que l'alerte surveille, et la seule qui compte ici. */
const NEXT_YEAR = CURRENT_YEAR + 1;

interface CoverageRow {
  readonly year: number;
  readonly civil_count: number;
  readonly religious_count: number;
  readonly is_complete: boolean;
}

async function coverage(): Promise<readonly CoverageRow[]> {
  const { rows } = await scope.pool.query<CoverageRow>(
    "select year, civil_count, religious_count, is_complete from public.holiday_calendar_coverage order by year",
  );
  return rows;
}

/** Codes d'alerte du tableau de bord, SOUS L'IDENTITÉ de l'appelant. */
async function alertesDe(userId: string): Promise<string[]> {
  return scope.asUser(userId, async (client) => {
    const { rows } = await client.query<{ code: string }>(
      "select code from public.dashboard_alerts()",
    );
    return rows.map((row) => row.code);
  });
}

/**
 * Pose une fête religieuse pour une année.
 *
 * ⚠️ `is_recurring = false`, toujours. Une fête religieuse ne revient jamais à la
 * même date grégorienne : la marquer récurrente la projetterait sur toutes les
 * années et rendrait la mesure de couverture menteuse.
 */
async function poserFeteReligieuse(year: number): Promise<void> {
  await scope.pool.query(
    `insert into public.holidays (holiday_date, label, is_recurring, source)
     values (make_date($1, 3, 20), 'Fête de test', false, 'TEST-COVERAGE')
     on conflict do nothing`,
    [year],
  );
}

async function retirerFetesDeTest(): Promise<void> {
  await scope.pool.query("delete from public.holidays where source = 'TEST-COVERAGE'");
}

beforeAll(async () => {
  scope = await createTestScope();
  // `referential.manage` : l'alerte ne s'adresse qu'à qui peut y remédier.
  adminId = await scope.createUserWithRole("ADMIN");
  await retirerFetesDeTest();
}, 120_000);

afterAll(async () => {
  await retirerFetesDeTest();
  await destroyTestScope(scope);
}, 60_000);

describe("vue holiday_calendar_coverage", () => {
  it("couvre l'année courante et les deux suivantes", async () => {
    /*
     * ⚠️ L'ANNÉE SUIVANTE EST L'ENJEU. L'horizon de génération est de douze
     * mois, et une période de décembre échoit en janvier : le calendrier
     * consulté est celui de l'année d'APRÈS. Une vue qui s'arrêterait à l'année
     * courante mesurerait tout sauf ce qui manque.
     */
    const rows = await coverage();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.year)).toContain(NEXT_YEAR);
  });

  it("les RÉCURRENTES comptent pour toutes les années", async () => {
    // Les cinq fêtes civiles sont saisies une fois, récurrentes. Elles valent
    // pour chaque année de l'horizon — c'est précisément ce que la correction
    // rend vrai.
    const rows = await coverage();
    expect(rows.every((row) => row.civil_count >= 5)).toBe(true);
  });

  it("les récurrentes ne rendent JAMAIS une année complète", async () => {
    /*
     * ⚠️ LE CŒUR DE LA MESURE. Compter les récurrentes dans la complétude
     * déclarerait chaque année couverte, y compris celles où aucune fête
     * religieuse n'a été saisie — c'est-à-dire reproduirait exactement le
     * silence que cette vue existe pour rompre.
     */
    await retirerFetesDeTest();
    const rows = await coverage();
    const suivante = rows.find((row) => row.year === NEXT_YEAR);

    expect(suivante?.civil_count).toBeGreaterThan(0);
    expect(suivante?.religious_count).toBe(0);
    expect(suivante?.is_complete).toBe(false);
  });

  it("une fête EXACTE rend son année complète, et elle seule", async () => {
    await poserFeteReligieuse(NEXT_YEAR);

    const rows = await coverage();
    expect(rows.find((row) => row.year === NEXT_YEAR)?.is_complete).toBe(true);
    // L'année d'après n'en profite pas : une fête religieuse n'est pas récurrente.
    expect(rows.find((row) => row.year === NEXT_YEAR + 1)?.is_complete).toBe(false);

    await retirerFetesDeTest();
  });
});

describe("alerte de tableau de bord", () => {
  it("⚠️ un calendrier N+1 vide DÉCLENCHE l'alerte", async () => {
    /*
     * Critère d'acceptation : vider le calendrier de l'année suivante fait
     * apparaître l'alerte. C'est le seul mécanisme qui transforme un oubli
     * silencieux en quelque chose que quelqu'un voit.
     */
    await retirerFetesDeTest();
    expect(await alertesDe(adminId)).toContain("HOLIDAYS_INCOMPLETE");
  });

  it("elle DISPARAÎT dès que l'année suivante est saisie", async () => {
    await poserFeteReligieuse(NEXT_YEAR);
    expect(await alertesDe(adminId)).not.toContain("HOLIDAYS_INCOMPLETE");
    await retirerFetesDeTest();
  });

  it("elle ne s'adresse qu'à qui peut y remédier", async () => {
    /*
     * ⚠️ Un RESPONSABLE ne peut pas saisir le calendrier : `referential.manage`
     * ouvre l'écran, et il ne l'a pas. Lui montrer l'alerte la banaliserait sans
     * lui donner le moyen d'agir — et une alerte qu'on ne peut pas traiter
     * apprend à ignorer le bandeau tout entier.
     */
    await retirerFetesDeTest();
    const responsable = await scope.createUserWithRole("RESPONSABLE", "FISCAL");

    expect(await alertesDe(responsable)).not.toContain("HOLIDAYS_INCOMPLETE");
    expect(await alertesDe(adminId)).toContain("HOLIDAYS_INCOMPLETE");
  });

  it("l'alerte porte l'ANNÉE concernée, pas un simple compteur", async () => {
    /*
     * Le libellé doit pouvoir dire LAQUELLE. « Calendrier incomplet » sans année
     * oblige à aller chercher ce que l'alerte voulait dire — et ce détour est
     * exactement ce qui fait qu'on ne le fait pas.
     */
    await retirerFetesDeTest();

    const rows = await scope.asUser(adminId, async (client) => {
      const result = await client.query<{ code: string; total: number; detail: { year?: number } }>(
        "select code, total, detail from public.dashboard_alerts()",
      );
      return result.rows;
    });

    const alerte = rows.find((row) => row.code === "HOLIDAYS_INCOMPLETE");
    expect(alerte?.total).toBe(NEXT_YEAR);
    expect(alerte?.detail.year).toBe(NEXT_YEAR);
  });

  it("le reste du bandeau n'est pas cassé pour autant", async () => {
    // Critère d'acceptation : « ne casse rien d'autre ». Les autres branches
    // doivent continuer de répondre — la fonction entière a été réécrite.
    const codes = await alertesDe(adminId);
    expect(Array.isArray(codes)).toBe(true);
    // BACKUP_STALE dépend de l'état des sauvegardes ; on vérifie seulement que
    // la fonction rend un ensemble cohérent, sans erreur SQL.
    for (const code of codes) expect(typeof code).toBe("string");
  });
});

describe("avertissement journalisé par le générateur", () => {
  /**
   * ⚠️ LES DEUX MOITIÉS DU GARDE-FOU, ET NI L'UNE NI L'AUTRE NE SUFFIT.
   *
   * L'alerte de tableau de bord s'adresse à qui ouvre l'écran. Le journal
   * s'adresse à la génération nocturne, qui tourne sans personne devant. Le
   * défaut d'origine tenait précisément à ce qu'aucune des deux n'existait :
   * le calcul se faisait, faux, et se taisait.
   */

  /** Ce que la génération a écrit en `warn`, sur une fenêtre donnée. */
  async function warnPendantGeneration(now: Date): Promise<string[]> {
    const lignes: string[] = [];
    const espion = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      lignes.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
    try {
      // L'horizon compte : il décide des années que le générateur va toucher,
      // donc de celles dont l'absence est un manque.
      await generateAllActive(generationClient, 3, now);
    } finally {
      espion.mockRestore();
    }
    return lignes;
  }

  /**
   * Les années citées par l'avertissement, extraites du champ STRUCTURÉ.
   *
   * ⚠️ NE PAS CHERCHER « 2026 » DANS LA LIGNE BRUTE. Elle porte son propre
   * horodatage ISO, qui contient l'année courante : l'assertion passerait quoi
   * qu'il arrive, y compris si l'avertissement ne citait aucune année. C'est
   * exactement le genre de test vert qui ne mesure rien — celui qui a laissé
   * passer le défaut d'origine.
   */
  function anneesCitees(ligne: string): number[] {
    const champ = /"years":\[([\d,\s]*)\]/.exec(ligne);
    if (champ === null) return [];
    return (champ[1] ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((year) => Number.isFinite(year));
  }

  it("⚠️ une année sans aucune date EXACTE est JOURNALISÉE", async () => {
    await retirerFetesDeTest();

    const lignes = await warnPendantGeneration(new Date(`${String(CURRENT_YEAR)}-03-15T11:00:00Z`));
    const avertissement = lignes.find((l) => l.includes("Calendrier des jours fériés incomplet"));

    expect(avertissement).toBeDefined();

    /*
     * Il doit dire LESQUELLES. Les cinq fêtes civiles sont récurrentes et datées
     * de l'année courante : les compter comme couverture déclarerait cette année
     * saisie alors qu'elle n'a AUCUNE fête religieuse. L'année courante doit donc
     * figurer dans la liste, au même titre que la suivante.
     */
    expect(anneesCitees(avertissement ?? "")).toEqual([CURRENT_YEAR, CURRENT_YEAR + 1]);
    // Et la CONSÉQUENCE, pas seulement le constat.
    expect(avertissement).toContain("jours chômés");
    // Et le REMÈDE : où aller le corriger.
    expect(avertissement).toContain("Jours fériés");
  });

  it("il se TAIT dès que toutes les années de l'horizon sont saisies", async () => {
    /*
     * Un avertissement permanent ne vaut rien : il apprend à ne plus lire le
     * journal. On saisit chaque année que l'horizon touche — l'année courante,
     * la suivante (une période de décembre échoit en janvier) — et le silence
     * doit revenir.
     */
    await retirerFetesDeTest();
    for (const year of [CURRENT_YEAR, CURRENT_YEAR + 1]) await poserFeteReligieuse(year);

    const lignes = await warnPendantGeneration(new Date(`${String(CURRENT_YEAR)}-03-15T11:00:00Z`));
    expect(lignes.find((l) => l.includes("Calendrier des jours fériés incomplet"))).toBeUndefined();

    await retirerFetesDeTest();
  });

  it("une génération à calendrier incomplet ABOUTIT quand même", async () => {
    /*
     * ⚠️ L'AVERTISSEMENT N'EST PAS UN ÉCHEC, ET CE CHOIX EST DÉLIBÉRÉ. Des
     * dossiers aux dates imparfaites valent mieux que pas de dossiers du tout :
     * refuser de générer priverait l'équipe de tout rappel, ce qui coûte plus
     * qu'un report manquant. Le signal est écrit ET visible ; il ne bloque rien.
     */
    await retirerFetesDeTest();

    const report = await generateAllActive(
      generationClient,
      3,
      new Date(`${String(CURRENT_YEAR)}-03-15T11:00:00Z`),
    );

    expect(report.ok).toBe(true);
  });
});
