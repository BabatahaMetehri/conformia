// @vitest-environment node

/**
 * Tenue en charge du tableau de bord.
 *
 * ⚠️ Le critère est chiffré — « moins de 800 ms sur 50 000 occurrences » — et un
 * critère chiffré ne se vérifie qu'en le mesurant. Ce fichier fabrique donc
 * réellement 50 000 dossiers, rafraîchit les agrégats, puis chronomètre ce que
 * fait une requête d'écran.
 *
 * ⚠️ Il COMMITTE, contrairement à toutes les autres suites d'intégration : une
 * vue matérialisée ne voit pas les lignes d'une transaction non validée, et
 * l'objet du test est précisément le comportement de ces vues. Le jeu d'essai
 * est donc supprimé explicitement en fin de fichier, et son préfixe le rend
 * reconnaissable si un échec interrompait le nettoyage.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls`.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 4 });

const MANAGER = "7f7f7f7f-0000-0000-0000-000000000001";
const PREFIX = "PERF-";
const OCCURRENCE_COUNT = 50_000;

/** Budget du critère d'acceptation, en millisecondes. */
const BUDGET_MS = 800;

/*
 * ⚠️ LE NETTOYAGE DÉSACTIVE LES TRIGGERS, comme le chargement.
 *
 * Sans cela, supprimer 50 000 lignes écrit 50 000 entrées d'audit : le hook
 * dépasse son délai, échoue à mi-course, et laisse le jeu d'essai EN BASE. Ce
 * n'est pas théorique — c'est arrivé, et les 50 000 dossiers résiduels ont fait
 * échouer la suite `workflow` en la faisant travailler sur un volume qui n'était
 * pas le sien. Un jeu d'essai qui fuit contamine tout ce qui suit.
 */
const CLEANUP = `
alter table public.obligation_occurrences disable trigger user;
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;

delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.obligation_occurrences where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');

alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;
alter table public.obligation_occurrences enable trigger user;

delete from public.obligation_types where code like '${PREFIX}%';
delete from public.user_roles where user_id = '${MANAGER}';
delete from public.profiles where id = '${MANAGER}';
delete from auth.users where id = '${MANAGER}';
`;

async function asManager<T>(run: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: MANAGER, role: "authenticated" }),
    ]);
    await client.query("set role authenticated");
    return await run(client);
  } finally {
    /*
     * ⚠️ LE GUC EST REMIS À BLANC, pas seulement le rôle.
     *
     * `set_config(..., false)` porte sur la SESSION, et la connexion retourne
     * au pool avec la revendication encore posée. Le nettoyage exécuté ensuite
     * sur cette même connexion croit donc être le responsable de test — et le
     * trigger « un utilisateur ne peut pas modifier ses propres habilitations »
     * refuse de supprimer son rôle. Le jeu d'essai reste alors en base, et
     * contamine tout ce qui suit.
     */
    await client.query("reset role").catch(() => undefined);
    await client.query("select set_config('request.jwt.claims', '', false)").catch(() => undefined);
    client.release();
  }
}

/** Médiane de plusieurs mesures : une seule prise mesure surtout le hasard. */
async function medianDuration(run: () => Promise<unknown>, samples = 5): Promise<number> {
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await run();
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  return durations[Math.floor(durations.length / 2)] ?? Number.POSITIVE_INFINITY;
}

let refreshMs = 0;

beforeAll(async () => {
  await pool.query(CLEANUP).catch(() => undefined);

  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'perf.manager@test.dz', 'x', now(), now(), now())
     on conflict (id) do nothing`,
    [MANAGER],
  );
  await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, d.id from public.roles r, public.domains d
      where r.code = 'COMPTA_MANAGER' and d.code = 'FISCAL'`,
    [MANAGER],
  );

  // Vingt obligations, pour que les agrégats aient de quoi grouper.
  await pool.query(
    `insert into public.obligation_types
       (code, name, periodicity, due_rule, effective_from, domain_id, criticality)
     select '${PREFIX}' || n, 'Obligation de charge ' || n, 'MONTHLY',
            '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
            (select id from public.domains where code = 'FISCAL'),
            (array['LOW','MEDIUM','HIGH','CRITICAL'])[1 + (n % 4)]::public.criticality
     from generate_series(1, 20) as n`,
  );

  /*
   * ⚠️ Triggers d'audit et de transition DÉSACTIVÉS pour le chargement.
   *
   * Ce n'est pas un contournement de règle : on POSE un état, on ne simule
   * aucune action métier. Les laisser actifs écrirait 50 000 entrées d'audit et
   * 50 000 lignes de transition — soit une mesure du coût des triggers, pas de
   * celui du tableau de bord, et plusieurs minutes de chargement.
   */
  await pool.query("alter table public.obligation_occurrences disable trigger user");

  await pool.query(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id, submitted_at,
        late_reason_code)
     select ot.id,
            -- ⚠️ Clé de période UNIQUE par ligne : (obligation, période) porte une
            -- contrainte d'unicité, et un jeu d'essai qui la viole ne mesure rien.
            'P' || n,
            (current_date - 400) + (n % 800),
            (current_date - 400) + (n % 800) + 27,
            (current_date - 400) + (n % 800) + 47,
            (current_date - 400) + (n % 800) + 42,
            (array['TODO','IN_PROGRESS','PENDING_VALIDATION','VALIDATED','SUBMITTED'])
              [1 + (n % 5)]::public.occurrence_status,
            $2,
            case when n % 5 = 4 then now() - (n % 300) * interval '1 day' else null end,
            case when n % 7 = 0
                 then (array['MISSING_DOCUMENT','VALIDATOR_UNAVAILABLE','OVERSIGHT'])
                        [1 + (n % 3)]::public.late_reason_code
                 else null end
     from generate_series(1, $1::int) as n
     join lateral (
       select id from public.obligation_types
        where code like '${PREFIX}%' order by code offset (n % 20) limit 1
     ) ot on true`,
    [OCCURRENCE_COUNT, MANAGER],
  );

  await pool.query("alter table public.obligation_occurrences enable trigger user");

  const started = performance.now();
  await pool.query("select public.refresh_dashboard_views()");
  refreshMs = performance.now() - started;
}, 900_000);

afterAll(async () => {
  try {
    await pool.query(CLEANUP);
    await pool.query("select public.refresh_dashboard_views()");
  } catch (error) {
    // ⚠️ Un nettoyage silencieusement avalé laisse 50 000 lignes derrière lui.
    // On le crie : mieux vaut une suite rouge qu'une base polluée.
    console.error("NETTOYAGE DU JEU D'ESSAI ÉCHOUÉ", (error as Error).message);
    throw error;
  } finally {
    await pool.end();
  }
}, 300_000);

describe("tenue en charge du tableau de bord", () => {
  it("dispose bien de 50 000 occurrences", async () => {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from public.obligation_occurrences oc
         join public.obligation_types ot on ot.id = oc.obligation_type_id
        where ot.code like '${PREFIX}%'`,
    );
    // Sans cette vérification, un chargement partiel rendrait la mesure suivante
    // flatteuse et fausse.
    expect(rows[0]?.n).toBe(OCCURRENCE_COUNT);
  });

  it("rend TOUS les agrégats de l'écran sous le budget", async () => {
    const elapsed = await asManager(async (client) =>
      medianDuration(async () => {
        // Exactement ce que charge la page : les cinq agrégats plus le bandeau.
        await Promise.all([
          client.query("select * from public.dashboard_compliance_for_caller()"),
          client.query("select * from public.dashboard_upcoming_for_caller()"),
          client.query("select * from public.dashboard_late_reasons_for_caller()"),
          client.query("select * from public.dashboard_workload_for_caller()"),
          client.query("select * from public.dashboard_health_for_caller()"),
        ]);
      }),
    );

    console.log(
      `agrégats : ${elapsed.toFixed(0)} ms (budget ${String(BUDGET_MS)} ms) · ` +
        `rafraîchissement des vues : ${refreshMs.toFixed(0)} ms`,
    );

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("le bandeau d'alertes tient lui aussi le budget", async () => {
    /*
     * ⚠️ Mesuré SÉPARÉMENT parce qu'il ne vient PAS d'une vue matérialisée : les
     * alertes doivent être exactes à la seconde, une alerte vieille d'un quart
     * d'heure n'est pas une alerte. Elle interroge donc les tables vives, et
     * c'est la partie du tableau de bord la plus susceptible de dériver avec le
     * volume — d'où une mesure qui lui est propre.
     */
    const elapsed = await asManager((client) =>
      medianDuration(() => client.query("select * from public.dashboard_alerts()")),
    );

    console.log(`bandeau d'alertes : ${elapsed.toFixed(0)} ms`);

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("le compteur de la file tient la charge — et la file dit où le coût reste", async () => {
    /*
     * ⚠️ DEUX MESURES, ET DEUX CONCLUSIONS DIFFÉRENTES. À lire ensemble.
     *
     * 1. LA PASTILLE est corrigée. `validation_queue` et
     *    `pending_validation_count()` filtraient chaque ligne par
     *    `can_validate_occurrence(oc.id)` et `self_validation_blocked(...)`, qui
     *    rouvrent des tables pour CHAQUE dossier. Mesuré sur ce jeu d'essai :
     *    22 secondes. Reformulé en 0012 (habilitation par domaine, séparation
     *    des pouvoirs lue sur les colonnes déjà jointes) : moins de 100 ms.
     *
     * 2. LA FILE ELLE-MÊME reste lente, et le coût n'est PAS dans la vue.
     *    `EXPLAIN ANALYZE` l'attribue à la politique RLS
     *    `obligation_occurrences_select` (phase 2), qui appelle
     *    `has_permission_in_domain(obligation_domain_of_type(...))` une fois par
     *    ligne : 8,4 s et 1,75 million d'accès tampon pour 50 000 dossiers.
     *    C'est un défaut TRANSVERSE — tout écran de liste le paie — et sa
     *    correction touche la politique de sécurité centrale. Elle n'a pas sa
     *    place dans un lot consacré au tableau de bord : elle mérite son propre
     *    changement, avec la suite RLS complète pour l'accompagner.
     *
     * Ce plafond est donc un GARDE-FOU DE RÉGRESSION sur l'état constaté, pas
     * un budget atteint. Le baisser suppose d'avoir corrigé la politique.
     */
    const KNOWN_RLS_CEILING_MS = 20_000;

    const queue = await asManager((client) =>
      medianDuration(() => client.query("select * from public.validation_queue"), 3),
    );
    const badge = await asManager((client) =>
      medianDuration(() => client.query("select public.pending_validation_count()"), 3),
    );

    console.log(
      `file de validation : ${queue.toFixed(0)} ms (plafond connu ${String(KNOWN_RLS_CEILING_MS)} ms, ` +
        `coût imputé à la politique RLS) · pastille : ${badge.toFixed(0)} ms (budget ${String(BUDGET_MS)} ms)`,
    );

    expect(badge).toBeLessThan(BUDGET_MS);
    expect(queue).toBeLessThan(KNOWN_RLS_CEILING_MS);
  });

  it("le rafraîchissement des vues reste compatible avec un pas de 15 minutes", () => {
    // Il tourne hors requête ; il doit seulement tenir dans son intervalle avec
    // une marge confortable.
    expect(refreshMs).toBeLessThan(60_000);
  });
});
