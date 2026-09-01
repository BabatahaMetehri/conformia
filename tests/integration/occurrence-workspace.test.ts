// @vitest-environment node

/**
 * Écran de travail des occurrences, éprouvé contre la BASE.
 *
 * Ce fichier porte les critères d'acceptation chiffrés : 10 000 occurrences
 * injectées, liste sous 500 ms, aucune requête N+1. Aucun de ces trois points ne
 * se vérifie en relisant du code — seul un vrai PostgreSQL avec un vrai volume
 * et un vrai EXPLAIN ANALYZE peut les trancher.
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
  /** Portée globale : voit les quatre domaines. */
  direction: "77777777-0000-0000-0000-000000000001",
  /** Domaine FISCAL uniquement. */
  comptaAgent: "77777777-0000-0000-0000-000000000002",
  /** Ni occurrence.read ni document.read. */
  admin: "77777777-0000-0000-0000-000000000003",
} as const;

/** 40 obligations × 250 périodes = 10 000 occurrences. */
const OBLIGATION_COUNT = 40;
const PERIODS_PER_OBLIGATION = 250;
const TOTAL = OBLIGATION_COUNT * PERIODS_PER_OBLIGATION;

/** Objectif du critère d'acceptation, en millisecondes. */
const FIRST_RENDER_BUDGET_MS = 500;

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.direction}'::uuid,   'perf.direction@test.dz'),
  ('${USER.comptaAgent}'::uuid, 'perf.compta@test.dz'),
  ('${USER.admin}'::uuid,       'perf.admin@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id)
values
  ('${USER.direction}',   (select id from public.roles where code='DIRECTION'), null),
  ('${USER.comptaAgent}', (select id from public.roles where code='COMPTA_AGENT'),
                          (select id from public.domains where code='FISCAL')),
  ('${USER.admin}',       (select id from public.roles where code='ADMIN'), null);

insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality)
select
  'PERF-' || lpad(g::text, 3, '0'),
  'Obligation de charge ' || g,
  'MONTHLY',
  '{"anchor":"PERIOD_END","offset_days":20}'::jsonb,
  '2000-01-01',
  (select id from public.domains order by code offset (g % 4) limit 1),
  (array['LOW','MEDIUM','HIGH','CRITICAL'])[1 + (g % 4)]::public.criticality
from generate_series(1, ${String(OBLIGATION_COUNT)}) g;

insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, owner_id)
select
  ot.id,
  to_char(date '2006-01-01' + (p || ' months')::interval, 'YYYY-MM'),
  (date '2006-01-01' + (p || ' months')::interval)::date,
  (date '2006-01-01' + (p || ' months')::interval + interval '1 month - 1 day')::date,
  (date '2006-01-01' + (p || ' months')::interval + interval '1 month + 19 days')::date,
  (date '2006-01-01' + (p || ' months')::interval + interval '1 month + 14 days')::date,
  (array['TODO','IN_PROGRESS','PENDING_VALIDATION','VALIDATED','SUBMITTED','ARCHIVED'])[
    1 + ((p + ot.ord) % 6)]::public.occurrence_status,
  case when (p + ot.ord) % 3 = 0 then '${USER.direction}'::uuid else null end
from (select id, row_number() over (order by code) as ord
      from public.obligation_types where code like 'PERF-%') ot
cross join generate_series(0, ${String(PERIODS_PER_OBLIGATION - 1)}) p;
`;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const CLEANUP = `
delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like 'PERF-%');
delete from public.obligation_occurrences where obligation_type_id in (
  select id from public.obligation_types where code like 'PERF-%');
delete from public.obligation_types where code like 'PERF-%';
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

/** Requête exacte de la première page de l'écran de travail. */
const LIST_SQL = `
select id, obligation_code, obligation_name, period_key, internal_due_date, legal_due_date,
       status, owner_name, validator_name, documents_provided, documents_required,
       is_overdue, is_internally_late, days_to_internal, criticality, domain_label
from public.occurrence_list
where status = any ($1::public.occurrence_status[])
order by internal_due_date asc, id asc
limit 51`;

const OPEN_STATUSES = ["TODO", "IN_PROGRESS", "PENDING_VALIDATION"];

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

  /*
   * ⚠️ VACUUM ANALYZE, et pas seulement ANALYZE.
   *
   * ANALYZE seul laisserait le planificateur raisonner sur des statistiques
   * vides et choisir des plans sans rapport avec ceux de la production.
   *
   * Le VACUUM, lui, répond à un artefact de la suite elle-même : chaque
   * exécution insère puis supprime 10 000 lignes, bien plus vite que
   * l'autovacuum ne réagit. Mesuré : après quelques passages, la table portait
   * 10 024 tuples morts pour 0 vivant et pesait 11 Mo — la première page
   * mettait alors 1 068 ms au lieu de 25. Ce n'est pas la requête qui est lente,
   * c'est la table qui est jonchée. En production, l'autovacuum s'en charge ;
   * ici, on le fait explicitement pour mesurer la requête et non le désordre
   * laissé par le test précédent.
   */
  await pool.query("vacuum analyze public.obligation_occurrences");
  await pool.query("vacuum analyze public.obligation_types");
  await pool.query("vacuum analyze public.occurrence_transitions");
  await pool.query("select public.refresh_occurrence_stats()");
}, 180_000);

afterAll(async () => {
  await withTriggerOff(async () => {
    await pool.query(CLEANUP).catch(() => undefined);
  });
  await pool.query("select public.refresh_occurrence_stats()").catch(() => undefined);
  await pool.end();
}, 120_000);

// ═════════════════════════════════════════════════════════════════════════════

describe("volume et performance", () => {
  it("le jeu d'essai contient bien 10 000 occurrences", async () => {
    const result = await pool.query<{ n: string }>(
      `select count(*) as n from public.obligation_occurrences oc
       join public.obligation_types ot on ot.id = oc.obligation_type_id
       where ot.code like 'PERF-%'`,
    );
    expect(Number(result.rows[0]?.n ?? "0")).toBe(TOTAL);
  });

  it("la première page se rend sous 500 ms", async () => {
    await asUser(USER.direction, async (client) => {
      // Chauffe : le premier appel paie la préparation du plan et un cache froid.
      await client.query(LIST_SQL, [OPEN_STATUSES]);

      const timings: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        const started = process.hrtime.bigint();
        const result = await client.query(LIST_SQL, [OPEN_STATUSES]);
        timings.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(result.rowCount).toBeLessThanOrEqual(51);
      }

      const worst = Math.max(...timings);
      // On mesure le PIRE des cinq, pas la moyenne : c'est ce que l'utilisateur
      // le moins chanceux ressent.
      expect(worst, `pire mesure ${worst.toFixed(1)} ms`).toBeLessThan(FIRST_RENDER_BUDGET_MS);
    });
  }, 60_000);

  it("aucune requête N+1 : les compteurs de pièces s'exécutent une fois par LIGNE RENDUE", async () => {
    await asUser(USER.direction, async (client) => {
      const plan = await client.query<{ "QUERY PLAN": string }>(
        `explain (analyze, format text) ${LIST_SQL}`,
        [OPEN_STATUSES],
      );
      const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");

      /*
       * ⚠️ Ce qui définit un N+1, c'est qu'un nœud du plan s'exécute autant de
       * fois qu'il y a de LIGNES DANS LA TABLE. La borne se mesure donc contre
       * le volume total, pas contre la taille de page.
       *
       * En pratique le plan boucle une soixantaine de fois : le planificateur
       * examine un peu plus de candidats que les 50 rendus avant que la limite
       * ne soit satisfaite. C'est l'ordre de grandeur de la page. Un N+1
       * afficherait 10 000.
       */
      const loops = [...text.matchAll(/loops=(\d+)/g)].map((match) => Number(match[1]));
      const worst = Math.max(...loops);

      expect(
        worst,
        `boucles maximales observées : ${String(worst)} (table : ${String(TOTAL)})`,
      ).toBeLessThan(TOTAL / 20);

      // Et le plan doit s'appuyer sur un index, pas balayer la table.
      expect(text).toMatch(/Index Scan|Index Only Scan|Bitmap Index Scan/);
    });
  }, 60_000);

  it("le calendrier tient en UNE requête sur l'intervalle affiché", async () => {
    await asUser(USER.direction, async (client) => {
      const plan = await client.query<{ "QUERY PLAN": string }>(
        `explain (analyze, format text)
         select id, obligation_code, internal_due_date, status
         from public.occurrence_list
         where internal_due_date >= date '2026-01-01'
           and internal_due_date <= date '2026-01-31'`,
      );
      const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");

      const executionTime = /Execution Time: ([\d.]+) ms/.exec(text);
      expect(Number(executionTime?.[1] ?? "9999")).toBeLessThan(FIRST_RENDER_BUDGET_MS);
    });
  }, 60_000);

  it("les agrégats ne comptent jamais la table complète", async () => {
    await asUser(USER.direction, async (client) => {
      const started = process.hrtime.bigint();
      const result = await client.query("select * from public.occurrence_stats_for_caller()");
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

      expect(result.rowCount).toBeGreaterThan(0);
      // Lecture d'un instantané précalculé : quelques millisecondes, pas un scan.
      expect(elapsed, `${elapsed.toFixed(1)} ms`).toBeLessThan(100);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("retard calculé", () => {
  it("aucun statut OVERDUE n'existe dans l'énumération", async () => {
    const result = await pool.query<{ label: string }>(
      `select enumlabel as label from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'occurrence_status'`,
    );
    const labels = result.rows.map((row) => row.label);
    // Un retard stocké serait faux dès le lendemain de son écriture.
    expect(labels).not.toContain("OVERDUE");
  });

  it("is_overdue suit la date ET le statut", async () => {
    await asUser(USER.direction, async (client) => {
      const result = await client.query<{ ok: boolean }>(
        `select bool_and(
                  is_overdue = (legal_due_date < (now() at time zone 'Africa/Algiers')::date
                    and status not in ('SUBMITTED','ARCHIVED','NOT_APPLICABLE'))
                ) as ok
         from public.occurrence_list`,
      );
      expect(result.rows[0]?.ok).toBe(true);
    });
  });

  it("VALIDATED compte comme en retard : validé n'est pas déposé", async () => {
    await asUser(USER.direction, async (client) => {
      const result = await client.query<{ n: string }>(
        `select count(*) as n from public.occurrence_list
         where status = 'VALIDATED'
           and legal_due_date < (now() at time zone 'Africa/Algiers')::date
           and not is_overdue`,
      );
      expect(Number(result.rows[0]?.n ?? "0")).toBe(0);
    });
  });

  it("is_internally_late se déclenche AVANT is_overdue", async () => {
    await asUser(USER.direction, async (client) => {
      // L'échéance interne précède la légale : toute ligne en retard légal l'est
      // aussi en interne. L'inverse est la fenêtre d'alerte précoce.
      const result = await client.query<{ n: string }>(
        `select count(*) as n from public.occurrence_list
         where is_overdue and not is_internally_late`,
      );
      expect(Number(result.rows[0]?.n ?? "0")).toBe(0);
    });
  });

  it("le compteur de la barre latérale et la liste donnent le MÊME nombre", async () => {
    await asUser(USER.direction, async (client) => {
      const nav = await client.query<{ overdue: number }>(
        "select overdue from public.navigation_counters()",
      );
      const list = await client.query<{ n: string }>(
        "select count(*) as n from public.occurrence_list where is_overdue",
      );
      // Deux définitions divergentes se liraient comme un défaut d'affichage.
      expect(nav.rows[0]?.overdue).toBe(Number(list.rows[0]?.n ?? "-1"));
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("cloisonnement", () => {
  it("la vue de liste applique la RLS : COMPTA ne voit que le fiscal", async () => {
    const [all, fiscal] = await Promise.all([
      asUser(USER.comptaAgent, async (client) => {
        const r = await client.query<{ n: string }>(
          "select count(*) as n from public.occurrence_list",
        );
        return Number(r.rows[0]?.n ?? "0");
      }),
      asUser(USER.comptaAgent, async (client) => {
        const r = await client.query<{ n: string }>(
          "select count(*) as n from public.occurrence_list where domain_code = 'FISCAL'",
        );
        return Number(r.rows[0]?.n ?? "0");
      }),
    ]);

    expect(all).toBeGreaterThan(0);
    expect(all).toBe(fiscal);
  });

  it("ADMIN ne voit AUCUNE ligne dans la vue de liste", async () => {
    await asUser(USER.admin, async (client) => {
      const result = await client.query<{ n: string }>(
        "select count(*) as n from public.occurrence_list",
      );
      expect(Number(result.rows[0]?.n ?? "-1")).toBe(0);
    });
  });

  it("⚠️ les AGRÉGATS ne fuient pas : une matview n'est pas soumise à la RLS", async () => {
    /*
     * Le point le plus délicat de la migration. La vue matérialisée n'est
     * protégée par aucune politique — seule occurrence_stats_for_caller()
     * réapplique le contrôle de domaine. Si ce filtre sautait, le nombre de
     * dossiers fiscaux serait publié à tout le monde.
     */
    const [direction, compta, admin] = await Promise.all([
      asUser(USER.direction, async (client) => {
        const r = await client.query("select * from public.occurrence_stats_for_caller()");
        return r.rowCount ?? 0;
      }),
      asUser(USER.comptaAgent, async (client) => {
        const r = await client.query<{ domain_id: string | null }>(
          "select domain_id from public.occurrence_stats_for_caller()",
        );
        return r.rows;
      }),
      asUser(USER.admin, async (client) => {
        const r = await client.query("select * from public.occurrence_stats_for_caller()");
        return r.rowCount ?? 0;
      }),
    ]);

    expect(direction).toBeGreaterThan(0);
    // ADMIN n'a pas occurrence.read : aucun agrégat ne doit lui parvenir.
    expect(admin).toBe(0);

    const fiscalId = await pool.query<{ id: string }>(
      "select id from public.domains where code = 'FISCAL'",
    );
    for (const row of compta) {
      expect(row.domain_id).toBe(fiscalId.rows[0]?.id);
    }
  });

  it("la matview elle-même est inaccessible à authenticated", async () => {
    await asUser(USER.direction, async (client) => {
      await expect(client.query("select * from public.occurrence_stats limit 1")).rejects.toThrow(
        /permission denied/i,
      );
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("pagination par curseur", () => {
  it("deux pages consécutives ne se recouvrent pas et ne sautent rien", async () => {
    await asUser(USER.direction, async (client) => {
      const first = await client.query<{ id: string; internal_due_date: string }>(
        `select id, to_char(internal_due_date,'YYYY-MM-DD') as internal_due_date
         from public.occurrence_list
         order by internal_due_date asc, id asc limit 50`,
      );
      const last = first.rows.at(-1);
      if (last === undefined) throw new Error("première page vide");

      const second = await client.query<{ id: string }>(
        `select id from public.occurrence_list
         where (internal_due_date, id) > ($1::date, $2::uuid)
         order by internal_due_date asc, id asc limit 50`,
        [last.internal_due_date, last.id],
      );

      const firstIds = new Set(first.rows.map((row) => row.id));
      const overlap = second.rows.filter((row) => firstIds.has(row.id));
      expect(overlap).toEqual([]);
      expect(second.rowCount).toBe(50);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("réaffectation groupée", () => {
  it("réaffecte en une transaction et refuse sans occurrence.assign", async () => {
    const ids = await asUser(USER.direction, async (client) => {
      const r = await client.query<{ id: string }>(
        `select id from public.occurrence_list where status = 'TODO' limit 5`,
      );
      return r.rows.map((row) => row.id);
    });
    expect(ids.length).toBeGreaterThan(0);

    // COMPTA_AGENT n'a pas occurrence.assign : le contrôle de permission passe
    // avant tout le reste.
    await asUser(USER.comptaAgent, async (client) => {
      await expect(
        client.query("select public.reassign_occurrences($1::uuid[], $2::uuid)", [
          ids,
          USER.direction,
        ]),
      ).rejects.toThrow(/occurrence\.assign/);
    });

    await asUser(USER.direction, async (client) => {
      const result = await client.query<{ reassign_occurrences: number }>(
        "select public.reassign_occurrences($1::uuid[], $2::uuid)",
        [ids, USER.direction],
      );
      expect(result.rows[0]?.reassign_occurrences).toBe(ids.length);
    });
  });

  it("ne touche jamais un dossier clos ou verrouillé", async () => {
    const closed = await asUser(USER.direction, async (client) => {
      const r = await client.query<{ id: string }>(
        `select id from public.occurrence_list where status in ('ARCHIVED','SUBMITTED') limit 3`,
      );
      return r.rows.map((row) => row.id);
    });

    await asUser(USER.direction, async (client) => {
      const result = await client.query<{ reassign_occurrences: number }>(
        "select public.reassign_occurrences($1::uuid[], $2::uuid)",
        [closed, USER.direction],
      );
      expect(result.rows[0]?.reassign_occurrences).toBe(0);
    });
  });

  it("refuse un destinataire désactivé", async () => {
    const ids = await asUser(USER.direction, async (client) => {
      const r = await client.query<{ id: string }>(
        `select id from public.occurrence_list where status = 'TODO' limit 1`,
      );
      return r.rows.map((row) => row.id);
    });

    await pool.query("update public.profiles set is_active = false where id = $1", [
      USER.comptaAgent,
    ]);
    try {
      await asUser(USER.direction, async (client) => {
        await expect(
          client.query("select public.reassign_occurrences($1::uuid[], $2::uuid)", [
            ids,
            USER.comptaAgent,
          ]),
        ).rejects.toThrow(/destinataire/);
      });
    } finally {
      await pool.query("update public.profiles set is_active = true where id = $1", [
        USER.comptaAgent,
      ]);
    }
  });

  it("⚠️ ne franchit PAS le cloisonnement, malgré SECURITY DEFINER", async () => {
    /*
     * Le contrôle qui compte sur cette fonction. COMPTA_MANAGER détient
     * occurrence.assign, mais sur le seul domaine FISCAL : les dossiers des
     * autres domaines doivent lui rester intouchables, alors même que la
     * fonction s'exécute avec les droits du propriétaire.
     */
    const socialIds = await asUser(USER.direction, async (client) => {
      const r = await client.query<{ id: string }>(
        `select id from public.occurrence_list
          where domain_code <> 'FISCAL' and status = 'TODO' limit 5`,
      );
      return r.rows.map((row) => row.id);
    });
    expect(socialIds.length).toBeGreaterThan(0);

    await pool.query(
      `insert into public.user_roles (user_id, role_id, domain_id)
       select $1, r.id, d.id from public.roles r, public.domains d
       where r.code = 'COMPTA_MANAGER' and d.code = 'FISCAL'
       on conflict do nothing`,
      [USER.comptaAgent],
    );

    await asUser(USER.comptaAgent, async (client) => {
      const result = await client.query<{ reassign_occurrences: number }>(
        "select public.reassign_occurrences($1::uuid[], $2::uuid)",
        [socialIds, USER.comptaAgent],
      );
      // Zéro : le prédicat de domaine écarte chaque ligne.
      expect(result.rows[0]?.reassign_occurrences).toBe(0);
    });
  });
});
