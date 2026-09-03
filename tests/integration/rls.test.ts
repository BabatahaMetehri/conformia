// @vitest-environment node

/**
 * Tests de politiques RLS, exécutés contre la base locale Supabase.
 *
 * Ces tests ne valent que branchés sur un vrai PostgreSQL : une politique ne se
 * teste pas en la relisant. Ils ouvrent une transaction par scénario, y prennent
 * le rôle `authenticated` avec les revendications JWT de l'utilisateur simulé,
 * puis annulent — la base est donc rendue intacte.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls` (exclu de `npm test`, qui ne doit pas exiger Docker).
 */

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 8 });

// ─── Identités de test ───────────────────────────────────────────────────────

const USER = {
  comptaAgent: "aaaaaaaa-0000-0000-0000-00000000a001",
  comptaManager: "aaaaaaaa-0000-0000-0000-00000000a002",
  rhAgent: "aaaaaaaa-0000-0000-0000-00000000a003",
  admin: "aaaaaaaa-0000-0000-0000-00000000a004",
  direction: "aaaaaaaa-0000-0000-0000-00000000a005",
  disabled: "aaaaaaaa-0000-0000-0000-00000000a006",
  expired: "aaaaaaaa-0000-0000-0000-00000000a007",
  delegate: "aaaaaaaa-0000-0000-0000-00000000a008",
} as const;

const OBLIGATION = {
  fiscal: "bbbbbbbb-0000-0000-0000-00000000b001",
  social: "bbbbbbbb-0000-0000-0000-00000000b002",
} as const;

const OCCURRENCE = {
  fiscal: "cccccccc-0000-0000-0000-00000000c001",
  social: "cccccccc-0000-0000-0000-00000000c002",
  ownedByAgent: "cccccccc-0000-0000-0000-00000000c003",
} as const;

/** Exécute `run` dans une transaction annulée, sous l'identité `userId`. */
async function asUser<T>(
  userId: string | null,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (userId !== null) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
    }
    await client.query("set local role authenticated");
    return await run(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Idem, mais sous `service_role` — le rôle qui contourne la RLS. */
async function asServiceRole<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    return await run(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

async function countRows(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(sql, params);
  return Number(result.rows[0]?.count ?? "0");
}

// ─── Jeu d'essai ─────────────────────────────────────────────────────────────

/**
 * ⚠️ ENTITÉ DÉDIÉE : le périmètre de tout ce que ce fichier fabrique.
 *
 * Sans elle, les comptages de ce fichier portaient sur la base ENTIÈRE et
 * changeaient de verdict au seul chargement du référentiel AGROESPACE — 22
 * dossiers visibles là où le test en attendait 1. Le test ne mesurait pas le
 * cloisonnement, il mesurait la vacuité de la base.
 */
const ENTITY = "c0c0c0c0-0000-0000-0000-0000000000e1";

const IDS_SQL = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const SEED = `
-- Entité du test : tout ce qui suit lui appartient, et aucune assertion ne
-- regarde au-delà.
insert into public.entities (id, code, name)
values ('${ENTITY}', 'TEST-RLS', 'Entité du test RLS')
on conflict (id) do nothing;

-- Comptes
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.comptaAgent}'::uuid,   'compta.agent@test.dz'),
  ('${USER.comptaManager}'::uuid, 'compta.manager@test.dz'),
  ('${USER.rhAgent}'::uuid,       'rh.agent@test.dz'),
  ('${USER.admin}'::uuid,         'admin@test.dz'),
  ('${USER.direction}'::uuid,     'direction@test.dz'),
  ('${USER.disabled}'::uuid,      'disabled@test.dz'),
  ('${USER.expired}'::uuid,       'expired@test.dz'),
  ('${USER.delegate}'::uuid,      'delegate@test.dz')
) as u(id, email)
on conflict (id) do nothing;

update public.profiles set entity_id = '${ENTITY}'
 where id in (${IDS_SQL});
update public.profiles set is_active = false where id = '${USER.disabled}';

-- Attributions (posées hors session : le trigger anti-auto-attribution ne vise
-- que les utilisateurs connectés).
insert into public.user_roles (user_id, role_id, domain_id, expires_at)
values
  ('${USER.comptaAgent}',   (select id from public.roles where code='RESPONSABLE'),
                            (select id from public.domains where code='FISCAL'), null),
  ('${USER.comptaManager}', (select id from public.roles where code='SUPERVISEUR'),
                            (select id from public.domains where code='FISCAL'), null),
  ('${USER.rhAgent}',       (select id from public.roles where code='RESPONSABLE'),
                            (select id from public.domains where code='SOCIAL'), null),
  ('${USER.admin}',         (select id from public.roles where code='ADMIN'), null, null),
  ('${USER.direction}',     (select id from public.roles where code='DIRECTION'), null, null),
  ('${USER.disabled}',      (select id from public.roles where code='RESPONSABLE'),
                            (select id from public.domains where code='FISCAL'), null),
  ('${USER.expired}',       (select id from public.roles where code='RESPONSABLE'),
                            (select id from public.domains where code='FISCAL'),
                            now() - interval '1 day');

-- Référentiel
insert into public.obligation_types (id, entity_id, code, name, periodicity, due_rule, effective_from, domain_id)
values
  ('${OBLIGATION.fiscal}', '${ENTITY}', 'TEST-TVA', 'TVA mensuelle', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
   (select id from public.domains where code='FISCAL')),
  ('${OBLIGATION.social}', '${ENTITY}', 'TEST-CNAS', 'Déclaration CNAS', 'QUARTERLY',
   '{"anchor":"PERIOD_END","offset_days":30}'::jsonb, '2026-01-01',
   (select id from public.domains where code='SOCIAL'));

-- Occurrences
insert into public.obligation_occurrences
  (id, entity_id, obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, owner_id, validator_id, status)
values
  ('${OCCURRENCE.fiscal}', '${ENTITY}', '${OBLIGATION.fiscal}', '2026-01', '2026-01-01', '2026-01-31',
   '2026-02-20', '2026-02-17', null, null, 'TODO'),
  ('${OCCURRENCE.social}', '${ENTITY}', '${OBLIGATION.social}', '2026-Q1', '2026-01-01', '2026-03-31',
   '2026-04-30', '2026-04-27', null, null, 'TODO'),
  ('${OCCURRENCE.ownedByAgent}', '${ENTITY}', '${OBLIGATION.fiscal}', '2026-02', '2026-02-01', '2026-02-28',
   '2026-03-20', '2026-03-17', '${USER.comptaManager}', null, 'PENDING_VALIDATION');

update public.obligation_occurrences
   set submitted_for_validation_at = now() - interval '60 days'
 where id = '${OCCURRENCE.ownedByAgent}';
`;

const CLEANUP = `
delete from public.occurrence_transitions where occurrence_id in (
  '${OCCURRENCE.fiscal}', '${OCCURRENCE.social}', '${OCCURRENCE.ownedByAgent}');
delete from public.obligation_occurrences where id in (
  '${OCCURRENCE.fiscal}', '${OCCURRENCE.social}', '${OCCURRENCE.ownedByAgent}');
delete from public.obligation_required_documents where obligation_type_id in (
  '${OBLIGATION.fiscal}', '${OBLIGATION.social}');
delete from public.obligation_types where id in ('${OBLIGATION.fiscal}', '${OBLIGATION.social}');
delete from public.validation_delegations where delegate_id = '${USER.delegate}';
delete from public.user_roles where user_id in (${Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ")});
delete from public.profiles where id in (${Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ")});
delete from auth.users where id in (${Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ")});
-- L'entité en dernier : elle est le parent de tout ce qui précède.
delete from public.entities where id = '${ENTITY}';
`;

beforeAll(async () => {
  // `occurrence_transitions` refuse le DELETE même au propriétaire : on lève le
  // trigger le temps du nettoyage, puis on le remet immédiatement.
  await pool.query(
    "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
  );
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.query(
    "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
  );
  await pool.query(SEED);
}, 60_000);

afterAll(async () => {
  await pool.query(
    "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
  );
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.query(
    "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
  );
  await pool.end();
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════

describe("cloisonnement entre domaines", () => {
  it("RH_AGENT ne lit AUCUNE occurrence du domaine FISCAL", async () => {
    const visible = await asUser(USER.rhAgent, (client) =>
      countRows(
        client,
        `select count(*) from public.obligation_occurrences oc
         join public.obligation_types ot on ot.id = oc.obligation_type_id
         join public.domains d on d.id = ot.domain_id
         where d.code = 'FISCAL'`,
      ),
    );
    expect(visible).toBe(0);
  });

  it("le RESPONSABLE du SOCIAL lit bien SES occurrences sociales", async () => {
    /*
     * ⚠️ LE COMPTAGE EST BORNÉ À L'ENTITÉ DU TEST, et c'est tout l'enjeu.
     *
     * Écrit sans ce filtre — `select count(*) from obligation_occurrences` — ce
     * test affirmait « il y a exactement un dossier ». C'était vrai sur une base
     * vide, faux dès qu'on y chargeait les 23 obligations AGROESPACE, et cela
     * n'a jamais rien dit du cloisonnement : il mesurait la vacuité de la base.
     *
     * Filtré, il dit ce qu'il doit dire : DES TROIS dossiers de cette entité,
     * ce compte n'en voit QUE le social.
     */
    const visible = await asUser(USER.rhAgent, (client) =>
      countRows(client, "select count(*) from public.obligation_occurrences where entity_id = $1", [
        ENTITY,
      ]),
    );
    expect(visible).toBe(1);

    // Contrepartie indispensable : l'entité en porte bien plus d'un, sans quoi
    // « il en voit un » ne prouverait aucun filtrage.
    const total = await pool.query<{ count: string }>(
      "select count(*) from public.obligation_occurrences where entity_id = $1",
      [ENTITY],
    );
    expect(Number(total.rows[0]?.count ?? 0)).toBe(3);
  });

  it("le cloisonnement résiste au comptage : COUNT(*) ne révèle rien", async () => {
    const total = await asUser(USER.rhAgent, (client) =>
      countRows(client, "select count(*) from public.obligation_occurrences where entity_id = $1", [
        ENTITY,
      ]),
    );
    const fiscalExists = await asUser(USER.rhAgent, (client) =>
      countRows(
        client,
        `select count(*) from public.obligation_occurrences where id = '${OCCURRENCE.fiscal}'`,
      ),
    );
    // Un COUNT ne révèle pas plus l'existence d'un dossier qu'un SELECT n'en
    // révèle le contenu : sur trois dossiers de l'entité, un seul est compté, et
    // le dossier fiscal nommément désigné reste introuvable.
    expect(total).toBe(1);
    expect(fiscalExists).toBe(0);
  });
});

describe("séparation administration / contenu métier", () => {
  it("ADMIN ne lit aucune occurrence", async () => {
    const visible = await asUser(USER.admin, (client) =>
      countRows(client, "select count(*) from public.obligation_occurrences"),
    );
    expect(visible).toBe(0);
  });

  it("ADMIN ne détient ni occurrence.read ni document.read", async () => {
    const granted = await asUser(USER.admin, async (client) => {
      const result = await client.query<{ occ: boolean; doc: boolean }>(
        `select public.has_permission('occurrence.read') as occ,
                public.has_permission('document.read') as doc`,
      );
      return result.rows[0];
    });
    expect(granted?.occ).toBe(false);
    expect(granted?.doc).toBe(false);
  });

  it("ADMIN conserve ses droits d'administration", async () => {
    const granted = await asUser(USER.admin, async (client) => {
      const result = await client.query<{ users: boolean; roles: boolean }>(
        `select public.has_permission('user.manage') as users,
                public.has_permission('role.manage') as roles`,
      );
      return result.rows[0];
    });
    expect(granted?.users).toBe(true);
    expect(granted?.roles).toBe(true);
  });

  it("ADMIN ne peut pas modifier ses propres rôles", async () => {
    await expect(
      asUser(USER.admin, (client) =>
        client.query(
          `insert into public.user_roles (user_id, role_id)
           values ('${USER.admin}', (select id from public.roles where code='DIRECTION'))`,
        ),
      ),
    ).rejects.toThrow(/propres habilitations/);
  });
});

describe("état du compte et des attributions", () => {
  it("un utilisateur désactivé ne lit rien", async () => {
    const visible = await asUser(USER.disabled, (client) =>
      countRows(client, "select count(*) from public.obligation_occurrences"),
    );
    expect(visible).toBe(0);
  });

  it("un rôle expiré n'accorde plus rien", async () => {
    const visible = await asUser(USER.expired, (client) =>
      countRows(client, "select count(*) from public.obligation_occurrences"),
    );
    expect(visible).toBe(0);

    const granted = await asUser(USER.expired, async (client) => {
      const result = await client.query<{ ok: boolean }>(
        "select public.has_permission('occurrence.read') as ok",
      );
      return result.rows[0]?.ok;
    });
    expect(granted).toBe(false);
  });

  it("un rôle AUDITOR sans expires_at est rejeté à l'insertion", async () => {
    await expect(
      pool.query(
        `insert into public.user_roles (user_id, role_id)
         values ('${USER.delegate}', (select id from public.roles where code='AUDITOR'))`,
      ),
    ).rejects.toThrow(/exige une date d'expiration/);
  });

  it("un rôle AUDITOR au-delà de 90 jours est rejeté", async () => {
    await expect(
      pool.query(
        `insert into public.user_roles (user_id, role_id, expires_at)
         values ('${USER.delegate}', (select id from public.roles where code='AUDITOR'),
                 now() + interval '120 days')`,
      ),
    ).rejects.toThrow(/limité à 90 jours/);
  });
});

describe("validation", () => {
  it("COMPTA_AGENT ne peut pas valider", async () => {
    await expect(
      asUser(USER.comptaAgent, async (client) => {
        await client.query(
          `update public.obligation_occurrences set status = 'IN_PROGRESS'
             where id = '${OCCURRENCE.fiscal}'`,
        );
        await client.query(
          `update public.obligation_occurrences set status = 'PENDING_VALIDATION'
             where id = '${OCCURRENCE.fiscal}'`,
        );
        await client.query(
          `update public.obligation_occurrences set status = 'VALIDATED'
             where id = '${OCCURRENCE.fiscal}'`,
        );
      }),
    ).rejects.toThrow(/occurrence\.validate/);
  });

  it("le préparateur ne peut pas valider son propre dossier", async () => {
    await expect(
      asUser(USER.comptaManager, (client) =>
        client.query(
          `update public.obligation_occurrences set status = 'VALIDATED'
             where id = '${OCCURRENCE.ownedByAgent}'`,
        ),
      ),
    ).rejects.toThrow(/Séparation des tâches/);
  });
});

describe("délégation", () => {
  it("un délégataire actif peut valider ; après ends_at, il ne peut plus", async () => {
    // Délégation active : COMPTA_MANAGER prête ses droits à `delegate`.
    await pool.query(
      `insert into public.validation_delegations
         (delegator_id, delegate_id, starts_at, ends_at, reason)
       values ('${USER.comptaManager}', '${USER.delegate}',
               current_date - 1, current_date + 5, 'Congé annuel')`,
    );

    const canWhileActive = await asUser(USER.delegate, async (client) => {
      const result = await client.query<{ ok: boolean }>(
        "select public.has_permission('occurrence.validate') as ok",
      );
      return result.rows[0]?.ok;
    });
    expect(canWhileActive).toBe(true);

    // La même délégation, échue.
    await pool.query(
      `update public.validation_delegations
          set starts_at = current_date - 30, ends_at = current_date - 1
        where delegate_id = '${USER.delegate}'`,
    );

    const canAfterEnd = await asUser(USER.delegate, async (client) => {
      const result = await client.query<{ ok: boolean }>(
        "select public.has_permission('occurrence.validate') as ok",
      );
      return result.rows[0]?.ok;
    });
    expect(canAfterEnd).toBe(false);

    await pool.query(
      `delete from public.validation_delegations where delegate_id = '${USER.delegate}'`,
    );
  });

  it("une délégation de plus de 90 jours est rejetée", async () => {
    await expect(
      pool.query(
        `insert into public.validation_delegations
           (delegator_id, delegate_id, starts_at, ends_at, reason)
         values ('${USER.comptaManager}', '${USER.delegate}',
                 current_date, current_date + 120, 'Trop long')`,
      ),
    ).rejects.toThrow();
  });
});

describe("journal d'audit inaltérable", () => {
  it("personne, y compris service_role, ne modifie occurrence_transitions", async () => {
    await expect(
      asServiceRole((client) =>
        client.query("update public.occurrence_transitions set reason = 'falsification'"),
      ),
    ).rejects.toThrow();

    await expect(
      asServiceRole((client) => client.query("delete from public.occurrence_transitions")),
    ).rejects.toThrow();
  });

  it("un utilisateur authentifié ne peut pas non plus y écrire", async () => {
    await expect(
      asUser(USER.comptaAgent, (client) =>
        client.query(
          `insert into public.occurrence_transitions (occurrence_id, to_status)
           values ('${OCCURRENCE.fiscal}', 'ARCHIVED')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("le journal se remplit malgré tout, par trigger", async () => {
    const written = await asUser(USER.comptaAgent, async (client) => {
      await client.query(
        `update public.obligation_occurrences set status = 'IN_PROGRESS'
           where id = '${OCCURRENCE.fiscal}'`,
      );
      return countRows(
        client,
        `select count(*) from public.occurrence_transitions
          where occurrence_id = '${OCCURRENCE.fiscal}' and to_status = 'IN_PROGRESS'`,
      );
    });
    expect(written).toBe(1);
  });
});

describe("couverture RLS", () => {
  it("aucune table publique sans RLS", async () => {
    const result = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(result.rows.map((row) => row.tablename)).toEqual([]);
  });

  it("aucune politique FOR ALL ni USING (true)", async () => {
    const result = await pool.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public'
          and (cmd = 'ALL' or qual = 'true' or with_check = 'true')`,
    );
    expect(result.rows.map((row) => row.policyname)).toEqual([]);
  });
});
