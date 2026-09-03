// @vitest-environment node

/**
 * Moteur de génération, éprouvé contre la BASE.
 *
 * ⚠️ Les deux garanties qui comptent ne se vérifient qu'ici : l'IDEMPOTENCE
 * s'appuie sur une contrainte d'unicité PostgreSQL, et le VERROU CONSULTATIF est
 * un mécanisme du serveur. Aucune des deux ne s'observe en relisant du
 * TypeScript.
 *
 * ⚠️ Ce fichier COMMITTE, contrairement aux autres suites d'intégration : le
 * verrou consultatif est pris par session et le générateur travaille en
 * plusieurs transactions. Le jeu d'essai est supprimé explicitement en fin de
 * fichier, et son préfixe le rend reconnaissable si un échec interrompait le
 * nettoyage.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";
import {
  backfillArchivedShells,
  generateAllActive,
  generateOccurrences,
  regenerateFuture,
} from "@/services/scheduling/generator";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 4 });
const PREFIX = "GEN-";

/** Client de service : le générateur travaille hors session utilisateur. */
const client: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** Point de départ FIXE : un « maintenant » mouvant rendrait les comptes instables. */
const NOW = new Date("2026-03-15T11:00:00Z");

/**
 * ⚠️ ENTITÉ DÉDIÉE : le périmètre de tout ce que ce fichier fabrique.
 *
 * Sans elle, les assertions de ce fichier porteraient sur la base ENTIÈRE et
 * changeraient de verdict au seul chargement du référentiel AGROESPACE. Tout ce
 * que le jeu d'essai crée est rattaché ici, et rien de ce qu'il affirme ne
 * regarde au-delà. Voir tests/helpers/test-scope.ts pour la version outillée,
 * à préférer pour tout NOUVEAU fichier.
 */
const ENTITY = "c0c0c0c0-0000-0000-0000-0000000000e2";

const SEED = `
-- Entité du test : tout ce qui suit lui appartient.
insert into public.entities (id, code, name)
values ('${ENTITY}', 'TEST-GEN', 'Entité de test')
on conflict (id) do nothing;

insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, effective_to, domain_id,
   criticality, internal_lead_days, is_active)
values
  ('${PREFIX}MONTHLY', 'Mensuelle', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}'::jsonb,
   '2000-01-01', null, (select id from public.domains where code='FISCAL'), 'HIGH', 0, true),
  ('${PREFIX}EVENT', 'Sur événement', 'ON_EVENT',
   '{"anchor":"EVENT_DATE","offset_days":10,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}'::jsonb,
   '2000-01-01', null, (select id from public.domains where code='FISCAL'), 'LOW', 0, true),
  ('${PREFIX}EXPIRED', 'Abrogée', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}'::jsonb,
   '2000-01-01', '2020-12-31', (select id from public.domains where code='FISCAL'), 'LOW', 0, true),
  ('${PREFIX}INACTIVE', 'Désactivée', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}'::jsonb,
   '2000-01-01', null, (select id from public.domains where code='FISCAL'), 'LOW', 0, false);

insert into public.obligation_required_documents
  (obligation_type_id, label, is_mandatory, document_kind, order_index)
select ot.id, 'Bordereau signé', true, 'JUSTIFICATIF', 1
from public.obligation_types ot where ot.code = '${PREFIX}MONTHLY';

-- ── Rattachement à l'entité du test ─────────────────────────────────────
-- ⚠️ Les triggers sont coupés le temps du rattachement : la colonne est un
-- rangement, pas un acte métier, et le laisser produire une entrée d'audit
-- et une montée de version fausserait les tests qui les observent.
alter table public.obligation_occurrences disable trigger user;
update public.obligation_types set entity_id = '${ENTITY}'
 where code like '${PREFIX}%';
update public.obligation_occurrences set entity_id = '${ENTITY}'
 where obligation_type_id in
       (select id from public.obligation_types where entity_id = '${ENTITY}');
alter table public.obligation_occurrences enable trigger user;
`;

const CLEANUP = `
alter table public.obligation_occurrences disable trigger user;
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;

delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.occurrence_checklist_items where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.obligation_occurrences where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');

alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;
alter table public.obligation_occurrences enable trigger user;

delete from public.obligation_required_documents where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');
delete from public.obligation_types where code like '${PREFIX}%';
delete from public.job_runs where job_name like 'test-%';
-- L'entité en dernier : elle est le parent de tout ce qui précède.
delete from public.entities where id = '${ENTITY}';
`;

let ids: Record<string, string> = {};

async function countOccurrences(code: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.obligation_occurrences oc
       join public.obligation_types ot on ot.id = oc.obligation_type_id
      where ot.code = $1`,
    [`${PREFIX}${code}`],
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  if (SERVICE_KEY.length === 0) throw new Error("SUPABASE_SERVICE_ROLE_KEY absent");
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.query(SEED);

  const { rows } = await pool.query<{ id: string; code: string }>(
    "select id, code from public.obligation_types where code like $1",
    [`${PREFIX}%`],
  );
  ids = Object.fromEntries(rows.map((row) => [row.code.replace(PREFIX, ""), row.id]));
}, 120_000);

afterAll(async () => {
  try {
    await pool.query(CLEANUP);
  } finally {
    await pool.end();
  }
}, 120_000);

// ─────────────────────────────────────────────────────────────────────────────

describe("génération d'une obligation", () => {
  it("crée les occurrences de l'horizon, avec leur liste de contrôle", async () => {
    const report = await generateOccurrences(client, ids["MONTHLY"] ?? "", 6, NOW);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    // Six mois d'horizon depuis mars : mars à septembre, bornes incluses.
    expect(report.value.created).toBeGreaterThan(0);
    expect(report.value.failed).toBe(0);

    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from public.occurrence_checklist_items ci
         join public.obligation_occurrences oc on oc.id = ci.occurrence_id
        where oc.obligation_type_id = $1`,
      [ids["MONTHLY"]],
    );
    // La liste de contrôle est recopiée du référentiel à la création : un dossier
    // sans ses pièces attendues ne pourrait jamais être déclaré complet.
    expect(rows[0]?.n).toBe(report.value.created);
  });

  it("est IDEMPOTENT : une seconde passe ne crée aucun doublon", async () => {
    const before = await countOccurrences("MONTHLY");

    const second = await generateOccurrences(client, ids["MONTHLY"] ?? "", 6, NOW);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    /*
     * ⚠️ LE CRITÈRE CENTRAL. Toutes les périodes sont vues, aucune n'est créée :
     * `skipped` les compte, `created` reste à zéro. La garantie vient de la
     * contrainte d'unicité et du `on conflict do nothing`, pas d'une précaution
     * applicative — c'est ce qui la rend vraie même en cas d'exécution
     * concurrente.
     */
    expect(second.value.created).toBe(0);
    expect(second.value.skipped).toBeGreaterThan(0);
    expect(await countOccurrences("MONTHLY")).toBe(before);
  });

  it("ne régénère JAMAIS une période déjà traitée, quel que soit son statut", async () => {
    // On POSE un état de départ : le trigger de transition refuse TODO → SUBMITTED,
    // et l'objet du test n'est pas le cycle de vie mais l'idempotence.
    await pool.query(
      "alter table public.obligation_occurrences disable trigger trg_occurrences_20_validate_transition",
    );
    await pool.query(
      `update public.obligation_occurrences set status = 'SUBMITTED'
        where obligation_type_id = $1 and period_key = '2026-03'`,
      [ids["MONTHLY"]],
    );
    await pool.query(
      "alter table public.obligation_occurrences enable trigger trg_occurrences_20_validate_transition",
    );

    const report = await generateOccurrences(client, ids["MONTHLY"] ?? "", 6, NOW);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.created).toBe(0);

    const { rows } = await pool.query<{ status: string }>(
      "select status from public.obligation_occurrences where obligation_type_id = $1 and period_key = '2026-03'",
      [ids["MONTHLY"]],
    );
    // Écraser un dossier déjà déposé serait bien pire que de ne rien générer.
    expect(rows[0]?.status).toBe("SUBMITTED");
  });

  it("ne génère RIEN pour une obligation ON_EVENT", async () => {
    const report = await generateOccurrences(client, ids["EVENT"] ?? "", 12, NOW);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    // Ces obligations naissent d'un fait : en fabriquer d'office remplirait
    // l'échéancier de dossiers sans objet que personne ne pourrait clore.
    expect(report.value.created).toBe(0);
    expect(await countOccurrences("EVENT")).toBe(0);
  });

  it("ne génère RIEN hors de la période de validité", async () => {
    const report = await generateOccurrences(client, ids["EXPIRED"] ?? "", 12, NOW);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    // L'obligation est abrogée depuis 2020 : elle cesse de produire des dossiers.
    expect(report.value.created).toBe(0);
    expect(await countOccurrences("EXPIRED")).toBe(0);
  });
});

describe("génération de toutes les obligations actives", () => {
  it("ignore les obligations DÉSACTIVÉES", async () => {
    const report = await generateAllActive(client, 3, NOW);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    const codes = report.value.perObligation.map((entry) => entry.obligationCode);
    expect(codes).not.toContain(`${PREFIX}INACTIVE`);
    expect(await countOccurrences("INACTIVE")).toBe(0);
  });

  it("deux exécutions consécutives ne créent AUCUN doublon", async () => {
    const first = await generateAllActive(client, 3, NOW);
    const countAfterFirst = await countOccurrences("MONTHLY");

    const second = await generateAllActive(client, 3, NOW);
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;

    // ⚠️ Critère d'acceptation, énoncé mot pour mot.
    expect(second.value.created).toBe(0);
    expect(await countOccurrences("MONTHLY")).toBe(countAfterFirst);
  });

  it("REFUSE en base une règle d'échéance incohérente", async () => {
    /*
     * ⚠️ CONSTAT UTILE, et meilleur que ce que je cherchais à tester. La
     * contrainte `obligation_types_due_rule_valid` (0001) refuse une règle
     * incohérente à l'ÉCRITURE : une FIXED_DATE sans mois ni jour ne peut pas
     * entrer en base. Le repli du moteur — « règle illisible, aucun dossier
     * généré » — est donc une défense de dernier ressort, pas un cas courant.
     *
     * C'est la bonne répartition : mieux vaut refuser la saisie que produire des
     * dossiers aux échéances inventées, qui se découvriraient au moment de la
     * pénalité.
     */
    await expect(
      pool.query(
        `update public.obligation_types
            set due_rule = '{"anchor":"FIXED_DATE","weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}'::jsonb
          where code = $1`,
        [`${PREFIX}INACTIVE`],
      ),
    ).rejects.toThrow(/due_rule_valid/);
  });

  it("traite CHAQUE obligation séparément et les rapporte toutes", async () => {
    /*
     * ⚠️ La propriété qui compte : le lot n'est pas tout-ou-rien. Chaque
     * obligation a sa ligne de rapport, et une difficulté sur l'une ne prive pas
     * les autres de leurs dossiers.
     */
    const report = await generateAllActive(client, 3, NOW);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    const codes = report.value.perObligation.map((entry) => entry.obligationCode);
    expect(codes).toContain(`${PREFIX}MONTHLY`);
    // L'abrogée est TRAITÉE puis rapportée à zéro : la borne de validité se lit
    // dans le rapport, elle n'est pas un silence.
    expect(codes).toContain(`${PREFIX}EXPIRED`);

    /*
     * ⚠️ ON_EVENT est écarté À LA SOURCE, par la requête qui liste les
     * obligations générables — pas plus loin dans la boucle. Ces obligations
     * naissent d'un fait : les faire figurer dans un rapport de génération
     * laisserait croire qu'on a envisagé de les produire.
     */
    expect(codes).not.toContain(`${PREFIX}EVENT`);

    // Le total est la somme des lignes : aucun dossier n'échappe au rapport.
    const summed = report.value.perObligation.reduce((sum, entry) => sum + entry.created, 0);
    expect(report.value.created).toBe(summed);
  });
});

describe("recalcul des occurrences futures", () => {
  it("déplace les échéances TODO à venir, et laisse le reste intact", async () => {
    await pool.query(
      `update public.obligation_types
          set due_rule = '{"anchor":"PERIOD_END","offset_days":25,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}'::jsonb
        where id = $1`,
      [ids["MONTHLY"]],
    );

    // ⚠️ `pg` rend un objet Date pour une colonne `date` : on compare la chaîne
    // ISO, sinon `toBe` échoue sur deux instants pourtant identiques.
    const before = await pool.query<{ legal_due_date: Date }>(
      "select legal_due_date from public.obligation_occurrences where obligation_type_id = $1 and period_key = '2026-03'",
      [ids["MONTHLY"]],
    );

    const result = await regenerateFuture(client, ids["MONTHLY"] ?? "", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.updated).toBeGreaterThan(0);

    // Le dossier de mars est SUBMITTED depuis un test précédent : il ne bouge pas.
    const after = await pool.query<{ legal_due_date: Date }>(
      "select legal_due_date from public.obligation_occurrences where obligation_type_id = $1 and period_key = '2026-03'",
      [ids["MONTHLY"]],
    );
    expect(after.rows[0]?.legal_due_date.toISOString()).toBe(
      before.rows[0]?.legal_due_date.toISOString(),
    );
  });

  it("ne CRÉE aucune occurrence : c'est un recalcul, pas une génération", async () => {
    const before = await countOccurrences("MONTHLY");
    const result = await regenerateFuture(client, ids["MONTHLY"] ?? "", NOW);
    expect(result.ok).toBe(true);
    expect(await countOccurrences("MONTHLY")).toBe(before);
  });
});

describe("rattrapage d'archives", () => {
  it("crée les coquilles des mois précédents au statut ARCHIVED", async () => {
    const report = await backfillArchivedShells(client, ids["MONTHLY"] ?? "", 6, NOW);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.created).toBeGreaterThan(0);

    const { rows } = await pool.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from public.obligation_occurrences
        where obligation_type_id = $1 and period_start < '2026-03-01'
        group by status`,
      [ids["MONTHLY"]],
    );

    /*
     * ⚠️ ARCHIVED, jamais TODO. Ces coquilles servent à recevoir des
     * justificatifs anciens, pas à réclamer du travail : les créer en TODO
     * fabriquerait des dizaines de dossiers « en retard » le premier jour,
     * exactement l'inverse du but recherché.
     */
    expect(rows.every((row) => row.status === "ARCHIVED")).toBe(true);
  });

  it("est idempotent lui aussi", async () => {
    const before = await countOccurrences("MONTHLY");
    const second = await backfillArchivedShells(client, ids["MONTHLY"] ?? "", 6, NOW);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.created).toBe(0);
    expect(await countOccurrences("MONTHLY")).toBe(before);
  });
});

describe("verrou consultatif", () => {
  it("BLOQUE effectivement une seconde prise", async () => {
    /*
     * ⚠️ Critère d'acceptation. Deux connexions distinctes, le verrou pris par
     * la première : la seconde doit se voir refuser SANS attendre. Un verrou qui
     * ferait patienter empilerait les exécutions au lieu d'en sauter une.
     */
    const first = await pool.connect();
    const second = await pool.connect();

    try {
      const taken = await first.query<{ ok: boolean }>(
        "select public.try_lock_job('test-lock') as ok",
      );
      expect(taken.rows[0]?.ok).toBe(true);

      const refused = await second.query<{ ok: boolean }>(
        "select public.try_lock_job('test-lock') as ok",
      );
      expect(refused.rows[0]?.ok).toBe(false);

      // Relâché, il redevient disponible pour la seconde connexion.
      await first.query("select public.unlock_job('test-lock')");
      const retried = await second.query<{ ok: boolean }>(
        "select public.try_lock_job('test-lock') as ok",
      );
      expect(retried.rows[0]?.ok).toBe(true);
      await second.query("select public.unlock_job('test-lock')");
    } finally {
      first.release();
      second.release();
    }
  });

  it("la MÊME session peut reprendre son propre verrou", async () => {
    // Les verrous consultatifs de PostgreSQL sont réentrants : c'est une
    // propriété du serveur, et le générateur ne doit pas la prendre pour une
    // exclusion mutuelle au sein d'un même processus.
    const conn = await pool.connect();
    try {
      const first = await conn.query<{ ok: boolean }>(
        "select public.try_lock_job('test-reentrant') as ok",
      );
      const again = await conn.query<{ ok: boolean }>(
        "select public.try_lock_job('test-reentrant') as ok",
      );
      expect(first.rows[0]?.ok).toBe(true);
      expect(again.rows[0]?.ok).toBe(true);

      // Deux prises, deux relâchements.
      await conn.query("select public.unlock_job('test-reentrant')");
      await conn.query("select public.unlock_job('test-reentrant')");
    } finally {
      conn.release();
    }
  });
});

describe("journal des exécutions", () => {
  it("ouvre puis clôt une ligne, avec son compte", async () => {
    const { rows: opened } = await pool.query<{ id: string }>(
      "select public.start_job_run('test-run') as id",
    );
    const runId = opened[0]?.id ?? "";

    await pool.query("select public.finish_job_run($1, 'PARTIAL', 7, 2, $2::jsonb)", [
      runId,
      JSON.stringify({ note: "essai" }),
    ]);

    const { rows } = await pool.query<{
      status: string;
      processed_count: number;
      error_count: number;
      finished_at: string | null;
    }>(
      "select status, processed_count, error_count, finished_at from public.job_runs where id = $1",
      [runId],
    );

    expect(rows[0]?.status).toBe("PARTIAL");
    expect(rows[0]?.processed_count).toBe(7);
    expect(rows[0]?.error_count).toBe(2);
    // Une ligne restée sans `finished_at` est le seul signal d'une tâche
    // interrompue : la clôture doit toujours l'inscrire.
    expect(rows[0]?.finished_at).not.toBeNull();
  });
});
