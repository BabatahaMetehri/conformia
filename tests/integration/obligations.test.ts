// @vitest-environment node

/**
 * Référentiel des obligations, éprouvé contre la BASE.
 *
 * Trois familles de garanties ne se vérifient qu'ici :
 *   — le recalcul ne touche QUE les occurrences TODO ;
 *   — les barrières de désactivation et de suppression tiennent même quand
 *     l'appel ne passe pas par le service ;
 *   — la fonction de recalcul refuse un appelant sans droits, quoi qu'affiche
 *     l'interface.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls`.
 */

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 8 });

const USER = {
  /** referential.manage + occurrence.read global : le seul qui peut recalculer. */
  direction: "11111111-0000-0000-0000-000000000001",
  /** referential.manage sans occurrence.read : peut éditer, pas recalculer. */
  admin: "11111111-0000-0000-0000-000000000002",
  /** occurrence.read sans referential.manage : ne peut rien du référentiel. */
  comptaAgent: "11111111-0000-0000-0000-000000000003",
} as const;

const OBLIGATION = {
  parent: "22222222-0000-0000-0000-000000000001",
  child: "22222222-0000-0000-0000-000000000002",
  standalone: "22222222-0000-0000-0000-000000000003",
  archivedOnly: "22222222-0000-0000-0000-000000000004",
} as const;

/** Une occurrence par statut : le recalcul ne doit en déplacer qu'une. */
const OCCURRENCE = {
  todo: "33333333-0000-0000-0000-000000000001",
  inProgress: "33333333-0000-0000-0000-000000000002",
  validated: "33333333-0000-0000-0000-000000000003",
  archived: "33333333-0000-0000-0000-000000000004",
  locked: "33333333-0000-0000-0000-000000000005",
  archivedOnly: "33333333-0000-0000-0000-000000000006",
} as const;

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.direction}'::uuid,   'obl.direction@test.dz'),
  ('${USER.admin}'::uuid,       'obl.admin@test.dz'),
  ('${USER.comptaAgent}'::uuid, 'obl.compta@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id)
values
  ('${USER.direction}',   (select id from public.roles where code='DIRECTION'), null),
  ('${USER.admin}',       (select id from public.roles where code='ADMIN'), null),
  ('${USER.comptaAgent}', (select id from public.roles where code='COMPTA_AGENT'),
                          (select id from public.domains where code='FISCAL'));

insert into public.obligation_types
  (id, code, name, periodicity, due_rule, effective_from, domain_id, internal_lead_days)
values
  ('${OBLIGATION.parent}', 'OBL-PARENT', 'Obligation parente', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
   (select id from public.domains where code='FISCAL'), 0),
  ('${OBLIGATION.child}', 'OBL-ENFANT', 'Obligation dependante', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":25}'::jsonb, '2026-01-01',
   (select id from public.domains where code='FISCAL'), 0),
  ('${OBLIGATION.standalone}', 'OBL-SEULE', 'Obligation isolee', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":15}'::jsonb, '2026-01-01',
   (select id from public.domains where code='FISCAL'), 0),
  ('${OBLIGATION.archivedOnly}', 'OBL-ARCHIVEE', 'Obligation aux dossiers clos', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":15}'::jsonb, '2026-01-01',
   (select id from public.domains where code='FISCAL'), 0);

update public.obligation_types
   set depends_on_obligation_type_id = '${OBLIGATION.parent}'
 where id = '${OBLIGATION.child}';

insert into public.obligation_occurrences
  (id, obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, na_reason)
values
  ('${OCCURRENCE.todo}', '${OBLIGATION.parent}', '2026-01', '2026-01-01', '2026-01-31',
   '2026-02-20', '2026-02-20', 'TODO', null),
  ('${OCCURRENCE.inProgress}', '${OBLIGATION.parent}', '2026-02', '2026-02-01', '2026-02-28',
   '2026-03-20', '2026-03-20', 'IN_PROGRESS', null),
  ('${OCCURRENCE.validated}', '${OBLIGATION.parent}', '2026-03', '2026-03-01', '2026-03-31',
   '2026-04-20', '2026-04-20', 'VALIDATED', null),
  ('${OCCURRENCE.archived}', '${OBLIGATION.parent}', '2026-04', '2026-04-01', '2026-04-30',
   '2026-05-20', '2026-05-20', 'ARCHIVED', null),
  ('${OCCURRENCE.locked}', '${OBLIGATION.parent}', '2026-05', '2026-05-01', '2026-05-31',
   '2026-06-20', '2026-06-20', 'TODO', null),
  -- Seul dossier de OBL-ARCHIVEE, et il est clos : la suppression doit passer.
  ('${OCCURRENCE.archivedOnly}', '${OBLIGATION.archivedOnly}', '2026-01', '2026-01-01', '2026-01-31',
   '2026-02-15', '2026-02-15', 'ARCHIVED', null);

update public.obligation_occurrences set is_locked = true where id = '${OCCURRENCE.locked}';
`;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");
const OBLIGATION_IDS = Object.values(OBLIGATION)
  .map((id) => `'${id}'`)
  .join(", ");

const CLEANUP = `
delete from public.occurrence_transitions where occurrence_id in (
  ${Object.values(OCCURRENCE)
    .map((id) => `'${id}'`)
    .join(", ")});
delete from public.obligation_occurrences where obligation_type_id in (${OBLIGATION_IDS});
delete from public.obligation_required_documents where obligation_type_id in (${OBLIGATION_IDS});
update public.obligation_types set depends_on_obligation_type_id = null
 where id in (${OBLIGATION_IDS});
delete from public.obligation_types where id in (${OBLIGATION_IDS});
delete from public.user_roles where user_id in (${IDS});
delete from public.profiles where id in (${IDS});
delete from auth.users where id in (${IDS});
`;

async function asUser<T>(userId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    return await run(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Toutes les échéances de l'obligation parente, par statut. */
async function dueDates(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; legal_due_date: string }>(
    `select id, to_char(legal_due_date, 'YYYY-MM-DD') as legal_due_date
       from public.obligation_occurrences
      where obligation_type_id = $1`,
    [OBLIGATION.parent],
  );
  return new Map(result.rows.map((row) => [row.id, row.legal_due_date]));
}

/** Décale toutes les occurrences de l'obligation parente d'un mois. */
const SHIFTED_UPDATES = JSON.stringify(
  Object.values(OCCURRENCE).map((id) => ({
    occurrence_id: id,
    legal_due_date: "2026-12-31",
    internal_due_date: "2026-12-31",
  })),
);

async function withTriggerOff(run: () => Promise<void>): Promise<void> {
  await pool.query(
    "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
  );
  try {
    await run();
  } finally {
    await pool.query(
      "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
    );
  }
}

beforeAll(async () => {
  await withTriggerOff(async () => {
    await pool.query(CLEANUP).catch(() => undefined);
  });
  await pool.query(SEED);
}, 60_000);

afterAll(async () => {
  await withTriggerOff(async () => {
    await pool.query(CLEANUP).catch(() => undefined);
  });
  await pool.end();
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════

describe("recalcul des échéances", () => {
  it("ne déplace QUE les occurrences TODO", async () => {
    await asUser(USER.direction, async (client) => {
      const before = await dueDates(client);

      const result = await client.query<{ recalculate_todo_due_dates: number }>(
        "select public.recalculate_todo_due_dates($1, $2::jsonb)",
        [OBLIGATION.parent, SHIFTED_UPDATES],
      );

      const after = await dueDates(client);

      // Une seule ligne bouge : la TODO non verrouillée.
      expect(result.rows[0]?.recalculate_todo_due_dates).toBe(1);
      expect(after.get(OCCURRENCE.todo)).toBe("2026-12-31");

      // ⚠️ Le cœur du comportement arrêté : rien d'autre ne doit avoir bougé.
      for (const id of [OCCURRENCE.inProgress, OCCURRENCE.validated, OCCURRENCE.archived]) {
        expect(after.get(id)).toBe(before.get(id));
      }
    });
  });

  it("ne touche pas une occurrence TODO VERROUILLÉE", async () => {
    await asUser(USER.direction, async (client) => {
      const before = await dueDates(client);
      await client.query("select public.recalculate_todo_due_dates($1, $2::jsonb)", [
        OBLIGATION.parent,
        SHIFTED_UPDATES,
      ]);
      const after = await dueDates(client);

      expect(after.get(OCCURRENCE.locked)).toBe(before.get(OCCURRENCE.locked));
    });
  });

  it("refuse un appelant sans referential.manage", async () => {
    // COMPTA_AGENT voit les occurrences, mais n'administre pas le référentiel.
    await asUser(USER.comptaAgent, async (client) => {
      await expect(
        client.query("select public.recalculate_todo_due_dates($1, $2::jsonb)", [
          OBLIGATION.parent,
          SHIFTED_UPDATES,
        ]),
      ).rejects.toThrow(/referential\.manage/);
    });
  });

  it("refuse un appelant qui ne peut pas VOIR les occurrences du domaine", async () => {
    /*
     * ADMIN détient referential.manage mais pas occurrence.read : il peut donc
     * modifier la règle et NON propager le changement. Sans cette barrière, la
     * fonction SECURITY DEFINER lui donnerait une écriture sur des dossiers que
     * la RLS lui interdit même de lire.
     */
    await asUser(USER.admin, async (client) => {
      await expect(
        client.query("select public.recalculate_todo_due_dates($1, $2::jsonb)", [
          OBLIGATION.parent,
          SHIFTED_UPDATES,
        ]),
      ).rejects.toThrow(/occurrences du domaine/);
    });
  });

  it("ignore une occurrence d'une AUTRE obligation glissée dans la liste", async () => {
    await asUser(USER.direction, async (client) => {
      const result = await client.query<{ recalculate_todo_due_dates: number }>(
        "select public.recalculate_todo_due_dates($1, $2::jsonb)",
        [
          OBLIGATION.standalone,
          JSON.stringify([
            {
              occurrence_id: OCCURRENCE.todo,
              legal_due_date: "2027-01-01",
              internal_due_date: "2027-01-01",
            },
          ]),
        ],
      );
      // L'occurrence appartient à OBLIGATION.parent : la borne la rejette.
      expect(result.rows[0]?.recalculate_todo_due_dates).toBe(0);
    });
  });

  it("laisse une trace d'audit pour chaque ligne déplacée", async () => {
    await asUser(USER.direction, async (client) => {
      await client.query("select public.recalculate_todo_due_dates($1, $2::jsonb)", [
        OBLIGATION.parent,
        SHIFTED_UPDATES,
      ]);

      const audit = await client.query<{ count: string }>(
        `select count(*) from public.audit_log
          where entity_table = 'obligation_occurrences'
            and entity_id_ref = $1
            and action = 'UPDATE'`,
        [OCCURRENCE.todo],
      );
      // SECURITY DEFINER ne dispense pas d'audit : le trigger s'applique.
      expect(Number(audit.rows[0]?.count ?? "0")).toBeGreaterThan(0);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("barrières de cycle de vie", () => {
  it("refuse de désactiver une obligation dont une autre dépend", async () => {
    await asUser(USER.direction, async (client) => {
      await expect(
        client.query("update public.obligation_types set is_active = false where id = $1", [
          OBLIGATION.parent,
        ]),
      ).rejects.toThrow(/dépendent de celle-ci/);
    });
  });

  it("accepte la désactivation une fois la dépendance levée", async () => {
    await asUser(USER.direction, async (client) => {
      await client.query("update public.obligation_types set is_active = false where id = $1", [
        OBLIGATION.child,
      ]);
      await client.query("update public.obligation_types set is_active = false where id = $1", [
        OBLIGATION.parent,
      ]);

      const result = await client.query<{ is_active: boolean }>(
        "select is_active from public.obligation_types where id = $1",
        [OBLIGATION.parent],
      );
      expect(result.rows[0]?.is_active).toBe(false);
    });
  });

  it("la barrière tient même hors service : c'est un trigger", async () => {
    // Écriture directe, sans passer par src/services. La règle doit tenir.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await expect(
        client.query("update public.obligation_types set is_active = false where id = $1", [
          OBLIGATION.parent,
        ]),
      ).rejects.toThrow(/dépendent de celle-ci/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it("refuse la suppression logique tant qu'un dossier non archivé subsiste", async () => {
    await asUser(USER.direction, async (client) => {
      await expect(
        client.query("update public.obligation_types set deleted_at = now() where id = $1", [
          OBLIGATION.parent,
        ]),
      ).rejects.toThrow(/non archivé/);
    });
  });

  it("accepte la suppression logique d'une obligation sans dossier vivant", async () => {
    await asUser(USER.direction, async (client) => {
      await client.query("update public.obligation_types set deleted_at = now() where id = $1", [
        OBLIGATION.standalone,
      ]);

      const result = await client.query<{ deleted_at: string | null }>(
        "select deleted_at from public.obligation_types where id = $1",
        [OBLIGATION.standalone],
      );
      expect(result.rows[0]?.deleted_at).not.toBeNull();
    });
  });

  it("un dossier ARCHIVÉ n'empêche pas la suppression : seuls les vivants bloquent", async () => {
    /*
     * L'obligation OBL-ARCHIVEE porte une occurrence, mais elle est close.
     * L'état est POSÉ AU JEU D'ESSAI et non atteint par une transition : la
     * DIRECTION détient `referential.manage` sans `occurrence.write`, elle ne
     * peut donc pas archiver elle-même un dossier. Passer par une transition
     * ici testerait surtout la matrice de rôles, pas la barrière de suppression.
     */
    await asUser(USER.direction, async (client) => {
      await client.query("update public.obligation_types set deleted_at = now() where id = $1", [
        OBLIGATION.archivedOnly,
      ]);

      const result = await client.query<{ deleted_at: string | null }>(
        "select deleted_at from public.obligation_types where id = $1",
        [OBLIGATION.archivedOnly],
      );
      expect(result.rows[0]?.deleted_at).not.toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("écriture du référentiel sous RLS", () => {
  it("COMPTA_AGENT ne peut pas créer d'obligation", async () => {
    await asUser(USER.comptaAgent, async (client) => {
      await expect(
        client.query(
          `insert into public.obligation_types (code, name, periodicity, due_rule, effective_from)
           values ('OBL-INTERDITE', 'Tentative', 'MONTHLY',
                   '{"anchor":"PERIOD_END","offset_days":10}'::jsonb, '2026-01-01')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("COMPTA_AGENT ne peut pas modifier une obligation existante", async () => {
    await asUser(USER.comptaAgent, async (client) => {
      const result = await client.query(
        "update public.obligation_types set name = 'Detourne' where id = $1",
        [OBLIGATION.standalone],
      );
      // La policy UPDATE ne rend aucune ligne : l'écriture est sans effet.
      expect(result.rowCount).toBe(0);
    });
  });

  it("la contrainte de règle refuse un due_rule incohérent", async () => {
    await asUser(USER.direction, async (client) => {
      await expect(
        client.query(
          `insert into public.obligation_types (code, name, periodicity, due_rule, effective_from)
           values ('OBL-MAUVAISE', 'Regle absente', 'MONTHLY', '{}'::jsonb, '2026-01-01')`,
        ),
      ).rejects.toThrow(/due_rule_valid/);
    });
  });

  it("la recherche plein texte porte désormais sur la PROCÉDURE", async () => {
    await asUser(USER.direction, async (client) => {
      await client.query(
        `update public.obligation_types
            set procedure_md = 'Deposer le formulaire sur le portail Jibaya avant midi.'
          where id = $1`,
        [OBLIGATION.standalone],
      );

      const found = await client.query<{ result_id: string }>(
        "select result_id from public.global_search($1, 5) where kind = 'OBLIGATION'",
        ["jibaya"],
      );
      // Le mot n'apparaît ni dans le code ni dans le nom : seul l'index de la
      // procédure peut le retrouver.
      expect(found.rows.map((row) => row.result_id)).toContain(OBLIGATION.standalone);
    });
  });
});
