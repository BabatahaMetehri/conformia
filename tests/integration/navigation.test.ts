// @vitest-environment node

/**
 * Navigation et recherche, éprouvées contre la BASE.
 *
 * Ce fichier existe parce que `tests/unit/navigation.test.ts` ne prouve rien
 * d'utile à lui seul : il vérifie le filtre contre des ensembles de permissions
 * que j'ai écrits moi-même. La question qui compte — « que voit réellement un
 * RH_AGENT ? » — n'a de réponse que dans la matrice rôle → permissions, qui est
 * une donnée en base.
 *
 * On lit donc les permissions effectives depuis PostgreSQL, sous l'identité de
 * l'utilisateur, puis on les passe au MÊME filtre que l'application. Et pour la
 * recherche, on interroge `global_search()` sous chaque identité : le
 * cloisonnement par domaine se vérifie sur des lignes, pas sur une lecture de
 * politique.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls`.
 */

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { filterNavigation, flattenNavigation, NAVIGATION } from "@/config/navigation";
import { isPermission, type Permission } from "@/config/permissions";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 8 });

const USER = {
  rhAgent: "dddddddd-0000-0000-0000-00000000d001",
  comptaAgent: "dddddddd-0000-0000-0000-00000000d002",
  admin: "dddddddd-0000-0000-0000-00000000d003",
  direction: "dddddddd-0000-0000-0000-00000000d004",
  auditor: "dddddddd-0000-0000-0000-00000000d005",
} as const;

const OBLIGATION = {
  fiscal: "eeeeeeee-0000-0000-0000-00000000e001",
  social: "eeeeeeee-0000-0000-0000-00000000e002",
} as const;

const OCCURRENCE = {
  fiscal: "ffffffff-0000-0000-0000-00000000f001",
  social: "ffffffff-0000-0000-0000-00000000f002",
} as const;

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.rhAgent}'::uuid,     'nav.rh@test.dz'),
  ('${USER.comptaAgent}'::uuid, 'nav.compta@test.dz'),
  ('${USER.admin}'::uuid,       'nav.admin@test.dz'),
  ('${USER.direction}'::uuid,   'nav.direction@test.dz'),
  ('${USER.auditor}'::uuid,     'nav.auditor@test.dz')
) as u(id, email)
on conflict (id) do nothing;

-- AUDITOR est un rôle à durée bornée : le trigger enforce_role_max_duration
-- refuse une attribution sans échéance. Le test doit s'y plier comme la
-- production — le contourner reviendrait à tester une règle désactivée.
insert into public.user_roles (user_id, role_id, domain_id, expires_at)
values
  ('${USER.rhAgent}',     (select id from public.roles where code='RESPONSABLE'),
                          (select id from public.domains where code='SOCIAL'), null),
  ('${USER.comptaAgent}', (select id from public.roles where code='RESPONSABLE'),
                          (select id from public.domains where code='FISCAL'), null),
  ('${USER.admin}',       (select id from public.roles where code='ADMIN'), null, null),
  ('${USER.direction}',   (select id from public.roles where code='DIRECTION'), null, null),
  ('${USER.auditor}',     (select id from public.roles where code='AUDITOR'), null,
                          now() + interval '30 days');

insert into public.obligation_types (id, code, name, periodicity, due_rule, effective_from, domain_id)
values
  ('${OBLIGATION.fiscal}', 'NAV-G50', 'Déclaration G50 mensuelle', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
   (select id from public.domains where code='FISCAL')),
  ('${OBLIGATION.social}', 'NAV-CNAS', 'Déclaration CNAS trimestrielle', 'QUARTERLY',
   '{"anchor":"PERIOD_END","offset_days":30}'::jsonb, '2026-01-01',
   (select id from public.domains where code='SOCIAL'));

insert into public.obligation_occurrences
  (id, obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, owner_id, status)
values
  ('${OCCURRENCE.fiscal}', '${OBLIGATION.fiscal}', '2026-01', '2026-01-01', '2026-01-31',
   '2026-02-20', '2026-02-17', '${USER.comptaAgent}', 'TODO'),
  ('${OCCURRENCE.social}', '${OBLIGATION.social}', '2026-Q1', '2026-01-01', '2026-03-31',
   '2026-04-30', '2026-04-27', '${USER.rhAgent}', 'TODO');
`;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const CLEANUP = `
delete from public.occurrence_transitions where occurrence_id in (
  '${OCCURRENCE.fiscal}', '${OCCURRENCE.social}');
delete from public.obligation_occurrences where id in (
  '${OCCURRENCE.fiscal}', '${OCCURRENCE.social}');
delete from public.obligation_types where id in ('${OBLIGATION.fiscal}', '${OBLIGATION.social}');
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

/**
 * Permissions EFFECTIVES telles que la base les accorde.
 *
 * Interrogées via `public.has_permission()` — la fonction même dont dépendent
 * les politiques RLS. Rejouer la jointure à la main donnerait une seconde
 * définition de « qui a le droit de quoi », condamnée à diverger de celle qui
 * fait autorité.
 */
async function permissionsOf(userId: string): Promise<ReadonlySet<Permission>> {
  const rows = await asUser(userId, async (client) => {
    const result = await client.query<{ code: string }>(
      "select code from public.permissions where public.has_permission(code)",
    );
    return result.rows;
  });

  return new Set(rows.map((row) => row.code).filter(isPermission));
}

async function navigationOf(userId: string): Promise<string[]> {
  const granted = await permissionsOf(userId);
  return flattenNavigation(filterNavigation(NAVIGATION, granted)).map((item) => item.id);
}

async function searchAs(userId: string, query: string): Promise<string[]> {
  return asUser(userId, async (client) => {
    const result = await client.query<{ kind: string; title: string }>(
      "select kind, title from public.global_search($1, 5)",
      [query],
    );
    return result.rows.map((row) => `${row.kind}:${row.title}`);
  });
}

beforeAll(async () => {
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

describe("navigation visible par rôle", () => {
  it("RH_AGENT ne voit AUCUNE entrée d'administration", async () => {
    const ids = await navigationOf(USER.rhAgent);

    expect(ids).not.toContain("admin");
    expect(ids).not.toContain("admin-users");
    expect(ids).not.toContain("admin-settings");
    expect(ids).not.toContain("audit");
  });

  it("RH_AGENT voit son échéancier et ses documents", async () => {
    const ids = await navigationOf(USER.rhAgent);

    expect(ids).toContain("dashboard");
    expect(ids).toContain("my-tasks");
    expect(ids).toContain("occurrences");
    expect(ids).toContain("obligations");
    expect(ids).toContain("documents");
    // Pas de occurrence.validate : la validation appartient au manager.
    expect(ids).not.toContain("validation");
  });

  it("ADMIN ne voit ni Échéancier, ni Documents, ni À valider, ni Tableau de bord", async () => {
    const ids = await navigationOf(USER.admin);

    expect(ids).not.toContain("occurrences");
    expect(ids).not.toContain("documents");
    expect(ids).not.toContain("validation");
    expect(ids).not.toContain("dashboard");
  });

  it("ADMIN conserve l'administration complète", async () => {
    const ids = await navigationOf(USER.admin);

    expect(ids).toContain("admin");
    expect(ids).toContain("admin-users");
    expect(ids).toContain("admin-delegations");
    expect(ids).toContain("admin-settings");
    expect(ids).toContain("audit");
    expect(ids).toContain("obligations");
  });

  it("DIRECTION atteint le journal d'audit sans être administrateur", async () => {
    const ids = await navigationOf(USER.direction);

    expect(ids).toContain("audit");
    expect(ids).toContain("validation");
    // Le groupe survit par son seul enfant autorisé.
    expect(ids).toContain("admin");
    expect(ids).not.toContain("admin-users");
  });

  it("AUDITOR ne voit que de la lecture", async () => {
    const ids = await navigationOf(USER.auditor);

    expect(ids).toContain("occurrences");
    expect(ids).toContain("audit");
    expect(ids).not.toContain("validation");
    expect(ids).not.toContain("admin-users");
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("recherche globale sous RLS", () => {
  it("RH_AGENT ne trouve AUCUN objet du domaine fiscal", async () => {
    const hits = await searchAs(USER.rhAgent, "G50");
    expect(hits).toEqual([]);
  });

  it("COMPTA_AGENT trouve la même chose que le RH ne trouve pas", async () => {
    const hits = await searchAs(USER.comptaAgent, "G50");
    expect(hits).toContain("OBLIGATION:Déclaration G50 mensuelle");
    expect(hits).toContain("OCCURRENCE:Déclaration G50 mensuelle");
  });

  it("une frappe commune ne fait apparaître que le domaine de chacun", async () => {
    const rh = await searchAs(USER.rhAgent, "declaration");
    const compta = await searchAs(USER.comptaAgent, "declaration");

    expect(rh.every((hit) => hit.includes("CNAS"))).toBe(true);
    expect(compta.every((hit) => hit.includes("G50"))).toBe(true);
  });

  it("ADMIN ne trouve aucune occurrence, seulement du référentiel", async () => {
    const hits = await searchAs(USER.admin, "declaration");

    expect(hits.some((hit) => hit.startsWith("OBLIGATION:"))).toBe(true);
    expect(hits.some((hit) => hit.startsWith("OCCURRENCE:"))).toBe(false);
    expect(hits.some((hit) => hit.startsWith("DOCUMENT:"))).toBe(false);
  });

  it("la recherche est insensible à la casse et aux accents", async () => {
    const lower = await searchAs(USER.comptaAgent, "declaration");
    const accented = await searchAs(USER.comptaAgent, "DÉCLARATION");
    expect(accented).toEqual(lower);
  });

  it("retrouve une occurrence par sa clé de période", async () => {
    const hits = await searchAs(USER.comptaAgent, "2026-01");
    expect(hits).toContain("OCCURRENCE:Déclaration G50 mensuelle");
  });

  it("ne se laisse pas injecter d'opérateur tsquery", async () => {
    // Les caractères d'opérateur sont réduits à des séparateurs avant assemblage.
    await expect(searchAs(USER.comptaAgent, "' | 'a':* & !(")).resolves.toEqual([]);
    await expect(searchAs(USER.comptaAgent, "g50 | cnas")).resolves.toEqual([]);
  });

  it("rend le vide sur une saisie vide plutôt que tout le contenu", async () => {
    await expect(searchAs(USER.comptaAgent, "   ")).resolves.toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("compteurs de navigation sous RLS", () => {
  async function countersOf(userId: string) {
    return asUser(userId, async (client) => {
      const result = await client.query<{
        overdue: number;
        pending_validation: number;
        my_tasks: number;
      }>("select * from public.navigation_counters()");
      return result.rows[0];
    });
  }

  it("chacun ne compte que ses propres tâches", async () => {
    const rh = await countersOf(USER.rhAgent);
    const compta = await countersOf(USER.comptaAgent);

    expect(rh?.my_tasks).toBe(1);
    expect(compta?.my_tasks).toBe(1);
  });

  it("ADMIN compte zéro partout : il ne voit aucune occurrence", async () => {
    const counters = await countersOf(USER.admin);

    expect(counters?.overdue).toBe(0);
    expect(counters?.pending_validation).toBe(0);
    expect(counters?.my_tasks).toBe(0);
  });

  it("un compteur ne révèle pas les dossiers d'un autre domaine", async () => {
    const rh = await countersOf(USER.rhAgent);
    const direction = await countersOf(USER.direction);

    // DIRECTION est de portée globale : elle voit les deux domaines. Le RH n'en
    // voit qu'un. L'écart est exactement la preuve du cloisonnement.
    expect(direction?.overdue).toBeGreaterThan(rh?.overdue ?? 0);
  });
});
