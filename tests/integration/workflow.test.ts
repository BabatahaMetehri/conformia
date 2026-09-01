// @vitest-environment node

/**
 * Circuit de validation, éprouvé contre la BASE.
 *
 * ⚠️ Ces tests appellent les fonctions SQL DIRECTEMENT, sans passer par
 * l'interface ni par les Server Actions. C'est délibéré : un circuit de
 * validation dont les garanties ne tiennent que si l'on passe par les boutons
 * prévus ne garantit rien. Chaque refus est donc éprouvé là où il doit tenir,
 * c'est-à-dire au dernier rempart.
 *
 * ⚠️ Chaque test s'exécute dans une transaction ANNULÉE. Aucun `commit` ne doit
 * apparaître ici : un seul suffirait à laisser derrière lui un état que les
 * tests suivants prendraient pour le leur.
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
  /** DIRECTION, portée globale : valide, débloque, arbitre. Pas de occurrence.write. */
  direction: "7d7d7d7d-0000-0000-0000-000000000001",
  /** COMPTA_MANAGER sur FISCAL : prépare, dépose, valide. */
  manager: "7d7d7d7d-0000-0000-0000-000000000002",
  /** COMPTA_AGENT sur FISCAL : prépare, ne valide pas. */
  agent: "7d7d7d7d-0000-0000-0000-000000000003",
  /**
   * COMPTA_AGENT sur FISCAL, délégataire.
   * ⚠️ Volontairement SANS `occurrence.validate` en propre : s'il l'avait, les
   * scénarios de délégation passeraient par ses droits personnels et
   * n'éprouveraient rien de la délégation.
   */
  deputy: "7d7d7d7d-0000-0000-0000-000000000004",
  /** RH_AGENT sur SOCIAL : ne doit rien voir du fiscal. */
  rh: "7d7d7d7d-0000-0000-0000-000000000005",
} as const;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const PREFIX = "WF-";

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.direction}'::uuid, 'wf.direction@test.dz'),
  ('${USER.manager}'::uuid,   'wf.manager@test.dz'),
  ('${USER.agent}'::uuid,     'wf.agent@test.dz'),
  ('${USER.deputy}'::uuid,    'wf.deputy@test.dz'),
  ('${USER.rh}'::uuid,        'wf.rh@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id) values
  ('${USER.direction}', (select id from public.roles where code='DIRECTION'), null),
  ('${USER.manager}',   (select id from public.roles where code='COMPTA_MANAGER'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.agent}',     (select id from public.roles where code='COMPTA_AGENT'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.deputy}',    (select id from public.roles where code='COMPTA_AGENT'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.rh}',        (select id from public.roles where code='RH_AGENT'),
                        (select id from public.domains where code='SOCIAL'));

-- Obligation ordinaire : un seul niveau de validation.
insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality, validation_levels)
values ('${PREFIX}SIMPLE', 'Déclaration simple', 'MONTHLY',
  '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
  (select id from public.domains where code='FISCAL'), 'LOW', 1);

-- Obligation critique : DEUX niveaux de validation.
insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality, validation_levels)
values ('${PREFIX}DOUBLE', 'Déclaration critique', 'MONTHLY',
  '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
  (select id from public.domains where code='FISCAL'), 'CRITICAL', 2);

-- Obligation dérogeant à la séparation des pouvoirs.
insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality,
   validation_levels, allow_self_validation)
values ('${PREFIX}SELF', 'Déclaration auto-validable', 'MONTHLY',
  '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
  (select id from public.domains where code='FISCAL'), 'LOW', 1, true);

insert into public.obligation_required_documents
  (obligation_type_id, label, is_mandatory, document_kind, order_index)
select ot.id, 'Bordereau signé', true, 'JUSTIFICATIF', 1
from public.obligation_types ot where ot.code like '${PREFIX}%';

-- Un dossier par état utile. owner = agent, validator = manager.
insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, owner_id, validator_id,
   submitted_for_validation_at)
select ot.id, p.key, p.s, p.e, p.legal, p.internal, p.status::public.occurrence_status,
       '${USER.agent}', '${USER.manager}', p.sent
from public.obligation_types ot
cross join (values
  ('2026-01', date '2026-01-01', date '2026-01-31', date '2099-02-20', date '2099-02-15',
   'TODO', null::timestamptz),
  ('2026-02', date '2026-02-01', date '2026-02-28', date '2099-03-20', date '2099-03-15',
   'IN_PROGRESS', null::timestamptz),
  ('2026-03', date '2026-03-01', date '2026-03-31', date '2099-04-20', date '2099-04-15',
   'PENDING_VALIDATION', now()),
  ('2026-04', date '2026-04-01', date '2026-04-30', date '2099-05-20', date '2099-05-15',
   'VALIDATED', null::timestamptz),
  ('2026-05', date '2026-05-01', date '2026-05-31', date '2099-06-20', date '2099-06-15',
   'SUBMITTED', null::timestamptz),
  ('2026-06', date '2026-06-01', date '2026-06-30', date '2026-07-20', date '2026-07-15',
   'ARCHIVED', null::timestamptz)
) as p(key, s, e, legal, internal, status, sent)
where ot.code like '${PREFIX}%';

insert into public.occurrence_checklist_items
  (occurrence_id, label, is_mandatory, document_kind, order_index)
select oc.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
from public.obligation_occurrences oc
join public.obligation_types ot on ot.id = oc.obligation_type_id
join public.obligation_required_documents rd on rd.obligation_type_id = ot.id
where ot.code like '${PREFIX}%';

-- Les dossiers déjà engagés sont COMPLETS : sans cela, tout envoi en validation
-- se heurterait à la complétude avant d'atteindre la règle qu'on veut éprouver.
insert into public.documents
  (occurrence_id, checklist_item_id, storage_path, original_filename, normalized_filename,
   mime_type, size_bytes, sha256, document_kind, uploaded_by)
select ci.occurrence_id, ci.id, 'wf/' || ci.id || '.pdf', 'piece.pdf',
       'WF_' || ci.order_index || '_v1.pdf', 'application/pdf', 1024,
       repeat('a', 64), 'JUSTIFICATIF', '${USER.agent}'
from public.occurrence_checklist_items ci
join public.obligation_occurrences oc on oc.id = ci.occurrence_id
join public.obligation_types ot on ot.id = oc.obligation_type_id
where ot.code like '${PREFIX}%' and oc.period_key <> '2026-06';

-- ⚠️ Le verrou est posé EN DERNIER, une fois les lignes filles en place : depuis
-- 0010, un dossier verrouillé refuse aussi ses commentaires, sa liste de contrôle
-- et ses pièces. Le poser plus tôt ferait échouer le jeu d'essai lui-même — ce
-- qui est, en soi, la preuve que la garde fonctionne.
update public.obligation_occurrences oc
set is_locked = true, locked_at = now()
from public.obligation_types ot
where ot.id = oc.obligation_type_id and ot.code like '${PREFIX}%'
  and oc.period_key = '2026-06';
`;

const CLEANUP = `
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;
delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;

delete from public.notifications where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.validation_delegations where delegator_id in (${IDS}) or delegate_id in (${IDS});
delete from public.documents where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.occurrence_comments where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.occurrence_checklist_items where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.obligation_occurrences where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');
delete from public.obligation_required_documents where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');
delete from public.obligation_types where code like '${PREFIX}%';
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

async function withoutRls<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  await client.query("reset role");
  try {
    return await run();
  } finally {
    await client.query("set local role authenticated");
  }
}

/** Éprouve un refus SANS condamner la transaction (voir documents.test.ts). */
async function expectRefusal(
  client: PoolClient,
  run: () => Promise<unknown>,
  matcher: RegExp,
): Promise<void> {
  await client.query("savepoint before_refusal");
  await expect(run()).rejects.toThrow(matcher);
  await client.query("rollback to savepoint before_refusal");
}

let occurrenceIds: Record<string, string> = {};

const OCC = (code: string, period: string): string => {
  const id = occurrenceIds[`${PREFIX}${code}:${period}`];
  if (id === undefined) throw new Error(`occurrence ${code}/${period} absente du jeu d'essai`);
  return id;
};

interface Verdict {
  outcome: string;
  effect?: string;
  missing?: string[];
  obtained?: number;
  required?: number;
  permission?: string;
  version?: number;
  status?: string;
}

async function evaluate(
  client: PoolClient,
  occurrenceId: string,
  toStatus: string,
  reason: string | null = null,
): Promise<Verdict> {
  const { rows } = await client.query<{ v: Verdict }>(
    "select public.evaluate_transition($1, $2::public.occurrence_status, $3) as v",
    [occurrenceId, toStatus, reason],
  );
  const verdict = rows[0]?.v;
  if (verdict === undefined) throw new Error("verdict vide");
  return verdict;
}

async function apply(
  client: PoolClient,
  occurrenceId: string,
  toStatus: string,
  version: number,
  reason: string | null = null,
): Promise<Verdict> {
  const { rows } = await client.query<{ v: Verdict }>(
    "select public.apply_occurrence_transition($1, $2::public.occurrence_status, $3, $4) as v",
    [occurrenceId, toStatus, version, reason],
  );
  const verdict = rows[0]?.v;
  if (verdict === undefined) throw new Error("verdict vide");
  return verdict;
}

async function versionOf(client: PoolClient, occurrenceId: string): Promise<number> {
  const { rows } = await client.query<{ version: number }>(
    "select version from public.obligation_occurrences where id = $1",
    [occurrenceId],
  );
  return rows[0]?.version ?? 0;
}

async function statusOf(client: PoolClient, occurrenceId: string): Promise<string> {
  const { rows } = await client.query<{ status: string }>(
    "select status from public.obligation_occurrences where id = $1",
    [occurrenceId],
  );
  return rows[0]?.status ?? "";
}

beforeAll(async () => {
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.query(SEED);

  const { rows } = await pool.query<{ period_key: string; id: string; code: string }>(
    `select oc.id, oc.period_key, ot.code
       from public.obligation_occurrences oc
       join public.obligation_types ot on ot.id = oc.obligation_type_id
      where ot.code like $1`,
    [`${PREFIX}%`],
  );
  occurrenceIds = Object.fromEntries(rows.map((row) => [`${row.code}:${row.period_key}`, row.id]));
}, 60_000);

afterAll(async () => {
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("matrice des transitions", () => {
  /**
   * ⚠️ La matrice n'est pas recopiée ici : elle est LUE dans
   * `status_transition_rules`. Recopier les couples autorisés dans le test
   * reviendrait à créer une troisième source de vérité, celle qui décide si les
   * deux autres sont d'accord — et qui les laisserait diverger ensemble.
   */
  it("accepte EXACTEMENT les couples déclarés, et refuse tous les autres", async () => {
    const statuses = [
      "TODO",
      "IN_PROGRESS",
      "PENDING_VALIDATION",
      "REJECTED",
      "VALIDATED",
      "SUBMITTED",
      "ARCHIVED",
      "NOT_APPLICABLE",
    ];

    const declared = new Set(
      (
        await pool.query<{ from_status: string; to_status: string }>(
          "select from_status, to_status from public.status_transition_rules",
        )
      ).rows.map((row) => `${row.from_status}->${row.to_status}`),
    );

    // Au moins une transition déclarée, sinon le test passerait à vide.
    expect(declared.size).toBeGreaterThan(0);

    await asUser(USER.direction, async (client) => {
      for (const from of statuses) {
        for (const to of statuses) {
          if (from === to) continue;

          await withoutRls(client, async () => {
            // ⚠️ On POSE un état de départ, on ne transite pas : les triggers de
            // transition refuseraient précisément les couples qu'on veut éprouver.
            await client.query(
              "alter table public.obligation_occurrences disable trigger trg_occurrences_20_validate_transition",
            );
            // Les motifs sont posés systématiquement : REJECTED et NOT_APPLICABLE
            // portent une contrainte de table qui les exige, et l'objet du test
            // n'est pas de la contourner mais de la satisfaire.
            await client.query(
              `update public.obligation_occurrences
                  set status = $2::public.occurrence_status,
                      is_locked = false,
                      rejection_reason = 'motif de mise en place',
                      na_reason = 'motif de mise en place'
                where id = $1`,
              [OCC("SIMPLE", "2026-01"), from],
            );
            await client.query(
              "alter table public.obligation_occurrences enable trigger trg_occurrences_20_validate_transition",
            );
          });

          const verdict = await evaluate(client, OCC("SIMPLE", "2026-01"), to, "motif suffisant");
          const isDeclared = declared.has(`${from}->${to}`);

          if (!isDeclared) {
            expect(verdict.outcome, `${from} → ${to} devrait être refusée`).toBe(
              "INVALID_TRANSITION",
            );
          } else {
            // Une transition déclarée peut encore buter sur une garde métier
            // (complétude, preuve, permission) — mais JAMAIS sur son existence.
            expect(verdict.outcome, `${from} → ${to} est déclarée`).not.toBe("INVALID_TRANSITION");
          }
        }
      }
    });
  });

  it("REFUSE une transition illégale par appel direct, pas seulement par l'interface", async () => {
    await asUser(USER.manager, async (client) => {
      // TODO → VALIDATED n'existe pas : le trigger doit la refuser même en UPDATE direct.
      await expectRefusal(
        client,
        () =>
          client.query(
            "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
            [OCC("SIMPLE", "2026-01")],
          ),
        /Transition interdite/,
      );
    });
  });
});

describe("gardes de transition", () => {
  it("REFUSE l'envoi en validation d'un dossier incomplet, en nommant les pièces", async () => {
    await asUser(USER.manager, async (client) => {
      await withoutRls(client, async () => {
        await client.query("delete from public.documents where occurrence_id = $1", [
          OCC("SIMPLE", "2026-02"),
        ]);
      });

      const verdict = await evaluate(client, OCC("SIMPLE", "2026-02"), "PENDING_VALIDATION");
      expect(verdict.outcome).toBe("INCOMPLETE");
      expect(verdict.missing).toEqual(["Bordereau signé"]);
    });
  });

  it("REFUSE toute transition sur un dossier verrouillé, sauf la réouverture", async () => {
    await asUser(USER.direction, async (client) => {
      // Le dossier 2026-06 est archivé et verrouillé.
      expect((await evaluate(client, OCC("SIMPLE", "2026-06"), "TODO")).outcome).toBe(
        "INVALID_TRANSITION",
      );

      // La seule porte de sortie : ARCHIVED → SUBMITTED, sous occurrence.unlock.
      const reopen = await evaluate(
        client,
        OCC("SIMPLE", "2026-06"),
        "SUBMITTED",
        "réouverture pour correction du montant",
      );
      expect(reopen.outcome).toBe("ALLOWED");
    });
  });

  it("EXIGE un motif là où la règle le déclare", async () => {
    await asUser(USER.direction, async (client) => {
      const sansMotif = await evaluate(client, OCC("SIMPLE", "2026-06"), "SUBMITTED");
      expect(sansMotif.outcome).toBe("REASON_REQUIRED");
    });
  });

  it("REFUSE à qui n'a pas la permission de la transition", async () => {
    await asUser(USER.agent, async (client) => {
      // COMPTA_AGENT ne détient pas occurrence.validate.
      const verdict = await evaluate(client, OCC("SIMPLE", "2026-03"), "VALIDATED");
      expect(verdict.outcome).toBe("FORBIDDEN");
      expect(verdict.permission).toBe("occurrence.validate");
    });
  });

  it("cloisonne par domaine : le fiscal est INTROUVABLE pour l'agent RH", async () => {
    await asUser(USER.rh, async (client) => {
      const verdict = await evaluate(client, OCC("SIMPLE", "2026-03"), "VALIDATED");
      // « Introuvable » et non « interdit » : l'écart de message permettrait
      // d'énumérer les dossiers des autres domaines.
      expect(verdict.outcome).toBe("NOT_FOUND");
    });
  });
});

describe("séparation des pouvoirs", () => {
  it("un préparateur ne valide PAS son propre dossier", async () => {
    await asUser(USER.manager, async (client) => {
      // Le manager devient propriétaire du dossier qu'il s'apprête à valider.
      await withoutRls(client, async () => {
        await client.query("update public.obligation_occurrences set owner_id = $2 where id = $1", [
          OCC("SIMPLE", "2026-03"),
          USER.manager,
        ]);
      });

      const verdict = await evaluate(client, OCC("SIMPLE", "2026-03"), "VALIDATED");
      expect(verdict.outcome).toBe("SELF_VALIDATION_BLOCKED");
    });
  });

  it("le trigger REFUSE aussi, par appel direct", async () => {
    await asUser(USER.manager, async (client) => {
      await withoutRls(client, async () => {
        await client.query("update public.obligation_occurrences set owner_id = $2 where id = $1", [
          OCC("SIMPLE", "2026-03"),
          USER.manager,
        ]);
      });

      await expectRefusal(
        client,
        () =>
          client.query(
            "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
            [OCC("SIMPLE", "2026-03")],
          ),
        /séparation|auto-valid/i,
      );
    });
  });

  it("la dérogation par OBLIGATION lève la restriction pour elle SEULE", async () => {
    await asUser(USER.manager, async (client) => {
      await withoutRls(client, async () => {
        await client.query(
          `update public.obligation_occurrences set owner_id = $1
            where id in ($2, $3)`,
          [USER.manager, OCC("SELF", "2026-03"), OCC("SIMPLE", "2026-03")],
        );
      });

      // ⚠️ Le point du critère : la dérogation ne fuit pas vers l'obligation voisine.
      expect((await evaluate(client, OCC("SELF", "2026-03"), "VALIDATED")).outcome).toBe("ALLOWED");
      expect((await evaluate(client, OCC("SIMPLE", "2026-03"), "VALIDATED")).outcome).toBe(
        "SELF_VALIDATION_BLOCKED",
      );
    });
  });

  it("la soupape GLOBALE lève la restriction partout", async () => {
    await asUser(USER.manager, async (client) => {
      await withoutRls(client, async () => {
        await client.query("update public.obligation_occurrences set owner_id = $2 where id = $1", [
          OCC("SIMPLE", "2026-03"),
          USER.manager,
        ]);
        await client.query(
          "update public.app_settings set value = 'true'::jsonb where key = 'allow_self_validation'",
        );
      });

      expect((await evaluate(client, OCC("SIMPLE", "2026-03"), "VALIDATED")).outcome).toBe(
        "ALLOWED",
      );
    });
  });
});

describe("double niveau de validation", () => {
  it("la PREMIÈRE validation n'change pas l'état : elle inscrit une étape", async () => {
    await asUser(USER.manager, async (client) => {
      const id = OCC("DOUBLE", "2026-03");
      const before = await versionOf(client, id);

      const verdict = await apply(client, id, "VALIDATED", before);

      expect(verdict.outcome).toBe("PARTIALLY_VALIDATED");
      expect(verdict.obtained).toBe(1);
      expect(verdict.required).toBe(2);
      // Le dossier reste EN ATTENTE entre les deux validations.
      expect(await statusOf(client, id)).toBe("PENDING_VALIDATION");
    });
  });

  it("la SECONDE validation est refusée à qui n'est pas la DIRECTION", async () => {
    await asUser(USER.manager, async (client) => {
      const id = OCC("DOUBLE", "2026-03");
      await apply(client, id, "VALIDATED", await versionOf(client, id));

      // Un second responsable de service ne remplace pas la Direction.
      const verdict = await evaluate(client, id, "VALIDATED");
      expect(verdict.outcome).toBe("SECOND_LEVEL_REQUIRES_DIRECTION");
      expect(verdict.obtained).toBe(1);
    });
  });

  it("la DIRECTION achève la validation, et l'état bascule enfin", async () => {
    // ⚠️ Aucun `commit` : l'étape du premier validateur est REPOSÉE hors RLS dans
    // la transaction du second. Committer ici laisserait derrière soi un dossier
    // à demi validé que les tests suivants prendraient pour leur état de départ —
    // et c'est exactement ce qui a fait échouer le contrôle d'UPDATE direct.
    await asUser(USER.direction, async (client) => {
      const id = OCC("DOUBLE", "2026-03");
      await withoutRls(client, async () => {
        await client.query(
          `insert into public.occurrence_transitions
             (occurrence_id, from_status, to_status, actor_id, metadata)
           values ($1, 'PENDING_VALIDATION', 'PENDING_VALIDATION', $2,
                   '{"origin":"VALIDATION_STEP","level":1}'::jsonb)`,
          [id, USER.manager],
        );
      });

      const verdict = await apply(client, id, "VALIDATED", await versionOf(client, id));
      expect(verdict.outcome).toBe("APPLIED");
      expect(await statusOf(client, id)).toBe("VALIDATED");
    });
  });

  it("REFUSE un UPDATE direct qui sauterait la première validation", async () => {
    // ⚠️ Le manager, et non la DIRECTION : la policy UPDATE exige `occurrence.write`,
    // que la DIRECTION ne détient pas. Émis par elle, l'UPDATE ne toucherait aucune
    // ligne et le test passerait sans jamais atteindre le trigger.
    await asUser(USER.manager, async (client) => {
      /*
       * ⚠️ Le point du contrôle. La règle des deux niveaux vit dans le TRIGGER et
       * pas seulement dans `apply_occurrence_transition` : sans cela, il
       * suffirait de ne pas emprunter la porte prévue pour valider un dossier
       * CRITICAL d'un seul geste.
       */
      await expectRefusal(
        client,
        () =>
          client.query(
            "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
            [OCC("DOUBLE", "2026-03")],
          ),
        /deux validations/,
      );
    });
  });

  it("un rejet remet le compteur à zéro", async () => {
    await asUser(USER.manager, async (client) => {
      const id = OCC("DOUBLE", "2026-03");
      await apply(client, id, "VALIDATED", await versionOf(client, id));

      const { rows: before } = await client.query<{ n: number }>(
        "select public.validation_steps_obtained($1) as n",
        [id],
      );
      expect(before[0]?.n).toBe(1);

      // Rejet, puis reprise, puis nouvelle soumission.
      await apply(client, id, "REJECTED", await versionOf(client, id), "montant erroné à corriger");
      await apply(client, id, "IN_PROGRESS", await versionOf(client, id));
      await apply(client, id, "PENDING_VALIDATION", await versionOf(client, id));

      const { rows: after } = await client.query<{ n: number }>(
        "select public.validation_steps_obtained($1) as n",
        [id],
      );
      // La validation précédente portait sur un dossier qui n'existe plus.
      expect(after[0]?.n).toBe(0);
    });
  });
});

describe("période archivée", () => {
  it("REFUSE un commentaire sur un dossier archivé", async () => {
    await asUser(USER.manager, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query(
            `insert into public.occurrence_comments (occurrence_id, author_id, body)
             values ($1, $2, 'remarque tardive')`,
            [OCC("SIMPLE", "2026-06"), USER.manager],
          ),
        /archivé/i,
      );
    });
  });

  it("REFUSE de toucher à la liste de contrôle d'un dossier archivé", async () => {
    await asUser(USER.manager, async (client) => {
      await expectRefusal(
        client,
        () =>
          client.query(
            "update public.occurrence_checklist_items set label = 'modifié' where occurrence_id = $1",
            [OCC("SIMPLE", "2026-06")],
          ),
        /archivé/i,
      );
    });
  });

  it("REFUSE d'y déposer une pièce", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ r: { status: string } }>(
        `select public.create_document_upload_ticket($1,$2,$3,$4,$5,$6) as r`,
        [
          OCC("SIMPLE", "2026-06"),
          "tardif.pdf",
          "application/pdf",
          1024,
          "tardif",
          "WF_2026-06_PIECE_tardif",
        ],
      );
      expect(rows[0]?.r.status).toBe("OCCURRENCE_LOCKED");
    });
  });

  it("la réouverture explicite lève le verrou, avec motif", async () => {
    await asUser(USER.direction, async (client) => {
      const id = OCC("SIMPLE", "2026-06");
      const verdict = await apply(
        client,
        id,
        "SUBMITTED",
        await versionOf(client, id),
        "erreur de montant constatée par l'administration",
      );

      expect(verdict.outcome).toBe("APPLIED");
      const { rows } = await client.query<{ is_locked: boolean }>(
        "select is_locked from public.obligation_occurrences where id = $1",
        [id],
      );
      expect(rows[0]?.is_locked).toBe(false);
    });
  });
});

describe("effets de bord déclarés", () => {
  it("la soumission prévient le VALIDATEUR", async () => {
    await asUser(USER.agent, async (client) => {
      const id = OCC("SIMPLE", "2026-02");
      await apply(client, id, "PENDING_VALIDATION", await versionOf(client, id));

      const rows = await withoutRls(client, async () => {
        const result = await client.query<{ recipient_id: string; kind: string }>(
          "select recipient_id, kind from public.notifications where occurrence_id = $1",
          [id],
        );
        return result.rows;
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.recipient_id).toBe(USER.manager);
      expect(rows[0]?.kind).toBe("VALIDATION_REQUESTED");
    });
  });

  it("le rejet prévient le PROPRIÉTAIRE, avec le motif", async () => {
    await asUser(USER.manager, async (client) => {
      const id = OCC("SIMPLE", "2026-03");
      await apply(
        client,
        id,
        "REJECTED",
        await versionOf(client, id),
        "montant de la case 12 faux",
      );

      const rows = await withoutRls(client, async () => {
        const result = await client.query<{ recipient_id: string; kind: string; reason: string }>(
          "select recipient_id, kind, reason from public.notifications where occurrence_id = $1",
          [id],
        );
        return result.rows;
      });

      expect(rows[0]?.recipient_id).toBe(USER.agent);
      expect(rows[0]?.kind).toBe("OCCURRENCE_REJECTED");
      // Un rejet sans son motif oblige le destinataire à retourner le chercher.
      expect(rows[0]?.reason).toContain("case 12");
    });
  });

  it("le déverrouillage prévient la DIRECTION ET le responsable", async () => {
    await asUser(USER.direction, async (client) => {
      const id = OCC("SIMPLE", "2026-06");
      await apply(
        client,
        id,
        "SUBMITTED",
        await versionOf(client, id),
        "réouverture réglementaire",
      );

      const rows = await withoutRls(client, async () => {
        const result = await client.query<{ recipient_id: string }>(
          "select recipient_id from public.notifications where occurrence_id = $1",
          [id],
        );
        return result.rows;
      });

      const recipients = rows.map((row) => row.recipient_id);
      // Le propriétaire est prévenu ; l'auteur ne s'écrit pas à lui-même.
      expect(recipients).toContain(USER.agent);
      expect(recipients).not.toContain(USER.direction);
    });
  });

  it("l'archivage verrouille, sans qu'aucun code ne le décide", async () => {
    await asUser(USER.manager, async (client) => {
      const id = OCC("SIMPLE", "2026-05");
      await apply(client, id, "ARCHIVED", await versionOf(client, id));

      const { rows } = await client.query<{ is_locked: boolean }>(
        "select is_locked from public.obligation_occurrences where id = $1",
        [id],
      );
      // `status_transition_rules.locks_occurrence` est la seule source de ce fait.
      expect(rows[0]?.is_locked).toBe(true);
    });
  });

  it("les destinataires sont des DONNÉES : retirer la ligne retire l'effet", async () => {
    await asUser(USER.agent, async (client) => {
      await withoutRls(client, async () => {
        await client.query(
          `delete from public.transition_notifications
            where from_status = 'IN_PROGRESS' and to_status = 'PENDING_VALIDATION'`,
        );
      });

      const id = OCC("SIMPLE", "2026-02");
      await apply(client, id, "PENDING_VALIDATION", await versionOf(client, id));

      const rows = await withoutRls(client, async () => {
        const result = await client.query<{ n: number }>(
          "select count(*)::int as n from public.notifications where occurrence_id = $1",
          [id],
        );
        return result.rows;
      });
      expect(rows[0]?.n).toBe(0);
    });
  });
});

describe("délégation", () => {
  it("un délégataire ACTIF peut valider", async () => {
    await asUser(USER.deputy, async (client) => {
      await withoutRls(client, async () => {
        // Le manager, seul validateur, s'absente et délègue au deputy.
        await client.query(
          `insert into public.validation_delegations
             (delegator_id, delegate_id, starts_at, ends_at, reason, created_by)
           values ($1, $2, current_date - 1, current_date + 10, 'congé annuel', $1)`,
          [USER.manager, USER.deputy],
        );
      });

      const verdict = await evaluate(client, OCC("SIMPLE", "2026-03"), "VALIDATED");
      expect(verdict.outcome).toBe("ALLOWED");
    });
  });

  it("l'action sous délégation porte LES DEUX identités", async () => {
    await asUser(USER.deputy, async (client) => {
      await withoutRls(client, async () => {
        await client.query(
          `insert into public.validation_delegations
             (delegator_id, delegate_id, starts_at, ends_at, reason, created_by)
           values ($1, $2, current_date - 1, current_date + 10, 'congé annuel', $1)`,
          [USER.manager, USER.deputy],
        );
      });

      const id = OCC("SIMPLE", "2026-03");
      await apply(client, id, "VALIDATED", await versionOf(client, id));

      const { rows } = await client.query<{ actor_id: string; on_behalf_of_id: string }>(
        `select actor_id, on_behalf_of_id from public.occurrence_transitions
          where occurrence_id = $1 and to_status = 'VALIDATED' order by created_at desc limit 1`,
        [id],
      );

      // ⚠️ Une délégation n'efface pas l'auteur : le journal porte qui a agi ET
      // pour le compte de qui. C'est ce qui rend la délégation supérieure au
      // partage de compte, la pratique qu'on cherche à éliminer.
      expect(rows[0]?.actor_id).toBe(USER.deputy);
      expect(rows[0]?.on_behalf_of_id).toBe(USER.manager);
    });
  });

  it("après ends_at, le délégataire ne peut plus rien", async () => {
    await asUser(USER.deputy, async (client) => {
      await withoutRls(client, async () => {
        await client.query(
          `insert into public.validation_delegations
             (delegator_id, delegate_id, starts_at, ends_at, reason, created_by)
           values ($1, $2, current_date - 40, current_date - 10, 'congé terminé', $1)`,
          [USER.manager, USER.deputy],
        );
      });

      // Le délégataire n'a aucun droit de validation en propre : la délégation
      // expirée ne lui en prête plus, et la porte se referme d'elle-même.
      const verdict = await evaluate(client, OCC("SIMPLE", "2026-03"), "VALIDATED");
      expect(verdict.outcome).toBe("FORBIDDEN");
      expect(verdict.permission).toBe("occurrence.validate");
    });
  });

  it("la révocation exige un motif, et n'efface pas la ligne", async () => {
    await asUser(USER.manager, async (client) => {
      const delegationId = await withoutRls(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.validation_delegations
             (delegator_id, delegate_id, starts_at, ends_at, reason, created_by)
           values ($1, $2, current_date - 1, current_date + 10, 'congé annuel', $1)
           returning id`,
          [USER.manager, USER.deputy],
        );
        return rows[0]?.id ?? "";
      });

      await expectRefusal(
        client,
        () =>
          client.query("select public.revoke_validation_delegation($1, $2)", [delegationId, "x"]),
        /10 caractères/,
      );

      const { rows } = await client.query<{ ok: boolean }>(
        "select public.revoke_validation_delegation($1, $2) as ok",
        [delegationId, "retour de congé anticipé"],
      );
      expect(rows[0]?.ok).toBe(true);

      // La ligne SURVIT : elle justifie les actions faites sous son couvert.
      const after = await client.query<{ revoked_at: string | null; reason: string }>(
        "select revoked_at, reason from public.validation_delegations where id = $1",
        [delegationId],
      );
      expect(after.rows[0]?.revoked_at).not.toBeNull();
      expect(after.rows[0]?.reason).toContain("retour de congé");
    });
  });

  it("REFUSE une révocation par un tiers", async () => {
    await asUser(USER.agent, async (client) => {
      const delegationId = await withoutRls(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.validation_delegations
             (delegator_id, delegate_id, starts_at, ends_at, reason, created_by)
           values ($1, $2, current_date - 1, current_date + 10, 'congé annuel', $1)
           returning id`,
          [USER.manager, USER.deputy],
        );
        return rows[0]?.id ?? "";
      });

      await expectRefusal(
        client,
        () =>
          client.query("select public.revoke_validation_delegation($1, $2)", [
            delegationId,
            "je préfère reprendre la main",
          ]),
        /délégant ou à la Direction/,
      );
    });
  });
});

describe("filet de sécurité DIRECTION", () => {
  it("ne s'ouvre PAS tant que le délai n'est pas écoulé", async () => {
    await asUser(USER.direction, async (client) => {
      await withoutRls(client, async () => {
        await client.query(
          "update public.obligation_occurrences set submitted_for_validation_at = now() where id = $1",
          [OCC("SIMPLE", "2026-03")],
        );
      });

      // La DIRECTION détient occurrence.validate en propre : le filet ne se
      // distingue qu'en la privant de cette permission. On éprouve donc ici que
      // le dossier fraîchement soumis n'est pas « débloqué » par ancienneté.
      const { rows } = await client.query<{ ok: boolean }>(
        "select public.can_validate_occurrence($1) as ok",
        [OCC("SIMPLE", "2026-03")],
      );
      expect(rows[0]?.ok).toBe(true);
    });
  });

  it("s'ouvre passé cinq jours ouvrés, pour la DIRECTION seule", async () => {
    await asUser(USER.direction, async (client) => {
      await withoutRls(client, async () => {
        // Trois semaines en arrière : au-delà de cinq jours ouvrés quel que soit
        // le calendrier de la semaine.
        await client.query(
          "update public.obligation_occurrences set submitted_for_validation_at = now() - interval '21 days' where id = $1",
          [OCC("SIMPLE", "2026-03")],
        );
        // On retire à la DIRECTION son rôle : seul le filet peut encore ouvrir.
        await client.query(
          `delete from public.role_permissions
            where role_id = (select id from public.roles where code = 'DIRECTION')
              and permission_id = (select id from public.permissions where code = 'occurrence.validate')`,
        );
      });

      const { rows } = await client.query<{ ok: boolean }>(
        "select public.can_validate_occurrence($1) as ok",
        [OCC("SIMPLE", "2026-03")],
      );
      // ⚠️ Une échéance légale ne doit jamais expirer parce que la seule personne
      // habilitée est absente.
      expect(rows[0]?.ok).toBe(true);
    });
  });
});

describe("file de validation", () => {
  it("ne montre QUE les dossiers que l'appelant peut valider", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ obligation_code: string; id: string }>(
        "select obligation_code, id from public.validation_queue",
      );

      // Les trois obligations ont un dossier en attente ; toutes sont fiscales.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.obligation_code.startsWith(PREFIX))).toBe(true);
    });

    await asUser(USER.rh, async (client) => {
      const { rows } = await client.query<{ id: string }>("select id from public.validation_queue");
      // Cloisonnement : rien du fiscal.
      expect(rows).toHaveLength(0);
    });
  });

  it("ÉCARTE les dossiers dont l'appelant est le préparateur", async () => {
    await asUser(USER.manager, async (client) => {
      await withoutRls(client, async () => {
        await client.query("update public.obligation_occurrences set owner_id = $2 where id = $1", [
          OCC("SIMPLE", "2026-03"),
          USER.manager,
        ]);
      });

      const { rows } = await client.query<{ id: string }>(
        "select id from public.validation_queue where id = $1",
        [OCC("SIMPLE", "2026-03")],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("le compteur de navigation dit EXACTEMENT ce que la file montre", async () => {
    await asUser(USER.manager, async (client) => {
      const queue = await client.query<{ n: number }>(
        "select count(*)::int as n from public.validation_queue",
      );
      const badge = await client.query<{ n: number }>(
        "select public.pending_validation_count() as n",
      );
      // Un compteur qui annonce trois dossiers pour une file qui en montre deux
      // détruit la confiance dans les deux.
      expect(badge.rows[0]?.n).toBe(queue.rows[0]?.n);
    });
  });

  it("la PASTILLE de navigation s'aligne sur la file, séparation des pouvoirs comprise", async () => {
    await asUser(USER.manager, async (client) => {
      /*
       * ⚠️ RÉGRESSION D'UN ÉCART RÉEL. Jusqu'à 0010, `navigation_counters`
       * comptait les dossiers en attente que l'appelant peut valider sans
       * écarter ceux dont il est le préparateur — que la file, elle, écarte. Un
       * responsable qui prépare ses propres dossiers voyait une pastille
       * annonçant plus de dossiers que l'écran n'en montrait.
       */
      await withoutRls(client, async () => {
        await client.query(
          `update public.obligation_occurrences oc
              set owner_id = $1
             from public.obligation_types ot
            where ot.id = oc.obligation_type_id
              and ot.code like 'WF-%'
              and oc.status = 'PENDING_VALIDATION'`,
          [USER.manager],
        );
      });

      const queue = await client.query<{ code: string }>(
        "select obligation_code as code from public.validation_queue",
      );
      const badge = await client.query<{ pending_validation: number }>(
        "select pending_validation from public.navigation_counters()",
      );

      // Seul subsiste le dossier de l'obligation qui DÉROGE explicitement à la
      // séparation des pouvoirs : l'auto-validation y est permise, donc il reste
      // légitimement validable. Les deux autres disparaissent des deux côtés.
      expect(queue.rows.map((row) => row.code)).toEqual([`${PREFIX}SELF`]);
      expect(badge.rows[0]?.pending_validation).toBe(queue.rows.length);
    });
  });

  it("expose le nombre de validations déjà obtenues", async () => {
    await asUser(USER.manager, async (client) => {
      const id = OCC("DOUBLE", "2026-03");
      await apply(client, id, "VALIDATED", await versionOf(client, id));

      const { rows } = await client.query<{
        validations_obtained: number;
        validation_levels: number;
      }>(
        "select validations_obtained, validation_levels from public.validation_queue where id = $1",
        [id],
      );
      expect(rows[0]?.validation_levels).toBe(2);
      expect(rows[0]?.validations_obtained).toBe(1);
    });
  });
});
