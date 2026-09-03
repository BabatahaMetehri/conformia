// @vitest-environment node

/**
 * Tableau de bord et administration, éprouvés contre la BASE.
 *
 * ⚠️ Les garanties de l'administration sont toutes des refus, et un refus ne se
 * vérifie qu'en le provoquant par appel direct : c'est ce que fait un script, un
 * job mal écrit, ou quelqu'un qui a lu l'API. L'interface n'est pas le sujet.
 *
 * ⚠️ Chaque test s'exécute dans une transaction ANNULÉE. Aucun `commit` ne doit
 * apparaître ici.
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
  /** ADMIN : gère comptes et rôles, ne voit AUCUN dossier ni AUCUNE pièce. */
  admin: "7e7e7e7e-0000-0000-0000-000000000001",
  /** DIRECTION : destinataire des notifications sensibles. */
  direction: "7e7e7e7e-0000-0000-0000-000000000002",
  /** COMPTA_MANAGER sur FISCAL. */
  manager: "7e7e7e7e-0000-0000-0000-000000000003",
  /** RH_AGENT sur SOCIAL : sert le cloisonnement des agrégats. */
  rh: "7e7e7e7e-0000-0000-0000-000000000004",
} as const;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const PREFIX = "ADM-";

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.admin}'::uuid,     'adm.admin@test.dz'),
  ('${USER.direction}'::uuid, 'adm.direction@test.dz'),
  ('${USER.manager}'::uuid,   'adm.manager@test.dz'),
  ('${USER.rh}'::uuid,        'adm.rh@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id) values
  ('${USER.admin}',     (select id from public.roles where code='ADMIN'), null),
  ('${USER.direction}', (select id from public.roles where code='DIRECTION'), null),
  ('${USER.manager}',   (select id from public.roles where code='SUPERVISEUR'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.rh}',        (select id from public.roles where code='RESPONSABLE'),
                        (select id from public.domains where code='SOCIAL'));

insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality)
values
  ('${PREFIX}FISC', 'Déclaration fiscale', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
   (select id from public.domains where code='FISCAL'), 'CRITICAL'),
  ('${PREFIX}SOC', 'Déclaration sociale', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
   (select id from public.domains where code='SOCIAL'), 'LOW');

insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, owner_id)
select ot.id, '2026-03', '2026-03-01', '2026-03-31',
       (now() at time zone 'Africa/Algiers')::date - 5,
       (now() at time zone 'Africa/Algiers')::date - 10,
       'TODO', '${USER.manager}'
from public.obligation_types ot where ot.code like '${PREFIX}%';
`;

const CLEANUP = `
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;
delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;

delete from public.notifications where recipient_id in (${IDS});
delete from public.user_invitations where invited_by in (${IDS});
delete from public.occurrence_checklist_items where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.obligation_occurrences where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');
delete from public.obligation_types where code like '${PREFIX}%';
delete from public.user_roles where user_id in (${IDS});
delete from public.profiles where id in (${IDS});
delete from auth.users where id in (${IDS});
delete from public.backup_runs;
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

async function withoutRls<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  await client.query("reset role");
  try {
    return await run();
  } finally {
    await client.query("set local role authenticated");
  }
}

async function expectRefusal(
  client: PoolClient,
  run: () => Promise<unknown>,
  matcher: RegExp,
): Promise<void> {
  await client.query("savepoint before_refusal");
  await expect(run()).rejects.toThrow(matcher);
  await client.query("rollback to savepoint before_refusal");
}

let fiscalOccurrence = "";

beforeAll(async () => {
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.query(SEED);

  const { rows } = await pool.query<{ id: string }>(
    `select oc.id from public.obligation_occurrences oc
       join public.obligation_types ot on ot.id = oc.obligation_type_id
      where ot.code = $1`,
    [`${PREFIX}FISC`],
  );
  fiscalOccurrence = rows[0]?.id ?? "";
}, 60_000);

afterAll(async () => {
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("comptes et habilitations", () => {
  it("REFUSE à un administrateur de modifier ses PROPRES rôles", async () => {
    await asUser(USER.admin, async (client) => {
      // ⚠️ Le contrôle est en BASE, pas dans l'écran : c'est la seule forme qui
      // résiste à un appel direct, et l'auto-attribution est précisément le
      // geste qu'un administrateur mal intentionné tenterait hors interface.
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.user_roles (user_id, role_id)
             values ($1, (select id from public.roles where code = 'DIRECTION'))`,
            [USER.admin],
          ),
        /ses propres habilitations/,
      );
    });
  });

  it("laisse un administrateur attribuer un rôle à AUTRUI", async () => {
    await asUser(USER.admin, async (client) => {
      const { rowCount } = await client.query(
        `insert into public.user_roles (user_id, role_id, granted_by)
         values ($1, (select id from public.roles where code = 'RESPONSABLE'), $2)`,
        [USER.rh, USER.admin],
      );
      expect(rowCount).toBe(1);
    });
  });

  it("REFUSE un rôle AUDITOR sans date d'expiration", async () => {
    await asUser(USER.admin, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.user_roles (user_id, role_id, granted_by)
             values ($1, (select id from public.roles where code = 'AUDITOR'), $2)`,
            [USER.manager, USER.admin],
          ),
        /exige une date d'expiration/,
      );
    });
  });

  it("REFUSE une expiration AUDITOR au-delà de la borne du référentiel", async () => {
    await asUser(USER.admin, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.user_roles (user_id, role_id, granted_by, expires_at)
             values ($1, (select id from public.roles where code = 'AUDITOR'), $2,
                     now() + interval '200 days')`,
            [USER.manager, USER.admin],
          ),
        /limité à/,
      );
    });
  });

  it("ACCEPTE un AUDITOR borné dans la limite déclarée", async () => {
    await asUser(USER.admin, async (client) => {
      const { rowCount } = await client.query(
        `insert into public.user_roles (user_id, role_id, granted_by, expires_at)
         values ($1, (select id from public.roles where code = 'AUDITOR'), $2,
                 now() + interval '80 days')`,
        [USER.manager, USER.admin],
      );
      expect(rowCount).toBe(1);
    });
  });
});

describe("désactivation d'un compte", () => {
  it("REFUSE sans destinataire tant que des dossiers ouverts subsistent", async () => {
    await asUser(USER.admin, async (client) => {
      const { rows } = await client.query<{ n: number }>("select public.open_task_count($1) as n", [
        USER.manager,
      ]);
      expect(rows[0]?.n).toBeGreaterThan(0);

      await expectRefusal(
        client,
        () =>
          client.query("select public.deactivate_user($1, $2)", [
            USER.manager,
            "depart de l'entreprise au 31 mars",
          ]),
        /dossier\(s\) ouvert\(s\)/,
      );
    });
  });

  it("ACCEPTE en désignant un destinataire, et réaffecte dans la même transaction", async () => {
    await asUser(USER.admin, async (client) => {
      const { rows } = await client.query<{ moved: number }>(
        "select public.deactivate_user($1, $2, $3) as moved",
        [USER.manager, "depart de l'entreprise au 31 mars", USER.direction],
      );
      expect(rows[0]?.moved).toBeGreaterThan(0);

      const after = await withoutRls(client, async () => {
        const result = await client.query<{ deactivated_at: string | null }>(
          "select deactivated_at from public.profiles where id = $1",
          [USER.manager],
        );
        return result.rows[0]?.deactivated_at ?? null;
      });
      expect(after).not.toBeNull();
    });
  });

  it("REFUSE à un administrateur de se désactiver LUI-MÊME", async () => {
    await asUser(USER.admin, async (client) => {
      // Sans cette garde, le dernier administrateur verrouille l'installation
      // sans aucun chemin de retour.
      await expectRefusal(
        client,
        () =>
          client.query("select public.deactivate_user($1, $2)", [
            USER.admin,
            "motif parfaitement valable",
          ]),
        /son propre compte/,
      );
    });
  });

  it("compte le VALIDATEUR autant que le préparateur", async () => {
    await asUser(USER.admin, async (client) => {
      await withoutRls(client, async () => {
        // Le manager n'est responsable de RIEN, mais reste validateur du dossier
        // fiscal : désactiver le seul validateur bloque un dossier aussi sûrement
        // que d'en désactiver le préparateur.
        await client.query("update public.obligation_occurrences set owner_id = null");
        await client.query(
          "update public.obligation_occurrences set validator_id = $1 where id = $2",
          [USER.manager, fiscalOccurrence],
        );
      });

      const { rows } = await client.query<{ n: number }>("select public.open_task_count($1) as n", [
        USER.manager,
      ]);
      expect(rows[0]?.n).toBe(1);
    });
  });
});

describe("réinitialisation du second facteur", () => {
  it("exige user.manage et un motif, journalise, et prévient la DIRECTION", async () => {
    await asUser(USER.admin, async (client) => {
      await expectRefusal(
        client,
        () => client.query("select public.reset_user_mfa($1, $2)", [USER.manager, "vu"]),
        /10 caractères/,
      );

      await withoutRls(client, async () => {
        await client.query("update public.profiles set mfa_enrolled = true where id = $1", [
          USER.manager,
        ]);
      });

      const { rows } = await client.query<{ ok: boolean }>(
        "select public.reset_user_mfa($1, $2) as ok",
        [USER.manager, "téléphone perdu, identité vérifiée en personne"],
      );
      expect(rows[0]?.ok).toBe(true);

      const traces = await withoutRls(client, async () => {
        const audit = await client.query<{ n: number }>(
          `select count(*)::int as n from public.audit_log
            where action = 'MFA_RESET' and entity_id_ref = $1`,
          [USER.manager],
        );
        const notified = await client.query<{ recipient_id: string }>(
          "select recipient_id from public.notifications where kind = 'MFA_RESET'",
        );
        return { audit: audit.rows[0]?.n ?? 0, notified: notified.rows.map((r) => r.recipient_id) };
      });

      // ⚠️ Les trois traces sont exigées ensemble : sans l'audit on ne sait pas
      // qui, sans la notification la Direction ne sait pas que c'est arrivé.
      expect(traces.audit).toBe(1);
      expect(traces.notified).toContain(USER.direction);
    });
  });

  it("REFUSE à qui ne détient pas user.manage", async () => {
    await asUser(USER.manager, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query("select public.reset_user_mfa($1, $2)", [
            USER.rh,
            "motif parfaitement valable",
          ]),
        /user\.manage requis/,
      );
    });
  });
});

describe("invitations", () => {
  it("inscrit une invitation sous le nom de son auteur", async () => {
    await asUser(USER.admin, async (client) => {
      const { rows } = await client.query<{ id: string; invited_by: string }>(
        `insert into public.user_invitations
           (email, full_name, role_id, invited_by)
         values ('nouveau@test.dz', 'Nouvelle Recrue',
                 (select id from public.roles where code = 'RESPONSABLE'), $1)
         returning id, invited_by`,
        [USER.admin],
      );
      expect(rows[0]?.invited_by).toBe(USER.admin);
    });
  });

  it("REFUSE d'inviter au nom d'un autre", async () => {
    await asUser(USER.admin, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.user_invitations (email, full_name, role_id, invited_by)
             values ('usurpe@test.dz', 'Usurpé',
                     (select id from public.roles where code = 'RESPONSABLE'), $1)`,
            [USER.direction],
          ),
        /row-level security/,
      );
    });
  });

  it("REFUSE une invitation AUDITOR sans expiration", async () => {
    await asUser(USER.admin, async (client) => {
      // Anticipé à l'invitation : sinon la personne créerait son compte et
      // l'attribution du rôle échouerait, la laissant sans droits ni explication.
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.user_invitations (email, full_name, role_id, invited_by)
             values ('audit@test.dz', 'Auditeur',
                     (select id from public.roles where code = 'AUDITOR'), $1)`,
            [USER.admin],
          ),
        /exige une date d'expiration/,
      );
    });
  });

  it("REFUSE à qui ne gère pas les comptes", async () => {
    await asUser(USER.manager, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.user_invitations (email, full_name, role_id, invited_by)
             values ('x@test.dz', 'X',
                     (select id from public.roles where code = 'RESPONSABLE'), $1)`,
            [USER.manager],
          ),
        /row-level security/,
      );
    });
  });
});

describe("matrice des rôles", () => {
  it("est modifiable par role.manage, et par personne d'autre", async () => {
    await asUser(USER.admin, async (client) => {
      const { rowCount } = await client.query(
        `insert into public.role_permissions (role_id, permission_id)
         select r.id, p.id from public.roles r, public.permissions p
          where r.code = 'RESPONSABLE' and p.code = 'export.generate'
         on conflict do nothing`,
      );
      expect(rowCount).toBe(1);
    });

    await asUser(USER.manager, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.role_permissions (role_id, permission_id)
             select r.id, p.id from public.roles r, public.permissions p
              where r.code = 'RESPONSABLE' and p.code = 'settings.manage'`,
          ),
        /row-level security/,
      );
    });
  });

  it("REFUSE de supprimer ou de renommer un rôle SYSTÈME", async () => {
    await asUser(USER.admin, async (client) => {
      /*
       * ⚠️ Éprouvé HORS RLS, délibérément. Les politiques de 0002 filtrent déjà :
       * aucune politique DELETE n'existe sur `roles`, et `roles_update` exclut
       * les rôles système. Un test sous RLS ne toucherait donc AUCUNE ligne et
       * passerait sans jamais atteindre le trigger — vert pour la mauvaise
       * raison. C'est le trigger qu'on éprouve ici : c'est lui qui tiendra le
       * jour où quelqu'un élargira une politique.
       */
      await withoutRls(client, async () => {
        await expectRefusal(
          client,
          () => client.query("delete from public.roles where code = 'DIRECTION'"),
          /ne peut pas être supprimé/,
        );
        await expectRefusal(
          client,
          () => client.query("update public.roles set code = 'DIR' where code = 'DIRECTION'"),
          /immuable/,
        );
      });
    });
  });

  it("dit combien de comptes ACTIFS une réduction de droits toucherait", async () => {
    await asUser(USER.admin, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `select public.role_holder_count(
           (select id from public.roles where code = 'SUPERVISEUR')) as n`,
      );
      // Le manager du jeu d'essai, au moins : l'avertissement doit être chiffré.
      expect(rows[0]?.n).toBeGreaterThan(0);
    });
  });
});

describe("jours fériés", () => {
  it("porte les fêtes civiles à date fixe, en récurrentes", async () => {
    const { rows } = await pool.query<{ label: string; is_recurring: boolean }>(
      `select label, is_recurring from public.holidays
        where source = 'Fête civile à date fixe' order by holiday_date`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.is_recurring)).toBe(true);
    expect(rows.map((row) => row.label)).toContain("Yennayer — nouvel an amazigh");
  });

  it("ne PRÉTEND PAS connaître les fêtes religieuses", async () => {
    // ⚠️ Aïd, Achoura, Mawlid suivent le calendrier hégirien et sont fixés par
    // décret. Les calculer serait inventer une règle réglementaire ; les figer
    // serait pire. Ils sont saisis à la main — et la tâche annuelle existe pour
    // que personne n'oublie de le faire.
    const { rows } = await pool.query<{ label: string }>(
      `select label from public.holidays
        where label ~* '(a[iï]d|achoura|moharem|mawlid)'`,
    );
    expect(rows).toEqual([]);
  });

  it("ne déplace QUE les échéances des dossiers encore à faire, et prévient", async () => {
    await asUser(USER.admin, async (client) => {
      await withoutRls(client, async () => {
        await client.query(
          "update public.obligation_occurrences set owner_id = $1, status = 'TODO' where id = $2",
          [USER.manager, fiscalOccurrence],
        );
        // referential.manage est exigé par la fonction ; ADMIN le détient.
      });

      const updates = JSON.stringify([
        {
          occurrence_id: fiscalOccurrence,
          legal_due_date: "2027-01-15",
          internal_due_date: "2027-01-10",
        },
      ]);

      const { rows } = await client.query<{ n: number }>(
        "select public.apply_due_date_updates($1::jsonb, $2) as n",
        [updates, "ajout du jour férié Aïd el-Fitr 2027"],
      );
      expect(rows[0]?.n).toBe(1);

      const notified = await withoutRls(client, async () => {
        const result = await client.query<{ recipient_id: string; reason: string }>(
          "select recipient_id, reason from public.notifications where kind = 'HOLIDAY_CALENDAR_CHANGED'",
        );
        return result.rows;
      });

      // Un calendrier qui se déplace en silence est pire qu'un calendrier faux :
      // on continue de se fier à la date qu'on avait notée.
      expect(notified[0]?.recipient_id).toBe(USER.manager);
      expect(notified[0]?.reason).toContain("Aïd el-Fitr");
    });
  });

  it("ne touche PAS un dossier déjà engagé", async () => {
    await asUser(USER.admin, async (client) => {
      await withoutRls(client, async () => {
        // On POSE un état de départ : le trigger de transition refuserait cet
        // UPDATE, l'administrateur ne détenant pas `occurrence.write`.
        await client.query(
          "alter table public.obligation_occurrences disable trigger trg_occurrences_20_validate_transition",
        );
        await client.query(
          "update public.obligation_occurrences set status = 'IN_PROGRESS' where id = $1",
          [fiscalOccurrence],
        );
        await client.query(
          "alter table public.obligation_occurrences enable trigger trg_occurrences_20_validate_transition",
        );
      });

      const { rows } = await client.query<{ n: number }>(
        "select public.apply_due_date_updates($1::jsonb, $2) as n",
        [
          JSON.stringify([
            {
              occurrence_id: fiscalOccurrence,
              legal_due_date: "2027-02-15",
              internal_due_date: "2027-02-10",
            },
          ]),
          "second ajout",
        ],
      );
      // On ne déplace pas le sol sous les pieds de quelqu'un qui a commencé.
      expect(rows[0]?.n).toBe(0);
    });
  });
});

describe("agrégats du tableau de bord", () => {
  it("cloisonne par domaine : chacun ne voit que le sien", async () => {
    await pool.query("select public.refresh_dashboard_views()");

    const fiscalDomains = await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ domain_id: string }>(
        "select domain_id from public.dashboard_workload_for_caller()",
      );
      return rows.map((row) => row.domain_id);
    });

    const socialDomains = await asUser(USER.rh, async (client) => {
      const { rows } = await client.query<{ domain_id: string }>(
        "select domain_id from public.dashboard_workload_for_caller()",
      );
      return rows.map((row) => row.domain_id);
    });

    // ⚠️ Un agrégat fuit aussi sûrement qu'une liste : les deux ensembles ne
    // doivent partager aucun domaine.
    expect(fiscalDomains.length).toBeGreaterThan(0);
    expect(fiscalDomains.some((id) => socialDomains.includes(id))).toBe(false);
  });

  it("les vues matérialisées ne sont accessibles à PERSONNE en direct", async () => {
    await asUser(USER.manager, async (client) => {
      for (const view of [
        "dashboard_compliance_monthly",
        "dashboard_upcoming_load",
        "dashboard_late_reasons",
        "dashboard_workload",
        "dashboard_health",
      ]) {
        await expectRefusal(
          client,
          () => client.query(`select * from public.${view}`),
          /permission denied/,
        );
      }
    });
  });

  it("ADMIN ne voit AUCUN agrégat métier", async () => {
    await asUser(USER.admin, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        "select count(*)::int as n from public.dashboard_workload_for_caller()",
      );
      // ADMIN est volontairement privé de occurrence.read : il administre
      // l'outil, il ne lit pas les dossiers. Les agrégats suivent cette règle.
      expect(rows[0]?.n).toBe(0);
    });
  });
});

describe("bandeau d'alertes", () => {
  it("signale l'ABSENCE de sauvegarde, et pas seulement son échec", async () => {
    await asUser(USER.admin, async (client) => {
      const { rows } = await client.query<{ code: string }>(
        "select code from public.dashboard_alerts()",
      );
      // Une table vide traitée comme « tout va bien » ferait de ce bandeau un décor.
      expect(rows.map((row) => row.code)).toContain("BACKUP_STALE");
    });
  });

  it("se tait une fois une sauvegarde récente enregistrée", async () => {
    await asUser(USER.admin, async (client) => {
      await withoutRls(client, async () => {
        await client.query(
          `insert into public.backup_runs (status, finished_at) values ('SUCCEEDED', now())`,
        );
      });

      const { rows } = await client.query<{ code: string }>(
        "select code from public.dashboard_alerts()",
      );
      expect(rows.map((row) => row.code)).not.toContain("BACKUP_STALE");
    });
  });

  it("n'annonce l'alerte de sauvegarde qu'à qui administre l'installation", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ code: string }>(
        "select code from public.dashboard_alerts()",
      );
      expect(rows.map((row) => row.code)).not.toContain("BACKUP_STALE");
    });
  });

  it("signale les dossiers CRITICAL en retard, à qui les voit", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ code: string; total: number }>(
        "select code, total from public.dashboard_alerts()",
      );
      const critical = rows.find((row) => row.code === "CRITICAL_OVERDUE");
      expect(critical?.total).toBeGreaterThan(0);
    });

    await asUser(USER.rh, async (client) => {
      const { rows } = await client.query<{ code: string }>(
        "select code from public.dashboard_alerts()",
      );
      // Le dossier critique est fiscal : l'agent social ne doit pas en déduire
      // l'existence par un compteur.
      expect(rows.map((row) => row.code)).not.toContain("CRITICAL_OVERDUE");
    });
  });
});

describe("journal d'audit", () => {
  it("journalise l'EXPORT lui-même", async () => {
    await asUser(USER.direction, async (client) => {
      await client.query("select public.log_audit_export($1::jsonb, $2)", [
        JSON.stringify({ from: "2026-01-01", action: "UPDATE" }),
        1234,
      ]);

      const { rows } = await withoutRls(client, async () => {
        const result = await client.query<{ after: { row_count: number } }>(
          `select after from public.audit_log
            where action = 'EXPORT' and entity_table = 'audit_log'
            order by occurred_at desc limit 1`,
        );
        return result;
      });

      // Le seul geste capable de faire sortir toute la traçabilité de
      // l'entreprise ne peut pas être le seul à ne pas en laisser.
      expect(rows[0]?.after.row_count).toBe(1234);
    });
  });

  it("REFUSE l'export à qui ne lit pas le journal", async () => {
    await asUser(USER.manager, async (client) => {
      await expectRefusal(
        client,
        () => client.query("select public.log_audit_export('{}'::jsonb, 1)"),
        /audit\.read requis/,
      );
    });
  });
});
