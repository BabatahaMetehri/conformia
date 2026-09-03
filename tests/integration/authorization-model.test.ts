// @vitest-environment node

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * MODÈLE D'HABILITATIONS DE LA TRIADE — migration 0019.
 *
 * ⚠️ CE FICHIER ÉPROUVE DES DÉCISIONS, PAS DU CODE. Chacune des vérifications
 * ci-dessous correspond à une décision arrêtée qu'un raccourci de bonne foi
 * peut défaire sans que rien ne casse :
 *
 *   • ADMIN ne lit ni dossier ni document. « Un administrateur doit bien pouvoir
 *     dépanner » est l'argument qui rouvrira cette porte, et ce test est ce qui
 *     l'en empêchera.
 *   • Le SUPERVISEUR peut préparer ET valider — mais jamais LE MÊME dossier. Le
 *     contrôle porte sur l'acte, et un contrôle qui porterait sur le rôle
 *     laisserait passer exactement ce cas.
 *   • RESPONSABLE et SUPPLEANT ont les mêmes droits, et une déclaration
 *     d'absence n'en change aucun.
 *   • Le domaine dénormalisé sur le dossier ne peut pas dériver de celui de son
 *     obligation. Une dérive y serait un TROU DE CLOISONNEMENT silencieux : le
 *     dossier resterait visible du mauvais domaine, sans erreur, sans trace.
 *
 * Éprouvé contre la BASE RÉELLE, sous session utilisateur là où la RLS compte.
 */

const DB_URL =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: DB_URL, max: 4 });

const PREFIX = "AUTHZ-";
const ENTITY = "00000000-0000-0000-0000-000000000001";

const USER = {
  responsable: "a5a5a5a5-0000-0000-0000-000000000001",
  suppleant: "a5a5a5a5-0000-0000-0000-000000000002",
  superviseur: "a5a5a5a5-0000-0000-0000-000000000003",
  direction: "a5a5a5a5-0000-0000-0000-000000000004",
  admin: "a5a5a5a5-0000-0000-0000-000000000005",
} as const;

const OCCURRENCE = {
  /** Préparé par le responsable : le superviseur doit pouvoir le valider. */
  parAutrui: "a5a5a5a5-1111-0000-0000-000000000001",
  /** Préparé PAR LE SUPERVISEUR : il ne doit pas pouvoir le valider. */
  parLuiMeme: "a5a5a5a5-1111-0000-0000-000000000002",
} as const;

let obligationId = "";

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

async function count(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

const CLEANUP = `
-- ⚠️ Le journal des transitions est APPEND-ONLY : son trigger refuse tout
-- DELETE, y compris celui d'un jeu d'essai. Le couper le temps du nettoyage
-- n'affaiblit rien — la garantie porte sur le flux applicatif, pas sur la
-- capacité d'un test à effacer ce qu'il a lui-même posé.
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;
delete from public.occurrence_transitions where occurrence_id in (
  select id from public.obligation_occurrences
   where obligation_type_id in (select id from public.obligation_types where code like '${PREFIX}%'));
alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;
delete from public.obligation_occurrences where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');
delete from public.obligation_types where code like '${PREFIX}%';
delete from public.user_absences where user_id in (${Object.values(USER)
  .map((id) => `'${id}'`)
  .join(",")});
delete from public.user_roles where user_id in (${Object.values(USER)
  .map((id) => `'${id}'`)
  .join(",")});
delete from public.profiles where id in (${Object.values(USER)
  .map((id) => `'${id}'`)
  .join(",")});
delete from auth.users where id in (${Object.values(USER)
  .map((id) => `'${id}'`)
  .join(",")});
`;

beforeAll(async () => {
  await pool.query(CLEANUP).catch(() => undefined);

  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, created_at, updated_at)
     select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            u.email, 'x', now(), now(), now()
     from (values
       ('${USER.responsable}'::uuid, 'authz.responsable@test.dz'),
       ('${USER.suppleant}'::uuid,   'authz.suppleant@test.dz'),
       ('${USER.superviseur}'::uuid, 'authz.superviseur@test.dz'),
       ('${USER.direction}'::uuid,   'authz.direction@test.dz'),
       ('${USER.admin}'::uuid,       'authz.admin@test.dz')
     ) as u(id, email)`,
  );

  /*
   * ⚠️ Attributions de portée GLOBALE (domaine NULL) : c'est la portée arrêtée
   * pour la triade et la direction. Le cloisonnement par domaine est éprouvé
   * ailleurs — ici on éprouve la séparation des pouvoirs, qui n'a rien à voir
   * avec le domaine et que le domaine masquerait.
   */
  await pool.query(
    `insert into public.user_roles (user_id, role_id)
     values
       ('${USER.responsable}', (select id from public.roles where code='RESPONSABLE')),
       ('${USER.suppleant}',   (select id from public.roles where code='SUPPLEANT')),
       ('${USER.superviseur}', (select id from public.roles where code='SUPERVISEUR')),
       ('${USER.direction}',   (select id from public.roles where code='DIRECTION')),
       ('${USER.admin}',       (select id from public.roles where code='ADMIN'))`,
  );

  const obligation = await pool.query<{ id: string }>(
    `insert into public.obligation_types
       (entity_id, code, name, periodicity, due_rule, effective_from, domain_id,
        criticality, validation_levels, requires_validation)
     values ($1, '${PREFIX}OBL', 'Obligation du modèle d''habilitation', 'MONTHLY',
             '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2020-01-01',
             (select id from public.domains where code = 'FISCAL'),
             'MEDIUM', 1, true)
     returning id`,
    [ENTITY],
  );
  obligationId = obligation.rows[0]?.id ?? "";

  await pool.query(
    `insert into public.obligation_occurrences
       (id, obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id, submitted_for_validation_at)
     values
       ($1, $3, '2026-01', '2026-01-01', '2026-01-31', '2026-02-20', '2026-02-13',
        'PENDING_VALIDATION', $4, now()),
       ($2, $3, '2026-02', '2026-02-01', '2026-02-28', '2026-03-20', '2026-03-13',
        'PENDING_VALIDATION', $5, now())`,
    [OCCURRENCE.parAutrui, OCCURRENCE.parLuiMeme, obligationId, USER.responsable, USER.superviseur],
  );
}, 120_000);

afterAll(async () => {
  try {
    await pool.query(CLEANUP);
  } finally {
    await pool.end();
  }
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════

describe("matrice des rôles", () => {
  it("est EXACTEMENT celle arrêtée par 0019", async () => {
    /*
     * ⚠️ La matrice est comparée en entier, pas par sondage. Un test qui
     * vérifie « le superviseur peut valider » laisse passer « et il peut aussi
     * gérer les comptes » — c'est l'octroi EN TROP qui est dangereux, et lui
     * seul échappe à un test par échantillon.
     */
    const attendu: Record<string, string[]> = {
      ADMIN: [
        "absence.manage",
        "audit.read",
        "obligation.read",
        "referential.manage",
        "register.manage",
        "role.manage",
        "settings.manage",
        "user.manage",
      ],
      DIRECTION: [
        "absence.manage",
        "audit.read",
        "dashboard.view_all",
        "document.delete",
        "document.read",
        "export.generate",
        "obligation.read",
        "occurrence.assign",
        "occurrence.mark_na",
        "occurrence.read",
        "occurrence.unlock",
        "occurrence.validate",
        "referential.manage",
        "register.manage",
      ],
      RESPONSABLE: [
        "dashboard.view_all",
        "document.read",
        "document.upload",
        "export.generate",
        "obligation.read",
        "occurrence.read",
        "occurrence.submit",
        "occurrence.write",
      ],
      SUPPLEANT: [
        "dashboard.view_all",
        "document.read",
        "document.upload",
        "export.generate",
        "obligation.read",
        "occurrence.read",
        "occurrence.submit",
        "occurrence.write",
      ],
      SUPERVISEUR: [
        "absence.manage",
        "dashboard.view_all",
        "document.delete",
        "document.read",
        "document.upload",
        "export.generate",
        "obligation.read",
        "occurrence.assign",
        "occurrence.mark_na",
        "occurrence.read",
        "occurrence.submit",
        "occurrence.validate",
        "occurrence.write",
      ],
      AUDITOR: [
        "audit.read",
        "dashboard.view_all",
        "document.read",
        "export.generate",
        "obligation.read",
        "occurrence.read",
      ],
      EXTERNAL: ["document.read", "document.upload", "obligation.read", "occurrence.read"],
    };

    const { rows } = await pool.query<{ role: string; permissions: string[] }>(
      `select r.code as role, array_agg(p.code order by p.code) as permissions
         from public.roles r
         join public.role_permissions rp on rp.role_id = r.id
         join public.permissions p on p.id = rp.permission_id
        where r.code = any($1)
        group by r.code`,
      [Object.keys(attendu)],
    );

    const obtenu = Object.fromEntries(rows.map((row) => [row.role, row.permissions]));
    expect(obtenu).toEqual(attendu);
  });

  it("RESPONSABLE et SUPPLEANT ont des permissions rigoureusement identiques", async () => {
    // Ce qui les distingue est la TRACE (`acted_as`), pas le droit. Toute
    // divergence ici transforme le suppléant en rôle au rabais, ce qui vide sa
    // fonction : reprendre le dossier quand le responsable n'est pas là.
    const { rows } = await pool.query<{ manquant: string; role: string }>(
      `select p.code as manquant, r.code as role
         from public.roles r
         cross join public.permissions p
        where r.code in ('RESPONSABLE', 'SUPPLEANT')
          and exists (
            select 1 from public.role_permissions rp
            join public.roles autre on autre.id = rp.role_id
            where rp.permission_id = p.id
              and autre.code in ('RESPONSABLE', 'SUPPLEANT')
              and autre.code <> r.code)
          and not exists (
            select 1 from public.role_permissions rp
            where rp.role_id = r.id and rp.permission_id = p.id)`,
    );
    expect(rows).toEqual([]);
  });

  it("la triade et la direction sont de portée globale", async () => {
    const { rows } = await pool.query<{ code: string; default_domain_code: string }>(
      `select code, default_domain_code from public.roles
        where code in ('RESPONSABLE','SUPPLEANT','SUPERVISEUR','DIRECTION')
          and default_domain_code is not null`,
    );
    expect(rows).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("ADMIN reste hors du contenu métier", () => {
  it("ne détient ni occurrence.read ni document.read", async () => {
    const { rows } = await pool.query<{ code: string }>(
      `select p.code from public.role_permissions rp
         join public.roles r on r.id = rp.role_id
         join public.permissions p on p.id = rp.permission_id
        where r.code = 'ADMIN' and p.code in ('occurrence.read', 'document.read')`,
    );
    expect(rows).toEqual([]);
  });

  it("ne lit AUCUN dossier, pas même leur nombre", async () => {
    await asUser(USER.admin, async (client) => {
      const visibles = await count(
        client,
        `select count(*) as n from public.obligation_occurrences
          where obligation_type_id = $1`,
        [obligationId],
      );
      // ⚠️ Un COUNT ne doit pas davantage révéler l'existence d'un dossier
      // qu'un SELECT n'en révèle le contenu.
      expect(visibles).toBe(0);
    });
  });

  it("ne lit AUCUN document", async () => {
    await asUser(USER.admin, async (client) => {
      expect(await count(client, "select count(*) as n from public.documents")).toBe(0);
    });
  });

  it("administre pourtant bien les comptes — ce n'est pas un compte inerte", async () => {
    await asUser(USER.admin, async (client) => {
      // La contrepartie de l'interdiction : l'ADMIN doit rester capable de
      // faire son métier, sans quoi le cloisonnement se paie d'une impasse.
      expect(await count(client, "select count(*) as n from public.user_roles")).toBeGreaterThan(0);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("séparation des pouvoirs : le contrôle porte sur l'acte", () => {
  it("un RESPONSABLE ne peut pas valider, même son propre dossier", async () => {
    await asUser(USER.responsable, async (client) => {
      await expect(
        client.query(
          "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
          [OCCURRENCE.parAutrui],
        ),
      ).rejects.toThrow();
    });
  });

  it("un SUPERVISEUR valide le dossier préparé par un AUTRE", async () => {
    await asUser(USER.superviseur, async (client) => {
      const result = await client.query(
        "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
        [OCCURRENCE.parAutrui],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it("le MÊME SUPERVISEUR ne valide pas le dossier qu'il a préparé", async () => {
    /*
     * ⚠️ C'EST LE CŒUR DE LA DÉCISION. Le superviseur détient `occurrence.write`
     * ET `occurrence.validate` : rien dans son RÔLE ne l'empêche d'enchaîner les
     * deux. Ce qui l'en empêche est l'ACTE — il est le responsable de CE
     * dossier-là.
     */
    await asUser(USER.superviseur, async (client) => {
      await expect(
        client.query(
          "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
          [OCCURRENCE.parLuiMeme],
        ),
      ).rejects.toThrow(/[Ss]éparation des tâches/);
    });
  });

  it("le SUPPLEANT désigné sur un dossier ne le valide pas non plus", async () => {
    await asUser(USER.superviseur, async (client) => {
      // On désigne le superviseur comme SUPPLÉANT d'un dossier qu'il n'a pas
      // préparé : le seul fait d'être suppléant suffit à l'exclure.
      await client.query("set local role postgres");
      await client.query("update public.obligation_occurrences set deputy_id = $1 where id = $2", [
        USER.superviseur,
        OCCURRENCE.parAutrui,
      ]);
      await client.query("set local role authenticated");

      await expect(
        client.query(
          "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
          [OCCURRENCE.parAutrui],
        ),
      ).rejects.toThrow(/[Ss]éparation des tâches/);
    });
  });

  it("une transition passée avec acted_as RESPONSABLE exclut de la validation", async () => {
    /*
     * Le cas le plus subtil : la personne n'est NI responsable NI suppléant du
     * dossier aujourd'hui, mais elle y a agi à ce titre. La trace fait foi —
     * changer de fonction n'efface pas ce qu'on a préparé.
     */
    await asUser(USER.superviseur, async (client) => {
      await client.query("set local role postgres");
      await client.query(
        `insert into public.occurrence_transitions
           (occurrence_id, from_status, to_status, actor_id, acted_as)
         values ($1, 'IN_PROGRESS', 'PENDING_VALIDATION', $2, 'RESPONSABLE')`,
        [OCCURRENCE.parAutrui, USER.superviseur],
      );
      await client.query("set local role authenticated");

      const bloque = await client.query<{ blocked: boolean }>(
        `select public.self_validation_blocked(
                  oc.id, oc.obligation_type_id, oc.owner_id, oc.deputy_id, $2::uuid) as blocked
           from public.obligation_occurrences oc where oc.id = $1`,
        [OCCURRENCE.parAutrui, USER.superviseur],
      );
      expect(bloque.rows[0]?.blocked).toBe(true);
    });
  });

  it("la file de validation ne propose jamais ce que le trigger refuserait", async () => {
    // Deux écritures du même prédicat — la fonction et la vue. Elles doivent
    // rendre le même verdict, sans quoi l'écran propose un bouton qui échoue.
    await asUser(USER.superviseur, async (client) => {
      const { rows } = await client.query<{ id: string; in_queue: boolean; blocked: boolean }>(
        `select oc.id,
                exists (select 1 from public.validation_queue q where q.id = oc.id) as in_queue,
                public.self_validation_blocked(
                  oc.id, oc.obligation_type_id, oc.owner_id, oc.deputy_id,
                  public.current_profile_id()) as blocked
           from public.obligation_occurrences oc
          where oc.obligation_type_id = $1`,
        [obligationId],
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        if (row.blocked) expect(row.in_queue).toBe(false);
      }
    });
  });

  it("un dossier sans suppléant reste DANS la file", async () => {
    /*
     * ⚠️ DÉFAUT MESURÉ PENDANT 0019, ET LA RAISON DE CE TEST. La vue recopie le
     * prédicat de séparation des pouvoirs. En y ajoutant le suppléant sans
     * `coalesce`, `deputy_id = moi` valait NULL sur les dossiers sans suppléant
     * — soit la quasi-totalité — et `not (... and NULL and ...)` écartait la
     * ligne. La file entière s'est vidée : 5 000 dossiers devenus 0, sans une
     * seule erreur pour le signaler.
     */
    const sansSuppleant = await pool.query<{ n: string }>(
      `select count(*) as n from public.obligation_occurrences
        where obligation_type_id = $1 and deputy_id is null
          and status = 'PENDING_VALIDATION'`,
      [obligationId],
    );
    expect(Number(sansSuppleant.rows[0]?.n ?? 0)).toBeGreaterThan(0);

    await asUser(USER.direction, async (client) => {
      const enFile = await count(
        client,
        `select count(*) as n from public.validation_queue q
           join public.obligation_occurrences oc on oc.id = q.id
          where oc.obligation_type_id = $1 and oc.deputy_id is null`,
        [obligationId],
      );
      expect(enFile).toBeGreaterThan(0);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("une absence n'accorde ni ne retire aucun droit", () => {
  it("les permissions du suppléant sont les mêmes, absence déclarée ou non", async () => {
    const avant = await asUser(USER.suppleant, (client) =>
      client.query<{ code: string }>(
        `select p.code from public.permissions p
          where public.has_permission(p.code) order by p.code`,
      ),
    );

    await pool.query(
      `insert into public.user_absences (entity_id, user_id, starts_at, ends_at, reason)
       values ($1, $2, current_date - 1, current_date + 30, 'Congé annuel')`,
      [ENTITY, USER.responsable],
    );

    const apres = await asUser(USER.suppleant, (client) =>
      client.query<{ code: string }>(
        `select p.code from public.permissions p
          where public.has_permission(p.code) order by p.code`,
      ),
    );

    expect(apres.rows).toEqual(avant.rows);
    expect(apres.rows.length).toBeGreaterThan(0);
  });

  it("aucune politique n'interroge is_absent_on", async () => {
    // ⚠️ Vérification STRUCTURELLE, et c'est le seul angle qui tienne : une
    // vérification par scénario ne couvrirait que les cas qu'on a imaginés.
    const { rows } = await pool.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public'
          and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%is_absent_on%'`,
    );
    expect(rows).toEqual([]);
  });

  it("savoir qui est absent n'est pas confidentiel", async () => {
    // Un responsable doit pouvoir comprendre pourquoi un dossier n'avance pas.
    await asUser(USER.responsable, async (client) => {
      expect(await count(client, "select count(*) as n from public.user_absences")).toBeGreaterThan(
        0,
      );
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("le domaine dénormalisé ne peut pas dériver", () => {
  it("tout dossier non archivé porte le domaine de son obligation", async () => {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n
         from public.obligation_occurrences oc
         join public.obligation_types ot on ot.id = oc.obligation_type_id
        where oc.status <> 'ARCHIVED'
          and oc.domain_id is distinct from ot.domain_id`,
    );
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });

  it("une valeur fournie par l'appelant est ÉCRASÉE, pas acceptée", async () => {
    /*
     * ⚠️ La colonne est un CACHE. Un appelant qui pourrait la contredire
     * pourrait choisir dans quel domaine son dossier apparaît — c'est-à-dire
     * contourner le cloisonnement par une simple colonne.
     */
    const social = await pool.query<{ id: string }>(
      "select id from public.domains where code = 'SOCIAL'",
    );
    const inserted = await pool.query<{ domain_id: string }>(
      `insert into public.obligation_occurrences
         (obligation_type_id, domain_id, period_key, period_start, period_end,
          legal_due_date, internal_due_date, status)
       values ($1, $2, '2026-09', '2026-09-01', '2026-09-30', '2026-10-20', '2026-10-13', 'TODO')
       returning domain_id`,
      [obligationId, social.rows[0]?.id ?? null],
    );

    const attendu = await pool.query<{ domain_id: string }>(
      "select domain_id from public.obligation_types where id = $1",
      [obligationId],
    );
    expect(inserted.rows[0]?.domain_id).toBe(attendu.rows[0]?.domain_id);
    expect(inserted.rows[0]?.domain_id).not.toBe(social.rows[0]?.id);
  });

  it("un changement de domaine sur l'obligation se propage aux dossiers vivants", async () => {
    const social = await pool.query<{ id: string }>(
      "select id from public.domains where code = 'SOCIAL'",
    );
    const fiscal = await pool.query<{ id: string }>(
      "select id from public.domains where code = 'FISCAL'",
    );

    await pool.query("update public.obligation_types set domain_id = $1 where id = $2", [
      social.rows[0]?.id,
      obligationId,
    ]);

    const apres = await pool.query<{ n: string }>(
      `select count(*) as n from public.obligation_occurrences
        where obligation_type_id = $1 and status <> 'ARCHIVED' and domain_id <> $2`,
      [obligationId, social.rows[0]?.id],
    );
    expect(Number(apres.rows[0]?.n ?? 0)).toBe(0);

    await pool.query("update public.obligation_types set domain_id = $1 where id = $2", [
      fiscal.rows[0]?.id,
      obligationId,
    ]);
  });

  it("une obligation sans domaine est refusée", async () => {
    // Le domaine porte le cloisonnement : sans lui, un dossier n'échappe pas à
    // la vue de tous, il échappe au cloisonnement tout court.
    await expect(
      pool.query(
        `insert into public.obligation_types
           (entity_id, code, name, periodicity, due_rule, effective_from)
         values ($1, '${PREFIX}SANS-DOMAINE', 'Sans domaine', 'MONTHLY',
                 '{"anchor":"PERIOD_END","offset_days":10}'::jsonb, '2026-01-01')`,
        [ENTITY],
      ),
    ).rejects.toThrow(/domain_id/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("les politiques n'évaluent plus l'habilitation par ligne", () => {
  it("aucune politique ne porte d'appel d'habilitation non enveloppé", async () => {
    /*
     * ⚠️ VÉRIFICATION STRUCTURELLE DU CORRECTIF D-1, et elle vaut mieux qu'un
     * chronomètre : le temps dépend de la machine, la forme du prédicat non.
     * Un appel qui cesse d'être enveloppé dans `(select ...)` est évalué une
     * fois par ligne, et ce test le voit avant que la production ne le sente.
     */
    const { rows } = await pool.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies
        where schemaname = 'public'
          and regexp_replace(
                coalesce(qual,'') || ' ' || coalesce(with_check,''),
                '\\( SELECT [a-z_]+\\(', '', 'g')
              ~ ('(has_permission|has_permission_in_domain|is_active_user|is_admin'
                 || '|current_profile_id|accessible_domains|accessible_domains_array'
                 || '|effective_principals|domains_with_permission)\\(')
        order by tablename, policyname`,
    );
    expect(rows).toEqual([]);
  });

  it("toute fonction d'habilitation est STABLE et PARALLEL SAFE", async () => {
    // Une fonction VOLATILE ne peut jamais être mise en cache ; une fonction
    // PARALLEL UNSAFE interdit tout plan parallèle sur la requête ENTIÈRE.
    const { rows } = await pool.query<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('current_profile_id','is_active_user','effective_principals',
                            'has_permission','has_permission_in_domain','accessible_domains',
                            'accessible_domains_array','is_admin','is_direction',
                            'obligation_domain_of_type','obligation_domain_of_occurrence',
                            'domains_with_permission','can_see_occurrence',
                            'can_validate_occurrence','self_validation_blocked')
          and (p.provolatile <> 's' or p.proparallel <> 's')`,
    );
    expect(rows).toEqual([]);
  });

  it("can_see_occurrence rend le MÊME verdict que la politique", async () => {
    /*
     * La fonction est une seconde écriture du `using` de
     * `obligation_occurrences_select`, à l'usage des fonctions SECURITY DEFINER
     * qui ne traversent pas la RLS. Les deux doivent bouger ensemble.
     */
    for (const user of [USER.responsable, USER.superviseur, USER.direction, USER.admin]) {
      await asUser(user, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          "select id from public.obligation_occurrences where obligation_type_id = $1",
          [obligationId],
        );
        const parPolitique = new Set(rows.map((row) => row.id));

        const tous = await pool.query<{ id: string }>(
          "select id from public.obligation_occurrences where obligation_type_id = $1",
          [obligationId],
        );
        for (const { id } of tous.rows) {
          const { rows: verdict } = await client.query<{ visible: boolean }>(
            "select public.can_see_occurrence($1) as visible",
            [id],
          );
          expect(verdict[0]?.visible).toBe(parPolitique.has(id));
        }
      });
    }
  });
});
