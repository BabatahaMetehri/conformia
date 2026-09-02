// @vitest-environment node

/**
 * Exports et sauvegardes, contre la vraie base.
 *
 * Trois choses ne se testent QUE d'ici : qu'un export ne franchit pas le
 * cloisonnement par domaine, qu'on ne peut pas exporter au nom d'un collègue, et
 * que l'absence de sauvegarde finit par réveiller quelqu'un. Les trois sont des
 * règles PostgreSQL ; les éprouver avec des doublures testerait ma
 * compréhension, pas la règle.
 */

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 4 });

const USER = {
  compta: "eeee0000-0000-0000-0000-00000000e001",
  rh: "eeee0000-0000-0000-0000-00000000e002",
  admin: "eeee0000-0000-0000-0000-00000000e003",
  direction: "eeee0000-0000-0000-0000-00000000e004",
} as const;

const OBLIGATION = {
  fiscal: "eeee1111-0000-0000-0000-00000000f001",
  social: "eeee1111-0000-0000-0000-00000000f002",
} as const;

const OCCURRENCE = {
  fiscal: "eeee2222-0000-0000-0000-000000002001",
  social: "eeee2222-0000-0000-0000-000000002002",
} as const;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const CLEANUP = `
delete from public.notifications where recipient_id in (${IDS});
delete from public.export_runs where requested_by in (${IDS});
delete from public.occurrence_transitions where occurrence_id in ('${OCCURRENCE.fiscal}', '${OCCURRENCE.social}');
delete from public.obligation_occurrences where id in ('${OCCURRENCE.fiscal}', '${OCCURRENCE.social}');
delete from public.obligation_types where id in ('${OBLIGATION.fiscal}', '${OBLIGATION.social}');
delete from public.calendar_feed_tokens where user_id in (${IDS});
delete from public.user_roles where user_id in (${IDS});
delete from public.profiles where id in (${IDS});
delete from auth.users where id in (${IDS});
`;

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.compta}'::uuid,   'exp.compta@test.dz'),
  ('${USER.rh}'::uuid,       'exp.rh@test.dz'),
  ('${USER.admin}'::uuid,    'exp.admin@test.dz'),
  ('${USER.direction}'::uuid,'exp.direction@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id) values
  ('${USER.compta}',   (select id from public.roles where code='COMPTA_MANAGER'),
                       (select id from public.domains where code='FISCAL')),
  ('${USER.rh}',       (select id from public.roles where code='RH_MANAGER'),
                       (select id from public.domains where code='SOCIAL')),
  ('${USER.admin}',    (select id from public.roles where code='ADMIN'), null),
  ('${USER.direction}',(select id from public.roles where code='DIRECTION'), null)
on conflict do nothing;

insert into public.obligation_types
  (id, code, name, domain_id, periodicity, due_rule, internal_lead_days,
   criticality, effective_from, is_active)
values
  ('${OBLIGATION.fiscal}', 'EXP-FISC', 'Obligation fiscale de test',
   (select id from public.domains where code='FISCAL'), 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}', 5, 'HIGH', '2020-01-01', true),
  ('${OBLIGATION.social}', 'EXP-SOC', 'Obligation sociale de test',
   (select id from public.domains where code='SOCIAL'), 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}', 5, 'HIGH', '2020-01-01', true)
on conflict (id) do nothing;

insert into public.obligation_occurrences
  (id, obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, submitted_at)
values
  ('${OCCURRENCE.fiscal}', '${OBLIGATION.fiscal}', '2026-01', '2026-01-01', '2026-01-31',
   '2026-02-20', '2026-02-15', 'SUBMITTED', '2026-02-25T10:00:00Z'),
  ('${OCCURRENCE.social}', '${OBLIGATION.social}', '2026-01', '2026-01-01', '2026-01-31',
   '2026-02-20', '2026-02-15', 'SUBMITTED', '2026-02-18T10:00:00Z')
on conflict (id) do nothing;
`;

async function withTriggersOff<T>(run: () => Promise<T>): Promise<T> {
  await pool.query(
    "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
  );
  try {
    return await run();
  } finally {
    await pool.query(
      "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
    );
  }
}

/** Exécute `run` sous l'identité `userId`, dans une transaction annulée. */
async function asUser<T>(userId: string, run: (pg: PoolClient) => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  try {
    await connection.query("begin");
    await connection.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await connection.query("set local role authenticated");
    return await run(connection);
  } finally {
    await connection.query("rollback").catch(() => undefined);
    connection.release();
  }
}

beforeAll(async () => {
  await withTriggersOff(async () => {
    await pool.query(CLEANUP).catch(() => undefined);
  });
  await pool.query(SEED);
}, 120_000);

beforeEach(async () => {
  await pool.query("delete from public.backup_runs");
  await pool.query(`delete from public.notifications where recipient_id in (${IDS})`);
});

afterAll(async () => {
  try {
    await withTriggersOff(async () => {
      await pool.query(CLEANUP);
    });
    await pool.query("delete from public.backup_runs");
  } finally {
    await pool.end();
  }
}, 120_000);

// ═════════════════════════════════════════════════════════════════════════════

describe("cloisonnement des exports", () => {
  it("UN RH QUI EXPORTE « TOUT » N'OBTIENT QUE LE DOMAINE SOCIAL", async () => {
    const { rows } = await pool.query<{ domain_code: string; obligation_code: string }>(
      "select domain_code, obligation_code from public.exportable_occurrences($1::uuid)",
      [USER.rh],
    );

    // Aucun filtre : « tout », au sens où l'utilisateur l'entend.
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.domain_code))).toEqual(new Set(["SOCIAL"]));
    expect(rows.map((row) => row.obligation_code)).not.toContain("EXP-FISC");
  });

  it("le comptable, symétriquement, ne voit pas le social", async () => {
    const { rows } = await pool.query<{ domain_code: string }>(
      "select domain_code from public.exportable_occurrences($1::uuid)",
      [USER.compta],
    );
    expect(new Set(rows.map((row) => row.domain_code))).toEqual(new Set(["FISCAL"]));
  });

  it("ON NE PEUT PAS EXPORTER AU NOM D'UN COLLÈGUE", async () => {
    /*
     * ⚠️ La fonction paramétrée est révoquée pour les sessions. Sans cette
     * révocation, n'importe quel utilisateur connecté aurait passé l'identifiant
     * d'un collègue en argument et lu son périmètre — un cloisonnement par
     * domaine annulé par un paramètre.
     */
    await expect(
      asUser(USER.rh, (pg) =>
        pg.query("select * from public.exportable_occurrences($1::uuid)", [USER.compta]),
      ),
    ).rejects.toThrow();
  });

  it("le raccourci de session impose le profil courant", async () => {
    const rows = await asUser(USER.rh, async (pg) => {
      const result = await pg.query<{ domain_code: string }>(
        "select domain_code from public.my_exportable_occurrences()",
      );
      return result.rows;
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.domain_code))).toEqual(new Set(["SOCIAL"]));
  });

  it("les deux surfaces exposent EXACTEMENT les mêmes colonnes", async () => {
    /*
     * La signature du raccourci est répétée à la main : une fonction
     * `returns table` ne crée aucun type composite nommé, donc rien à réutiliser.
     * PostgreSQL modélise ces colonnes en paramètres de mode OUT — c'est par là
     * qu'on les compare, et c'est ce qui met la duplication sous surveillance.
     */
    const columnsOf = async (name: string): Promise<string[]> => {
      const { rows } = await pool.query<{ parameter_name: string }>(
        `select p.parameter_name
         from information_schema.parameters p
         join information_schema.routines r
           on r.specific_name = p.specific_name
          and r.specific_schema = p.specific_schema
         where p.specific_schema = 'public'
           and r.routine_name = $1
           and p.parameter_mode = 'OUT'
         order by p.ordinal_position`,
        [name],
      );
      return rows.map((row) => row.parameter_name);
    };

    const parameterised = await columnsOf("exportable_occurrences");
    const facade = await columnsOf("my_exportable_occurrences");

    expect(facade).toEqual(parameterised);
    expect(facade.length).toBeGreaterThan(10);
  });
});

describe("journal des exports", () => {
  it("refuse d'ouvrir un export sans la permission", async () => {
    /*
     * ⚠️ L'ADMIN, et pas la DIRECTION. La matrice de rôles prive délibérément
     * l'administrateur technique des permissions métier : il gère les comptes,
     * pas les dossiers. Un export lui donnerait par la bande le contenu qu'on
     * lui refuse partout ailleurs.
     */
    await expect(
      asUser(USER.admin, (pg) =>
        pg.query("select public.start_export_run('OCCURRENCES', 'XLSX', '{}'::jsonb)"),
      ),
    ).rejects.toThrow(/export\.generate/);
  });

  it("le comptable ouvre bien un export, lui", async () => {
    const runId = await asUser(USER.compta, async (pg) => {
      const result = await pg.query<{ start_export_run: string }>(
        "select public.start_export_run('OCCURRENCES', 'XLSX', '{}'::jsonb)",
      );
      return result.rows[0]?.start_export_run;
    });
    expect(runId).toBeDefined();
  });

  it("chacun lit ses propres exports, et rien de plus", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.export_runs (requested_by, kind, format, scope)
       values ($1, 'OCCURRENCES', 'XLSX', '{}'::jsonb) returning id`,
      [USER.compta],
    );
    const persisted = rows[0]?.id;
    expect(persisted).toBeDefined();

    const seenByOwner = await asUser(USER.compta, async (pg) => {
      const result = await pg.query<{ count: string }>(
        "select count(*) from public.export_runs where id = $1",
        [persisted],
      );
      return Number(result.rows[0]?.count ?? "0");
    });
    const seenByOther = await asUser(USER.rh, async (pg) => {
      const result = await pg.query<{ count: string }>(
        "select count(*) from public.export_runs where id = $1",
        [persisted],
      );
      return Number(result.rows[0]?.count ?? "0");
    });

    expect(seenByOwner).toBe(1);
    expect(seenByOther).toBe(0);
  });

  it("n'offre à la tâche de fond que les demandes récentes", async () => {
    await pool.query(
      `insert into public.export_runs (requested_by, kind, format, scope, is_async, started_at)
       values ($1, 'PERIOD', 'ZIP', '{}'::jsonb, true, now()),
              ($1, 'PERIOD', 'ZIP', '{}'::jsonb, true, now() - interval '9 hours')`,
      [USER.compta],
    );

    const { rows } = await pool.query<{ id: string }>(
      "select id from public.pending_async_exports()",
    );

    // Une demande de neuf heures est le reste d'une tâche interrompue : la
    // reprendre reconstruirait un export que plus personne n'attend.
    expect(rows).toHaveLength(1);
  });
});

describe("⚠️ alerte de sauvegarde périmée", () => {
  it("SIMULER 40 HEURES SANS SAUVEGARDE DÉCLENCHE L'ALERTE", async () => {
    await pool.query(
      `insert into public.backup_runs (status, kind, started_at, finished_at)
       values ('SUCCEEDED', 'DAILY', now() - interval '40 hours', now() - interval '40 hours')`,
    );

    const { rows } = await pool.query<{ notify_admins_of_stale_backup: number }>(
      "select public.notify_admins_of_stale_backup(36)",
    );

    expect(rows[0]?.notify_admins_of_stale_backup).toBeGreaterThan(0);

    const alerts = await pool.query<{ recipient_id: string; channel: string }>(
      `select recipient_id, channel from public.notifications
       where kind = 'BACKUP_FAILURE' and recipient_id in (${IDS})`,
    );

    // ADMIN et DIRECTION, sur les deux canaux : c'est le message qu'il ne faut
    // pas manquer, et l'application seule ne suffit pas à le faire voir.
    expect(new Set(alerts.rows.map((row) => row.recipient_id))).toEqual(
      new Set([USER.admin, USER.direction]),
    );
    expect(new Set(alerts.rows.map((row) => row.channel))).toEqual(new Set(["EMAIL", "IN_APP"]));
  });

  it("une sauvegarde récente ne déclenche RIEN", async () => {
    await pool.query(
      `insert into public.backup_runs (status, kind, started_at, finished_at)
       values ('SUCCEEDED', 'DAILY', now() - interval '5 hours', now() - interval '5 hours')`,
    );

    const { rows } = await pool.query<{ notify_admins_of_stale_backup: number }>(
      "select public.notify_admins_of_stale_backup(36)",
    );
    expect(rows[0]?.notify_admins_of_stale_backup).toBe(0);
  });

  it("AUCUNE SAUVEGARDE, JAMAIS, déclenche l'alerte au même titre", async () => {
    /*
     * ⚠️ Le cas d'une installation neuve, et celui qu'il ne faut surtout pas
     * taire : une table vide traitée comme « tout va bien » est la forme la plus
     * pure du dispositif décoratif.
     */
    const { rows } = await pool.query<{ notify_admins_of_stale_backup: number }>(
      "select public.notify_admins_of_stale_backup(36)",
    );
    expect(rows[0]?.notify_admins_of_stale_backup).toBeGreaterThan(0);

    const reason = await pool.query<{ reason: string }>(
      `select reason from public.notifications
       where kind = 'BACKUP_FAILURE' and recipient_id = $1 limit 1`,
      [USER.admin],
    );
    expect(reason.rows[0]?.reason).toBe("JAMAIS");
  });

  it("une sauvegarde ÉCHOUÉE ne compte pas comme une sauvegarde", async () => {
    await pool.query(
      `insert into public.backup_runs (status, kind, started_at, finished_at)
       values ('FAILED', 'DAILY', now() - interval '1 hour', now() - interval '1 hour')`,
    );

    const { rows } = await pool.query<{ notify_admins_of_stale_backup: number }>(
      "select public.notify_admins_of_stale_backup(36)",
    );
    expect(rows[0]?.notify_admins_of_stale_backup).toBeGreaterThan(0);
  });

  it("NE SE RÉPÈTE PAS toutes les heures", async () => {
    const first = await pool.query<{ notify_admins_of_stale_backup: number }>(
      "select public.notify_admins_of_stale_backup(36)",
    );
    const second = await pool.query<{ notify_admins_of_stale_backup: number }>(
      "select public.notify_admins_of_stale_backup(36)",
    );

    expect(first.rows[0]?.notify_admins_of_stale_backup).toBeGreaterThan(0);
    /*
     * ⚠️ Le cycle est horaire. Sans cette garde, vingt-quatre alertes par jour et
     * par personne — et une alerte répétée toutes les heures n'est plus lue au
     * bout de deux jours. On perdrait précisément le message qu'on veut faire
     * passer.
     */
    expect(second.rows[0]?.notify_admins_of_stale_backup).toBe(0);
  });
});

describe("journal des sauvegardes", () => {
  it("ouvre puis clôt une exécution, avec son empreinte et sa destination", async () => {
    const opened = await pool.query<{ start_backup_run: number }>(
      "select public.start_backup_run('DAILY')",
    );
    const id = opened.rows[0]?.start_backup_run;
    expect(id).toBeDefined();

    const sha = "a".repeat(64);
    await pool.query("select public.finish_backup_run($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      id,
      "SUCCEEDED",
      1024,
      512,
      512,
      2,
      sha,
      "/srv/backups/conformia.tar.enc",
      null,
    ]);
    await pool.query("select public.mark_backup_verified($1)", [id]);

    const { rows } = await pool.query<{
      status: string;
      sha256: string;
      verified_at: string | null;
      encrypted: boolean;
    }>("select status, sha256, verified_at, encrypted from public.backup_runs where id = $1", [id]);

    expect(rows[0]?.status).toBe("SUCCEEDED");
    expect(rows[0]?.sha256).toBe(sha);
    // ⚠️ `verified_at` n'est posé qu'après RELECTURE à destination : un transfert
    // qui rend « OK » sans que personne ne relise le fichier produit exactement
    // la sauvegarde illisible qu'on découvre le jour de la restauration.
    expect(rows[0]?.verified_at).not.toBeNull();
    expect(rows[0]?.encrypted).toBe(true);
  });

  it("refuse une empreinte qui n'en est pas une", async () => {
    const opened = await pool.query<{ start_backup_run: number }>(
      "select public.start_backup_run('MANUAL')",
    );
    await expect(
      pool.query("select public.finish_backup_run($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        opened.rows[0]?.start_backup_run,
        "SUCCEEDED",
        1,
        1,
        1,
        1,
        "pas-une-empreinte",
        "/tmp",
        null,
      ]),
    ).rejects.toThrow();
  });
});
