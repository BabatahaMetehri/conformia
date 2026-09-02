// @vitest-environment node

/**
 * Notifications, escalade et flux calendrier, contre la vraie base.
 *
 * Rien de ce qui compte ici ne se teste avec des objets simulés : la
 * déduplication est une CONTRAINTE PostgreSQL, l'escalade une résolution de
 * précédence en SQL, et le cloisonnement du flux une politique. Un test à
 * doublures vérifierait ma compréhension de ces règles, pas les règles.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";
import { buildCalendarFeed } from "@/services/notifications/calendar";
import { scheduleNotifications } from "@/services/notifications/scheduler";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 4 });

const client: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ─── Identités et objets de test ─────────────────────────────────────────────

const USER = {
  owner: "dddddddd-0000-0000-0000-00000000d001",
  head: "dddddddd-0000-0000-0000-00000000d002",
  direction: "dddddddd-0000-0000-0000-00000000d003",
  stranger: "dddddddd-0000-0000-0000-00000000d004",
} as const;

const DEPARTMENT = "dddddddd-0000-0000-0000-0000000000de";

const OBLIGATION = {
  standard: "eeeeeeee-0000-0000-0000-00000000e001",
  critical: "eeeeeeee-0000-0000-0000-00000000e002",
} as const;

const OCCURRENCE = {
  /** J-30 : un seul jalon préventif doit s'y déclencher. */
  upcoming: "ffffffff-0000-0000-0000-00000000f001",
  /** J+1 : un rappel ET le premier palier d'escalade. */
  overdue: "ffffffff-0000-0000-0000-00000000f002",
  /** CRITICAL, J+0 : la chaîne accélérée. */
  criticalDue: "ffffffff-0000-0000-0000-00000000f003",
  /** Déposée : rien ne doit partir. */
  submitted: "ffffffff-0000-0000-0000-00000000f004",
} as const;

/** Aujourd'hui à midi UTC — donc sans ambiguïté de fuseau à Alger. */
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`);

function isoDate(offsetDays: number): string {
  const date = new Date(NOW.getTime());
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const CLEANUP = `
delete from public.notifications where recipient_id in (${IDS});
delete from public.occurrence_transitions where occurrence_id in (
  ${Object.values(OCCURRENCE)
    .map((id) => `'${id}'`)
    .join(", ")});
delete from public.obligation_occurrences where id in (
  ${Object.values(OCCURRENCE)
    .map((id) => `'${id}'`)
    .join(", ")});
delete from public.obligation_types where id in ('${OBLIGATION.standard}', '${OBLIGATION.critical}');
update public.departments set head_id = null where id = '${DEPARTMENT}';
delete from public.user_notification_preferences where user_id in (${IDS});
delete from public.calendar_feed_tokens where user_id in (${IDS});
delete from public.user_roles where user_id in (${IDS});
update public.profiles set department_id = null where id in (${IDS});
delete from public.profiles where id in (${IDS});
delete from auth.users where id in (${IDS});
delete from public.departments where id = '${DEPARTMENT}';
`;

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.owner}'::uuid,     'notif.owner@test.dz'),
  ('${USER.head}'::uuid,      'notif.head@test.dz'),
  ('${USER.direction}'::uuid, 'notif.direction@test.dz'),
  ('${USER.stranger}'::uuid,  'notif.stranger@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.departments (id, code, name)
values ('${DEPARTMENT}', 'NOTIF-TEST', 'Service de test')
on conflict (id) do nothing;

-- Le responsable de service : sans lui, le palier J+3 n'aurait aucun destinataire.
update public.departments set head_id = '${USER.head}' where id = '${DEPARTMENT}';
update public.profiles set department_id = '${DEPARTMENT}' where id = '${USER.owner}';

insert into public.user_roles (user_id, role_id, domain_id) values
  ('${USER.owner}',     (select id from public.roles where code='COMPTA_AGENT'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.head}',      (select id from public.roles where code='COMPTA_MANAGER'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.direction}', (select id from public.roles where code='DIRECTION'), null),
  ('${USER.stranger}',  (select id from public.roles where code='RH_AGENT'),
                        (select id from public.domains where code='SOCIAL'))
on conflict do nothing;

insert into public.obligation_types
  (id, code, name, domain_id, authority_id, periodicity, due_rule,
   internal_lead_days, criticality, validation_levels, requires_validation,
   effective_from, is_active)
values
  ('${OBLIGATION.standard}', 'NOTIF-STD', 'Obligation de test standard',
   (select id from public.domains where code='FISCAL'),
   (select id from public.authorities limit 1),
   'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   5, 'HIGH', 1, true, '2020-01-01', true),
  ('${OBLIGATION.critical}', 'NOTIF-CRIT', 'Obligation de test critique',
   (select id from public.domains where code='FISCAL'),
   (select id from public.authorities limit 1),
   'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   7, 'CRITICAL', 1, true, '2020-01-01', true)
on conflict (id) do nothing;

insert into public.obligation_occurrences
  (id, obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, owner_id)
values
  ('${OCCURRENCE.upcoming}', '${OBLIGATION.standard}', '2099-01', '2099-01-01', '2099-01-31',
   '${isoDate(37)}', '${isoDate(30)}', 'TODO', '${USER.owner}'),
  ('${OCCURRENCE.overdue}', '${OBLIGATION.standard}', '2099-02', '2099-02-01', '2099-02-28',
   '${isoDate(6)}', '${isoDate(-1)}', 'TODO', '${USER.owner}'),
  ('${OCCURRENCE.criticalDue}', '${OBLIGATION.critical}', '2099-03', '2099-03-01', '2099-03-31',
   '${isoDate(7)}', '${isoDate(0)}', 'TODO', '${USER.owner}'),
  ('${OCCURRENCE.submitted}', '${OBLIGATION.standard}', '2099-04', '2099-04-01', '2099-04-30',
   '${isoDate(37)}', '${isoDate(30)}', 'SUBMITTED', '${USER.owner}')
on conflict (id) do nothing;

insert into public.calendar_feed_tokens (user_id)
select u.id from (values
  ('${USER.owner}'::uuid), ('${USER.head}'::uuid),
  ('${USER.direction}'::uuid), ('${USER.stranger}'::uuid)) as u(id)
on conflict (user_id) do nothing;
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

async function countNotifications(where: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*) from public.notifications where ${where}`,
    params,
  );
  return Number(rows[0]?.count ?? "0");
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
  // Chaque scénario part d'une file vide : la déduplication se prouve en
  // rejouant, pas en héritant du scénario précédent.
  await pool.query(`delete from public.notifications where recipient_id in (${IDS})`);
});

afterAll(async () => {
  try {
    await withTriggersOff(async () => {
      await pool.query(CLEANUP);
    });
  } finally {
    await pool.end();
  }
}, 120_000);

// ═════════════════════════════════════════════════════════════════════════════

describe("jalons d'alerte", () => {
  it("une occurrence à J-30 produit EXACTEMENT une notification par canal", async () => {
    const report = await scheduleNotifications(client, NOW);
    expect(report.ok).toBe(true);

    const rows = await pool.query<{ channel: string; kind: string }>(
      "select channel, kind from public.notifications where occurrence_id = $1 order by channel",
      [OCCURRENCE.upcoming],
    );

    // Les règles par défaut portent J-30 sur EMAIL et IN_APP, audience OWNER.
    expect(rows.rows.map((row) => row.channel)).toEqual(["EMAIL", "IN_APP"]);
    expect(new Set(rows.rows.map((row) => row.kind))).toEqual(new Set(["UPCOMING_DEADLINE"]));
  });

  it("LE REJEU NE CRÉE AUCUN DOUBLON", async () => {
    await scheduleNotifications(client, NOW);
    const first = await countNotifications("occurrence_id = $1", [OCCURRENCE.upcoming]);

    const replay = await scheduleNotifications(client, NOW);
    const second = await countNotifications("occurrence_id = $1", [OCCURRENCE.upcoming]);

    expect(second).toBe(first);
    /*
     * ⚠️ Et la seconde exécution le SAIT. Ce n'est pas un hasard silencieux : la
     * base a refusé les insertions, et le rapport les compte comme doublons
     * évités. C'est cette mesure qui prouvera l'idempotence en exploitation,
     * quand personne ne comptera plus les lignes à la main.
     */
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.value.duplicates).toBeGreaterThan(0);
      expect(replay.value.created).toBe(0);
    }
  });

  it("un dossier DÉPOSÉ ne produit rien, même à J-30", async () => {
    await scheduleNotifications(client, NOW);
    expect(await countNotifications("occurrence_id = $1", [OCCURRENCE.submitted])).toBe(0);
  });

  it("respecte la préférence de canal du destinataire", async () => {
    await pool.query(
      `insert into public.user_notification_preferences (user_id, channel, is_enabled)
       values ($1, 'EMAIL', false)
       on conflict (user_id, channel) do update set is_enabled = false`,
      [USER.owner],
    );

    try {
      await scheduleNotifications(client, NOW);
      const emails = await countNotifications(
        "recipient_id = $1 and channel = 'EMAIL' and occurrence_id = $2",
        [USER.owner, OCCURRENCE.upcoming],
      );
      const inApp = await countNotifications(
        "recipient_id = $1 and channel = 'IN_APP' and occurrence_id = $2",
        [USER.owner, OCCURRENCE.upcoming],
      );

      expect(emails).toBe(0);
      // Couper un canal n'en coupe pas un autre : c'est tout l'intérêt d'avoir
      // une ligne par canal plutôt qu'une notification à deux sorties.
      expect(inApp).toBe(1);
    } finally {
      await pool.query("delete from public.user_notification_preferences where user_id = $1", [
        USER.owner,
      ]);
    }
  });

  it("ne produit JAMAIS de candidate sur le canal SMS, non implémenté", async () => {
    await scheduleNotifications(client, NOW);
    expect(await countNotifications("channel = 'SMS'")).toBe(0);
  });
});

describe("chaîne d'escalade", () => {
  it("déclenche le premier palier — le responsable — à J+1", async () => {
    await scheduleNotifications(client, NOW);

    const rows = await pool.query<{ recipient_id: string }>(
      `select distinct recipient_id from public.notifications
       where occurrence_id = $1 and escalation_policy_id is not null`,
      [OCCURRENCE.overdue],
    );

    expect(rows.rows.map((row) => row.recipient_id)).toEqual([USER.owner]);
  });

  it("la variante CRITICAL est ACCÉLÉRÉE : deux niveaux dès J+0", async () => {
    await scheduleNotifications(client, NOW);

    const rows = await pool.query<{ recipient_id: string }>(
      `select distinct recipient_id from public.notifications
       where occurrence_id = $1 and escalation_policy_id is not null
       order by recipient_id`,
      [OCCURRENCE.criticalDue],
    );

    /*
     * ⚠️ Le responsable ET le responsable de service, le jour même — là où la
     * chaîne standard aurait attendu J+1 puis J+3. C'est le seul comportement
     * qui distingue une obligation critique d'une autre, et il est en données :
     * aucune ligne de TypeScript ne mentionne « CRITICAL ».
     */
    expect(rows.rows.map((row) => row.recipient_id).toSorted()).toEqual(
      [USER.owner, USER.head].toSorted(),
    );
  });

  it("n'applique PAS la chaîne standard à une occurrence CRITICAL", async () => {
    await scheduleNotifications(client, NOW);

    const { rows } = await pool.query<{ days_after_due: number }>(
      `select distinct e.days_after_due
       from public.notifications n
       join public.escalation_policies e on e.id = n.escalation_policy_id
       where n.occurrence_id = $1`,
      [OCCURRENCE.criticalDue],
    );

    // La chaîne la plus spécifique remplace l'autre EN BLOC. Les mélanger
    // donnerait J+0, J+1, J+2, J+3, J+7 — cinq escalades pour trois paliers.
    expect(rows.map((row) => row.days_after_due)).toEqual([0]);
  });

  it("l'escalade est dédupliquée elle aussi, sur SA politique", async () => {
    await scheduleNotifications(client, NOW);
    const first = await countNotifications("escalation_policy_id is not null");

    await scheduleNotifications(client, NOW);
    const second = await countNotifications("escalation_policy_id is not null");

    /*
     * ⚠️ Sans son propre index d'unicité, l'escalade aurait rejoué à chaque
     * cycle horaire : vingt-quatre courriels par jour et par dossier en retard.
     * La clé de déduplication des jalons ne l'aurait pas couverte, puisque
     * `rule_id` y est NULL.
     */
    expect(second).toBe(first);
  });
});

describe("le canal in-app ne dépend pas du courriel", () => {
  it("les notifications in-app sont visibles SANS qu'aucun envoi ait eu lieu", async () => {
    await scheduleNotifications(client, NOW);

    const { rows } = await pool.query<{ sent_at: string | null }>(
      `select sent_at from public.notifications
       where channel = 'IN_APP' and recipient_id = $1`,
      [USER.owner],
    );

    expect(rows.length).toBeGreaterThan(0);
    /*
     * ⚠️ Le critère « une panne du fournisseur n'empêche pas les notifications
     * in-app » est tenu par la STRUCTURE, pas par une gestion d'erreur : le
     * planificateur écrit, le diffuseur envoie. Aucune ligne in-app n'attend
     * quoi que ce soit d'un service tiers — elles n'ont même pas de date
     * d'envoi.
     */
    expect(rows.every((row) => row.sent_at === null)).toBe(true);

    const visible = await asUser(USER.owner, async (pg) => {
      const result = await pg.query<{ count: string }>(
        "select count(*) from public.notifications where channel = 'IN_APP'",
      );
      return Number(result.rows[0]?.count ?? "0");
    });
    expect(visible).toBeGreaterThan(0);
  });

  it("chacun ne lit QUE son propre courrier", async () => {
    await scheduleNotifications(client, NOW);

    const seenByStranger = await asUser(USER.stranger, async (pg) => {
      const result = await pg.query<{ count: string }>(
        "select count(*) from public.notifications where recipient_id = $1",
        [USER.owner],
      );
      return Number(result.rows[0]?.count ?? "0");
    });

    expect(seenByStranger).toBe(0);
  });

  it("l'état de LIVRAISON n'appartient pas à l'utilisateur", async () => {
    await scheduleNotifications(client, NOW);
    const { rows } = await pool.query<{ id: string }>(
      "select id from public.notifications where recipient_id = $1 limit 1",
      [USER.owner],
    );
    const id = rows[0]?.id;
    expect(id).toBeDefined();

    // Marquer lu : permis. Se déclarer envoyé : refusé.
    await expect(
      asUser(USER.owner, (pg) =>
        pg.query("update public.notifications set read_at = now() where id = $1", [id]),
      ),
    ).resolves.toBeDefined();

    await expect(
      asUser(USER.owner, (pg) =>
        pg.query("update public.notifications set sent_at = now() where id = $1", [id]),
      ),
    ).rejects.toThrow();
  });
});

describe("flux calendrier", () => {
  async function tokenOf(userId: string): Promise<string> {
    const { rows } = await pool.query<{ token: string }>(
      "select token from public.calendar_feed_tokens where user_id = $1",
      [userId],
    );
    const token = rows[0]?.token;
    if (token === undefined) throw new Error("jeton absent");
    return token;
  }

  it("montre au porteur les occurrences qu'il peut voir", async () => {
    const feed = await buildCalendarFeed(await tokenOf(USER.owner), NOW);
    expect(feed.ok).toBe(true);
    if (feed.ok) {
      expect(feed.value).toContain(OCCURRENCE.upcoming);
      expect(feed.value).toContain("BEGIN:VCALENDAR");
    }
  });

  it("NE MONTRE PAS les occurrences d'un autre domaine", async () => {
    const feed = await buildCalendarFeed(await tokenOf(USER.stranger), NOW);
    expect(feed.ok).toBe(true);
    if (feed.ok) {
      // Le RH ne voit pas le fiscal — la même frontière que dans l'application,
      // parce que c'est le même prédicat.
      expect(feed.value).not.toContain(OCCURRENCE.upcoming);
    }
  });

  it("ne laisse fuir AUCUNE donnée confidentielle", async () => {
    const feed = await buildCalendarFeed(await tokenOf(USER.owner), NOW);
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;

    // Ni pièce jointe, ni participant : un flux iCalendar sait porter les deux,
    // et ce flux ne doit jamais en porter.
    expect(feed.value).not.toContain("ATTACH");
    expect(feed.value).not.toContain("ATTENDEE");
  });

  it("RÉGÉNÉRER LE JETON INVALIDE L'ANCIEN FLUX IMMÉDIATEMENT", async () => {
    const before = await tokenOf(USER.owner);

    await asUser(USER.owner, (pg) => pg.query("select public.regenerate_ics_token()"));
    // La transaction ci-dessus est annulée : on rejoue la rotation pour de bon.
    await pool.query(
      `update public.calendar_feed_tokens set token = gen_random_uuid(), rotated_at = now()
       where user_id = $1`,
      [USER.owner],
    );

    const after = await tokenOf(USER.owner);
    expect(after).not.toBe(before);

    const stale = await buildCalendarFeed(before, NOW);
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      /*
       * ⚠️ Aucune période de grâce. Un jeton qu'on révoque parce qu'il a fuité
       * doit mourir tout de suite — et un calendrier VIDE, plutôt qu'une erreur,
       * pour qu'un jeton inconnu ne devienne pas un oracle de validité.
       */
      expect(stale.value).not.toContain("BEGIN:VEVENT");
      expect(stale.value).toContain("BEGIN:VCALENDAR");
    }

    const fresh = await buildCalendarFeed(after, NOW);
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.value).toContain(OCCURRENCE.upcoming);
  });

  it("un jeton inconnu rend un calendrier vide, pas une erreur", async () => {
    const feed = await buildCalendarFeed("00000000-0000-0000-0000-000000000000", NOW);
    expect(feed.ok).toBe(true);
    if (feed.ok) expect(feed.value).not.toContain("BEGIN:VEVENT");
  });

  it("le jeton d'autrui est ILLISIBLE, même pour un administrateur", async () => {
    /*
     * ⚠️ Le défaut que la table satellite corrige. Posé sur `profiles`, le jeton
     * aurait été lisible par tout détenteur de `user.manage` et par tout collègue
     * partageant une occurrence — c'est-à-dire par des gens qui auraient pu
     * s'abonner à l'agenda d'un autre.
     */
    const visible = await asUser(USER.direction, async (pg) => {
      const result = await pg.query<{ count: string }>(
        "select count(*) from public.calendar_feed_tokens where user_id = $1",
        [USER.owner],
      );
      return Number(result.rows[0]?.count ?? "0");
    });
    expect(visible).toBe(0);
  });
});

describe("parité du cloisonnement", () => {
  it("can_see_occurrence et can_see_occurrence_for rendent le MÊME verdict", async () => {
    /*
     * ⚠️ LE GARDE-FOU PROMIS PAR LA MIGRATION 0014.
     *
     * Les deux fonctions portent le même prédicat, recopié : la version de
     * session ne délègue pas à la version paramétrée, parce que l'indirection
     * coûtait des secondes sur la politique RLS des occurrences (mesuré : le
     * compteur de la file de validation passait de 92 ms à plus de 30 s). La
     * duplication est donc assumée — et gardée ici, mécaniquement.
     */
    const occurrences = Object.values(OCCURRENCE);
    const users = Object.values(USER);

    for (const userId of users) {
      const viaSession = await asUser(userId, async (pg) => {
        const result = await pg.query<{ id: string; visible: boolean }>(
          `select o.id, public.can_see_occurrence(o.id) as visible
           from unnest($1::uuid[]) as o(id) order by o.id`,
          [occurrences],
        );
        return result.rows;
      });

      const viaParameter = await pool.query<{ id: string; visible: boolean }>(
        `select o.id, public.can_see_occurrence_for($1::uuid, o.id) as visible
         from unnest($2::uuid[]) as o(id) order by o.id`,
        [userId, occurrences],
      );

      expect(viaSession).toEqual(viaParameter.rows);
    }
  });
});
