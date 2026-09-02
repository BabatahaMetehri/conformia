// @vitest-environment node

/**
 * Référentiel AGROESPACE, éprouvé contre la BASE.
 *
 * ⚠️ CE FICHIER APPLIQUE LE SEED LUI-MÊME, en `beforeAll`, et c'est délibéré :
 * la ré-exécutabilité est ainsi éprouvée par la suite plutôt qu'affirmée. Le
 * seed n'est PAS branché sur `db reset` — voir `supabase/config.toml` : y
 * brancher le référentiel métier faisait échouer six tests de cloisonnement RLS
 * qui affirment des comptes exacts sur une base vide.
 *
 * ⚠️ Il COMMITTE : la génération travaille en plusieurs transactions et doit
 * être observable.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls`.
 */

import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";
import { generateAllActive } from "@/services/scheduling/generator";

const pool = new Pool({
  connectionString:
    process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 4,
});

const client: SupabaseClient<Database> = createClient<Database>(
  process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

/** Les sept obligations que rien ne doit générer automatiquement. */
const EVENT_DRIVEN = [
  "CNAS-MVT",
  "ENGRAIS-AUT",
  "AGR-SANIT",
  "ETAB-CLASSE",
  "RC-MAJ",
  "BOAL",
  "DIVERS",
] as const;

/**
 * ⚠️ Ancrées sur une EXPIRATION tout en étant déclarées ANNUAL. Elles ne
 * produisent rien : la date d'ancrage est portée par l'occurrence, qui n'existe
 * pas encore au moment de la génération. Ce n'est pas un défaut du moteur, c'est
 * une propriété de la règle — et elle mérite d'être arbitrée par le cabinet.
 */
const EXPIRY_ANCHORED = ["ASSUR", "ATT-FISC"] as const;

beforeAll(async () => {
  // Appliqué DEUX FOIS : la seconde passe ne doit produire aucun doublon, et
  // c'est le critère d'acceptation le plus important du référentiel.
  const sql = readFileSync("supabase/seed/0002_referentiel_agroespace.sql", "utf8");
  await pool.query(sql);
  await pool.query(sql);
}, 120_000);

afterAll(async () => {
  await pool.end();
});

describe("contenu du référentiel", () => {
  it("porte 23 obligations, réparties sur les quatre domaines", async () => {
    const { rows } = await pool.query<{ code: string; n: number }>(
      `select d.code, count(*)::int as n
         from public.obligation_types ot
         join public.domains d on d.id = ot.domain_id
        group by d.code order by d.code`,
    );

    /*
     * ⚠️ VINGT-TROIS, pas vingt-deux. L'énoncé annonce 22 obligations mais en
     * énumère 23 (6 + 6 + 6 + 5). L'énumération fait foi : c'est elle qui porte
     * les règles d'échéance.
     */
    expect(Object.fromEntries(rows.map((row) => [row.code, row.n]))).toEqual({
      FISCAL: 6,
      SOCIAL: 6,
      REGLEMENTAIRE: 6,
      JURIDIQUE: 5,
    });
  });

  it("porte les organismes, services et jours fériés civils", async () => {
    const count = async (table: string): Promise<number> => {
      const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      return rows[0]?.n ?? 0;
    };

    expect(await count("public.authorities")).toBe(11);
    expect(await count("public.departments")).toBe(4);

    const { rows } = await pool.query<{ label: string }>(
      "select label from public.holidays where is_recurring order by holiday_date",
    );
    // Les cinq fêtes CIVILES à date fixe. Les fêtes religieuses suivent le
    // calendrier hégirien et sont saisies à la main : en injecter serait
    // inventer une règle réglementaire.
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.label)).toContain("Yennayer — nouvel an amazigh");
  });

  it("établit la chaîne CPT-SOCIAUX → AGO → IBS-BILAN", async () => {
    const { rows } = await pool.query<{ obligation: string; depends_on: string }>(
      `select a.code as obligation, b.code as depends_on
         from public.obligation_types a
         join public.obligation_types b on b.id = a.depends_on_obligation_type_id
        order by a.code`,
    );

    // On ne dépose pas les comptes sociaux avant que l'assemblée ne les ait
    // approuvés, ni ne réunit l'assemblée sur des comptes non arrêtés.
    expect(rows).toEqual([
      { obligation: "AGO", depends_on: "IBS-BILAN" },
      { obligation: "CPT-SOCIAUX", depends_on: "AGO" },
    ]);
  });

  it("dote chaque obligation d'au moins une pièce attendue", async () => {
    const { rows } = await pool.query<{ code: string }>(
      `select ot.code from public.obligation_types ot
        where not exists (
          select 1 from public.obligation_required_documents rd
          where rd.obligation_type_id = ot.id)`,
    );
    // Une obligation sans pièce attendue ne peut jamais être déclarée complète :
    // son dossier serait vide et pourtant valide.
    expect(rows).toEqual([]);
  });

  it("détaille les six obligations à double validation", async () => {
    const { rows } = await pool.query<{ code: string; n: number }>(
      `select ot.code, count(rd.id)::int as n
         from public.obligation_types ot
         join public.obligation_required_documents rd on rd.obligation_type_id = ot.id
        where ot.validation_levels = 2
        group by ot.code order by ot.code`,
    );

    expect(rows.map((row) => row.code)).toEqual([
      "CNAS-DAS",
      "CNAS-DTS",
      "CPT-SOCIAUX",
      "ENGRAIS-AUT",
      "G50",
      "IBS-BILAN",
    ]);
    // Chacune porte une liste détaillée, pas le minimum générique.
    expect(rows.every((row) => row.n >= 3)).toBe(true);
  });

  it("attache une PREUVE DE DÉPÔT partout où elle sera exigée", async () => {
    const { rows } = await pool.query<{ code: string }>(
      `select ot.code from public.obligation_types ot
        where ot.requires_proof
          and not exists (
            select 1 from public.obligation_required_documents rd
            where rd.obligation_type_id = ot.id and rd.document_kind = 'PREUVE_DEPOT')`,
    );
    /*
     * ⚠️ `requires_proof` conditionne le passage au statut « déposé » : sans
     * pièce de ce type dans la liste, l'obligation serait impossible à clore.
     * Le seul cas admis est DIVERS, qui n'exige pas de preuve.
     */
    expect(rows).toEqual([]);
  });
});

describe("génération à partir du référentiel", () => {
  it("produit un calendrier, sans échec, et reste rejouable", async () => {
    const first = await generateAllActive(client, 18);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    /*
     * ⚠️ ZÉRO ÉCHEC EXIGÉ. Une tâche de nuit qui rapporte PARTIAL tous les jours
     * apprend à ignorer son propre statut : au bout d'une semaine, plus personne
     * ne le lit, et le jour où l'échec est réel il passe inaperçu.
     */
    expect(first.value.failed).toBe(0);

    /*
     * ⚠️ On mesure les périodes VUES, pas les périodes créées. Ce fichier
     * committe : relancé sur une base déjà générée, il ne créerait rien, et un
     * `created > 0` échouerait pour une raison qui n'a rien à voir avec ce qu'il
     * vérifie. Un test dont le verdict dépend de l'ordre des exécutions ne prouve
     * rien de stable.
     */
    const seen = first.value.created + first.value.skipped;
    expect(seen).toBeGreaterThan(0);

    const second = await generateAllActive(client, 18);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Rejouable : la seconde passe voit exactement autant, et ne crée rien.
    expect(second.value.created).toBe(0);
    expect(second.value.skipped).toBe(seen);
  });

  it("ne génère RIEN pour les sept obligations déclenchées par un fait", async () => {
    const { rows } = await pool.query<{ code: string; n: number }>(
      `select ot.code, count(oc.id)::int as n
         from public.obligation_types ot
         left join public.obligation_occurrences oc on oc.obligation_type_id = ot.id
        where ot.code = any($1) group by ot.code order by ot.code`,
      [[...EVENT_DRIVEN]],
    );

    expect(rows).toHaveLength(EVENT_DRIVEN.length);
    expect(rows.every((row) => row.n === 0)).toBe(true);
  });

  it("ne génère RIEN non plus pour les obligations ancrées sur une EXPIRATION", async () => {
    const { rows } = await pool.query<{ code: string; n: number }>(
      `select ot.code, count(oc.id)::int as n
         from public.obligation_types ot
         left join public.obligation_occurrences oc on oc.obligation_type_id = ot.id
        where ot.code = any($1) group by ot.code order by ot.code`,
      [[...EXPIRY_ANCHORED]],
    );

    /*
     * ⚠️ CONSÉQUENCE À CONNAÎTRE, ET À ARBITRER. ASSUR et ATT-FISC sont
     * déclarées ANNUAL dans l'énoncé, mais ancrées sur `EXPIRY_DATE` : la date
     * de référence est portée par l'occurrence, qui n'existe pas encore au
     * moment de la génération. Elles ne produisent donc aucun dossier
     * automatique, exactement comme les sept ON_EVENT.
     *
     * Le moteur les ÉCARTE plutôt que d'échouer dessus — l'impossibilité est
     * structurelle, pas accidentelle. Reste au cabinet à trancher : soit ces
     * deux obligations deviennent ON_EVENT comme leurs semblables du domaine
     * réglementaire, soit elles passent en FIXED_DATE si l'échéance de
     * renouvellement est en réalité calendaire.
     */
    expect(rows.every((row) => row.n === 0)).toBe(true);
  });

  it("produit des échéances plausibles, reports compris", async () => {
    const { rows } = await pool.query<{ code: string; period_key: string; legal: Date }>(
      `select ot.code, oc.period_key, oc.legal_due_date as legal
         from public.obligation_occurrences oc
         join public.obligation_types ot on ot.id = oc.obligation_type_id
        where (ot.code, oc.period_key) in (('AGO','2026'), ('IBS-BILAN','2026'))`,
    );
    const byCode = Object.fromEntries(
      rows.map((row) => [row.code, row.legal.toISOString().slice(0, 10)]),
    );

    /*
     * ⚠️ Exercice 2026, et deux comportements différents à lire ensemble.
     *
     * IBS-BILAN vise le 30 avril 2027 — un VENDREDI, donc chômé en Algérie. Le
     * samedi 1er mai est à la fois week-end ET Fête du Travail, férié récurrent
     * semé par ce référentiel. L'échéance atterrit donc le dimanche 2 mai, qui
     * est un jour ouvré ici. Deux reports enchaînés, pour deux causes.
     *
     * AGO vise le 30 juin 2027, un mercredi : aucun report, la date brute tient.
     *
     * C'est exactement ce qu'il faut vérifier sur un référentiel réel — les
     * dates annoncées dans l'énoncé sont des dates BRUTES, et l'échéance
     * réellement opposable est celle d'après reports.
     */
    expect(byCode["IBS-BILAN"]).toBe("2027-05-02");
    expect(byCode["AGO"]).toBe("2027-06-30");
  });

  it("REPOUSSE une échéance tombant un jour férié récurrent", async () => {
    const { rows } = await pool.query<{ legal: Date }>(
      `select oc.legal_due_date as legal
         from public.obligation_occurrences oc
         join public.obligation_types ot on ot.id = oc.obligation_type_id
        where ot.code = 'CNAS-DTS' and oc.period_key = '2026-Q3'`,
    );

    /*
     * ⚠️ Le trajet complet, en une date. Le trimestre finit le 30 septembre ;
     * + 30 jours donne le vendredi 30 octobre, chômé en Algérie (le week-end y
     * est VENDREDI-SAMEDI) ; samedi 31 chômé ; dimanche 1er novembre est
     * l'Anniversaire de la Révolution, férié récurrent semé par ce référentiel.
     * L'échéance atterrit donc le lundi 2 novembre.
     */
    expect(rows[0]?.legal.toISOString().slice(0, 10)).toBe("2026-11-02");
  });
});
