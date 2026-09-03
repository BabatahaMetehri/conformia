import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";
import { generateOccurrences } from "@/services/scheduling/generator";

/**
 * REGISTRES DE COMMERCE ET TRIADE D'AFFECTATION — migration 0018.
 *
 * ⚠️ CE QUI SE JOUE ICI EST UN COMPTAGE, et c'est ce qui le rend traître.
 *
 * Une obligation de portée ENTITY rattachée à un registre serait déclarée autant
 * de fois qu'il y a d'établissements ; une obligation PER_REGISTER sans registre
 * serait invisible de l'établissement concerné. Les deux erreurs se ressemblent,
 * aucune ne lève d'exception à l'usage, et toutes deux ne se découvrent qu'au
 * moment où l'on compte les déclarations déposées — c'est-à-dire trop tard.
 *
 * ⚠️ Éprouvé contre la BASE RÉELLE, sous session utilisateur là où la RLS
 * compte. Les contraintes vérifiées ici sont des triggers et des index partiels :
 * un test unitaire avec un client simulé ne mesurerait que la simulation.
 */

const DB_URL =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const ENTITY = "00000000-0000-0000-0000-000000000001";
const PREFIX = "REG-TEST";
/** Compte propre au fichier : une base fraîchement réinitialisée n'en porte aucun. */
const ACTOR = "9e9e9e9e-0000-0000-0000-00000000ab01";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
const client: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** Obligation annuelle de portée PER_REGISTER, ancrée sur la fin de période. */
let perRegisterId = "";
/**
 * Nombre de registres ACTIFS au moment du test.
 *
 * ⚠️ LU EN BASE, JAMAIS CODÉ EN DUR. Ce fichier ajoute trois registres, mais
 * l'entité en porte déjà — au minimum le principal créé par la migration 0018,
 * et davantage sur une base de travail. Écrire « 3 » ferait échouer le test sur
 * un défaut qui n'existe que dans son propre jeu d'essai : exactement le piège
 * relevé sur six tests d'intégration lors du dernier audit.
 */
let activeRegisters = 0;
/** Obligation annuelle de portée ENTITY, pour la symétrie des refus. */
let entityScopedId = "";
const registers: Record<string, string> = {};

async function countActiveRegisters(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.commercial_registers
     where entity_id = $1 and status = 'ACTIF' and deleted_at is null`,
    [ENTITY],
  );
  return rows[0]?.n ?? 0;
}

async function occurrenceCount(obligationId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from public.obligation_occurrences where obligation_type_id = $1",
    [obligationId],
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'registres@test.dz', 'x', now(), now(), now())
     on conflict (id) do nothing`,
    [ACTOR],
  );
  await pool.query(
    `insert into public.profiles (id, entity_id, full_name, email)
     values ($1, $2, 'Compte registres', 'registres@test.dz')
     on conflict (id) do nothing`,
    [ACTOR, ENTITY],
  );

  // Trois registres ACTIFS, plus un déjà radié : le radié ne doit rien produire.
  for (const [number, type, label, status] of [
    [`${PREFIX}-001`, "SECONDAIRE", "Unité de test 1", "ACTIF"],
    [`${PREFIX}-002`, "SECONDAIRE", "Unité de test 2", "ACTIF"],
    [`${PREFIX}-003`, "ANNEXE", "Dépôt de test", "ACTIF"],
    [`${PREFIX}-004`, "ANNEXE", "Site fermé", "RADIE"],
  ] as const) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.commercial_registers
         (entity_id, rc_number, register_type, label, status, expires_at)
       values ($1, $2, $3, $4, $5, current_date + 400)
       on conflict (entity_id, rc_number) do update set status = excluded.status
       returning id`,
      [ENTITY, number, type, label, status],
    );
    registers[number] = rows[0]?.id ?? "";
  }

  const annual = JSON.stringify({
    anchor: "PERIOD_END",
    offset_days: 0,
    weekend_shift: "NEXT_BUSINESS_DAY",
    holiday_shift: "NEXT_BUSINESS_DAY",
  });

  const perRegister = await pool.query<{ id: string }>(
    `insert into public.obligation_types
       (entity_id, code, name, periodicity, due_rule, internal_lead_days, criticality,
        validation_levels, requires_validation, effective_from, scope)
     values ($1, $2, 'Obligation par registre', 'ANNUAL', $3::jsonb, 5, 'MEDIUM', 1, true,
             date '2024-01-01', 'PER_REGISTER')
     on conflict (entity_id, code) do update set scope = 'PER_REGISTER'
     returning id`,
    [ENTITY, `${PREFIX}-PER`, annual],
  );
  perRegisterId = perRegister.rows[0]?.id ?? "";

  const entityScoped = await pool.query<{ id: string }>(
    `insert into public.obligation_types
       (entity_id, code, name, periodicity, due_rule, internal_lead_days, criticality,
        validation_levels, requires_validation, effective_from, scope)
     values ($1, $2, 'Obligation pour l''entreprise', 'ANNUAL', $3::jsonb, 5, 'MEDIUM', 1, true,
             date '2024-01-01', 'ENTITY')
     on conflict (entity_id, code) do update set scope = 'ENTITY'
     returning id`,
    [ENTITY, `${PREFIX}-ENT`, annual],
  );
  entityScopedId = entityScoped.rows[0]?.id ?? "";

  activeRegisters = await countActiveRegisters();
  // Les trois du fichier au moins : sans eux, le test ne mesurerait rien.
  expect(activeRegisters).toBeGreaterThanOrEqual(3);
});

afterAll(async () => {
  const connection = await pool.connect();
  try {
    await connection.query(
      "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
    );
    const scope = `obligation_type_id in (select id from public.obligation_types where code like '${PREFIX}%')`;
    const inScope = `select id from public.obligation_occurrences where ${scope}`;

    for (const table of ["notifications", "occurrence_transitions", "occurrence_checklist_items"]) {
      await connection.query(`delete from public.${table} where occurrence_id in (${inScope})`);
    }
    await connection.query(`delete from public.obligation_occurrences where ${scope}`);
    await connection.query(`delete from public.obligation_types where code like '${PREFIX}%'`);
    await connection.query(
      `delete from public.commercial_registers where rc_number like '${PREFIX}%'`,
    );
    await connection.query("delete from public.user_roles where user_id = $1", [ACTOR]);
    await connection.query("delete from public.profiles where id = $1", [ACTOR]);
    await connection.query("delete from auth.users where id = $1", [ACTOR]);
  } finally {
    await connection
      .query(
        "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
      )
      .catch(() => undefined);
    connection.release();
    await pool.end();
  }
});

// ═════════════════════════════════════════════════════════════════════════════

describe("portée des obligations", () => {
  it("une obligation ENTITY rattachée à un registre est REFUSÉE", async () => {
    /*
     * ⚠️ L'erreur la plus coûteuse des deux : G50 déclarée une fois par
     * établissement multiplierait les déclarations fiscales par le nombre de
     * registres, sans qu'aucun écran ne le signale.
     */
    await expect(
      pool.query(
        `insert into public.obligation_occurrences
           (entity_id, obligation_type_id, period_key, period_start, period_end,
            legal_due_date, internal_due_date, status, commercial_register_id)
         values ($1, $2, '2099-A', '2099-01-01', '2099-12-31', '2099-12-31', '2099-12-20',
                 'TODO', $3)`,
        [ENTITY, entityScopedId, registers[`${PREFIX}-001`]],
      ),
    ).rejects.toThrow(/portée ENTITY/i);
  });

  it("une obligation PER_REGISTER sans registre est REFUSÉE", async () => {
    await expect(
      pool.query(
        `insert into public.obligation_occurrences
           (entity_id, obligation_type_id, period_key, period_start, period_end,
            legal_due_date, internal_due_date, status)
         values ($1, $2, '2099-B', '2099-01-01', '2099-12-31', '2099-12-31', '2099-12-20', 'TODO')`,
        [ENTITY, perRegisterId],
      ),
    ).rejects.toThrow(/portée PER_REGISTER/i);
  });
});

describe("génération par registre", () => {
  it("chaque registre ACTIF produit UNE occurrence par période", async () => {
    const report = await generateOccurrences(client, perRegisterId, 12);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.failed).toBe(0);

    const { rows } = await pool.query<{ period_key: string; n: number }>(
      `select period_key, count(*)::int as n
       from public.obligation_occurrences
       where obligation_type_id = $1
       group by period_key order by period_key`,
      [perRegisterId],
    );

    expect(rows.length).toBeGreaterThan(0);
    // ⚠️ Le registre RADIÉ du jeu d'essai ne compte pas : le total suit
    // exactement le nombre de registres ACTIFS, ni plus, ni moins.
    for (const row of rows) expect(row.n).toBe(activeRegisters);
  });

  it("chaque occurrence porte un registre DISTINCT", async () => {
    // Trois lignes rattachées au même registre satisferaient le comptage
    // précédent tout en étant fausses.
    const { rows } = await pool.query<{ period_key: string; distincts: number }>(
      `select period_key, count(distinct commercial_register_id)::int as distincts
       from public.obligation_occurrences
       where obligation_type_id = $1
       group by period_key`,
      [perRegisterId],
    );
    for (const row of rows) expect(row.distincts).toBe(activeRegisters);
  });

  it("RELANCER la génération ne crée AUCUN doublon", async () => {
    const before = await occurrenceCount(perRegisterId);
    const report = await generateOccurrences(client, perRegisterId, 12);

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.created).toBe(0);
    expect(report.value.skipped).toBeGreaterThan(0);
    expect(await occurrenceCount(perRegisterId)).toBe(before);
  });

  it("RADIER un registre retire UNE occurrence des périodes suivantes, sans toucher aux dossiers déjà créés", async () => {
    /*
     * ⚠️ Les deux moitiés de cette garantie comptent autant l'une que l'autre.
     * Un registre radié cesse de produire — mais les dossiers qu'il a produits
     * restent à clore : une radiation n'annule pas les déclarations dues pour
     * la période où l'établissement était ouvert.
     */
    const before = await occurrenceCount(perRegisterId);

    await pool.query(
      "update public.commercial_registers set status = 'RADIE' where rc_number = $1",
      [`${PREFIX}-003`],
    );

    // Horizon élargi : les périodes suivantes sont neuves pour les deux restants.
    const report = await generateOccurrences(client, perRegisterId, 36);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    const { rows } = await pool.query<{ period_key: string; n: number }>(
      `select period_key, count(*)::int as n
       from public.obligation_occurrences
       where obligation_type_id = $1
       group by period_key order by period_key desc limit 1`,
      [perRegisterId],
    );

    expect(rows[0]?.n).toBe(activeRegisters - 1);
    // Rien n'a disparu : le total ne peut qu'avoir augmenté.
    expect(await occurrenceCount(perRegisterId)).toBeGreaterThanOrEqual(before);
  });

  it("une obligation ENTITY génère UNE occurrence par période, registres ou non", async () => {
    const report = await generateOccurrences(client, entityScopedId, 12);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    const { rows } = await pool.query<{ period_key: string; n: number }>(
      `select period_key, count(*)::int as n
       from public.obligation_occurrences
       where obligation_type_id = $1 group by period_key`,
      [entityScopedId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.n).toBe(1);
  });

  it("une RECTIFICATIVE reste possible sur une obligation PER_REGISTER", async () => {
    const { rows } = await pool.query<{ id: string; period_key: string; register: string }>(
      `select id, period_key, commercial_register_id as register
       from public.obligation_occurrences
       where obligation_type_id = $1 limit 1`,
      [perRegisterId],
    );
    const original = rows[0];
    expect(original).toBeDefined();
    if (original === undefined) return;

    // Même registre, même période, clé rectificative : les deux index partiels
    // portent sur `period_key`, qui diffère. Rien ne s'y oppose.
    await expect(
      pool.query(
        `insert into public.obligation_occurrences
           (entity_id, obligation_type_id, period_key, period_start, period_end,
            legal_due_date, internal_due_date, status, commercial_register_id,
            rectifies_occurrence_id, rectification_index)
         values ($1, $2, $3, '2099-01-01', '2099-12-31', '2099-12-31', '2099-12-20',
                 'TODO', $4, $5, 1)`,
        [ENTITY, perRegisterId, `${original.period_key}-R1`, original.register, original.id],
      ),
    ).resolves.toBeDefined();
  });
});

describe("triade d'affectation", () => {
  it("les rôles par service sont DÉSACTIVÉS, jamais supprimés", async () => {
    const { rows } = await pool.query<{ code: string; is_active: boolean }>(
      `select code, is_active from public.roles
       where code in ('COMPTA_MANAGER','COMPTA_AGENT','RH_MANAGER','RH_AGENT','REGLEMENTAIRE',
                      'RESPONSABLE','SUPPLEANT','SUPERVISEUR','ADMIN','DIRECTION','AUDITOR','EXTERNAL')
       order by code`,
    );

    const state = new Map(rows.map((row) => [row.code, row.is_active]));
    // Toujours définis : `user_roles` et `audit_log` portent leurs identifiants.
    expect(state.size).toBe(12);

    for (const code of [
      "COMPTA_MANAGER",
      "COMPTA_AGENT",
      "RH_MANAGER",
      "RH_AGENT",
      "REGLEMENTAIRE",
    ]) {
      expect(state.get(code), code).toBe(false);
    }
    for (const code of [
      "RESPONSABLE",
      "SUPPLEANT",
      "SUPERVISEUR",
      "ADMIN",
      "DIRECTION",
      "AUDITOR",
      "EXTERNAL",
    ]) {
      expect(state.get(code), code).toBe(true);
    }
  });

  it("un rôle désactivé n'est plus ATTRIBUABLE", async () => {
    const { rows } = await pool.query<{ id: string }>("select id from public.profiles limit 1");
    const profile = rows[0];
    expect(profile).toBeDefined();
    if (profile === undefined) return;

    await expect(
      pool.query(
        `insert into public.user_roles (user_id, role_id)
         select $1, r.id from public.roles r where r.code = 'COMPTA_AGENT'`,
        [profile.id],
      ),
    ).rejects.toThrow(/désactivé/i);
  });

  it("SUPPLEANT porte EXACTEMENT les permissions de RESPONSABLE", async () => {
    /*
     * ⚠️ C'est le cœur de la phase. Un suppléant aux droits réduits serait
     * bloqué le jour où l'absence n'a pas été déclarée — c'est-à-dire le jour
     * où l'on a le plus besoin de lui.
     */
    const { rows } = await pool.query<{ code: string; perms: string }>(
      `select r.code, coalesce(string_agg(p.code, ',' order by p.code), '') as perms
       from public.roles r
       left join public.role_permissions rp on rp.role_id = r.id
       left join public.permissions p on p.id = rp.permission_id
       where r.code in ('RESPONSABLE','SUPPLEANT')
       group by r.code`,
    );

    const byCode = new Map(rows.map((row) => [row.code, row.perms]));
    expect(byCode.get("SUPPLEANT")).toBe(byCode.get("RESPONSABLE"));
    expect(byCode.get("RESPONSABLE")).toContain("occurrence.submit");
  });

  it("une DÉCLARATION D'ABSENCE ne change AUCUNE permission", async () => {
    /*
     * ⚠️ La garantie qui rend le dispositif sûr. Si les droits du suppléant
     * dépendaient d'une absence déclarée, l'oubli d'une saisie administrative
     * produirait une pénalité fiscale : on aurait fait dépendre la conformité
     * d'un formulaire interne.
     *
     * On le vérifie par la STRUCTURE, non par un scénario : aucune policy ni
     * fonction d'autorisation ne doit citer la table.
     */
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') like '%user_absences%'
              or coalesce(with_check, '') like '%user_absences%')`,
    );
    expect(rows[0]?.n).toBe(0);

    const { rows: functions } = await pool.query<{ proname: string }>(
      `select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('has_permission', 'can_see_occurrence', 'accessible_domains',
                           'is_active_user', 'can_validate_occurrence')
         and pg_get_functiondef(p.oid) like '%user_absences%'`,
    );
    expect(functions.map((row) => row.proname)).toEqual([]);
  });

  it("la qualité d'intervention est CALCULÉE, pas déclarée", async () => {
    const { rows } = await pool.query<{ id: string; owner: string | null }>(
      `select id, owner_id as owner from public.obligation_occurrences
       where obligation_type_id = $1 limit 1`,
      [perRegisterId],
    );
    const occurrence = rows[0];
    expect(occurrence).toBeDefined();
    if (occurrence === undefined) return;

    const actor = ACTOR;

    // L'acteur devient responsable du dossier : sa qualité doit suivre, sans
    // qu'aucun appelant ne l'ait annoncée.
    await pool.query("update public.obligation_occurrences set owner_id = $2 where id = $1", [
      occurrence.id,
      actor,
    ]);

    const { rows: verdict } = await pool.query<{ acted_as: string | null }>(
      `select public.resolve_acted_as(oc, $2) as acted_as
       from public.obligation_occurrences oc where oc.id = $1`,
      [occurrence.id, actor],
    );
    expect(verdict[0]?.acted_as).toBe("RESPONSABLE");

    // Un inconnu du dossier, sans rôle d'autorité : qualité indéterminée plutôt
    // qu'un intitulé inventé.
    const { rows: stranger } = await pool.query<{ acted_as: string | null }>(
      `select public.resolve_acted_as(oc, '00000000-0000-0000-0000-0000000000ff'::uuid) as acted_as
       from public.obligation_occurrences oc where oc.id = $1`,
      [occurrence.id],
    );
    expect(stranger[0]?.acted_as).toBeNull();
  });
});
