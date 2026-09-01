// @vitest-environment node

/**
 * Fiche d'occurrence, éprouvée contre la BASE.
 *
 * Les garanties de cet écran sont toutes portées par PostgreSQL : refus de
 * soumettre un dossier incomplet, motif de retard obligatoire, verrouillage
 * optimiste, création d'une rectificative, cloisonnement par domaine. Aucune ne
 * se vérifie en relisant du TypeScript — un appel direct à la Server Action
 * contournerait l'interface, et c'est précisément ce que ces tests reproduisent.
 *
 * ⚠️ Chaque test s'exécute dans une transaction ANNULÉE. Aucun `commit` ne doit
 * apparaître ici : un seul suffirait à laisser derrière lui un état que les tests
 * suivants prendraient pour le leur.
 *
 * Prérequis : `supabase start` puis `supabase db reset`.
 * Lancement : `npm run test:rls`.
 */

import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 8 });

const USER = {
  /** DIRECTION, portée globale : valide, mais ne détient PAS occurrence.write. */
  direction: "78787878-0000-0000-0000-000000000001",
  /** COMPTA_MANAGER sur FISCAL : prépare, dépose, valide. */
  manager: "78787878-0000-0000-0000-000000000002",
  /** COMPTA_AGENT sur FISCAL : prépare et dépose, ne valide pas. */
  agent: "78787878-0000-0000-0000-000000000003",
  /** RH_AGENT sur SOCIAL : ne doit rien voir du fiscal. */
  rh: "78787878-0000-0000-0000-000000000004",
} as const;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const PREFIX = "DET-";

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.direction}'::uuid, 'det.direction@test.dz'),
  ('${USER.manager}'::uuid,   'det.manager@test.dz'),
  ('${USER.agent}'::uuid,     'det.agent@test.dz'),
  ('${USER.rh}'::uuid,        'det.rh@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id)
values
  ('${USER.direction}', (select id from public.roles where code='DIRECTION'), null),
  ('${USER.manager}',   (select id from public.roles where code='COMPTA_MANAGER'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.agent}',     (select id from public.roles where code='COMPTA_AGENT'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.rh}',        (select id from public.roles where code='RH_AGENT'),
                        (select id from public.domains where code='SOCIAL'));

-- Obligation dont dépend la principale : alimente le bandeau d'information.
insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality)
values (
  '${PREFIX}DEP', 'Assemblée générale ordinaire', 'ANNUAL',
  '{"anchor":"PERIOD_END","offset_days":180}'::jsonb, '2000-01-01',
  (select id from public.domains where code='FISCAL'), 'HIGH');

insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality,
   requires_proof, depends_on_obligation_type_id)
values (
  '${PREFIX}MAIN', 'Déclaration de charge', 'MONTHLY',
  '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
  (select id from public.domains where code='FISCAL'), 'HIGH',
  true, (select id from public.obligation_types where code='${PREFIX}DEP'));

-- Obligation d'un AUTRE domaine : sert le test de cloisonnement.
insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality)
values (
  '${PREFIX}SOCIAL', 'Déclaration sociale', 'MONTHLY',
  '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
  (select id from public.domains where code='SOCIAL'), 'MEDIUM');

insert into public.obligation_required_documents
  (obligation_type_id, label, is_mandatory, document_kind, order_index)
select ot.id, d.label, d.mandatory, d.kind, d.ord
from public.obligation_types ot
cross join (values
  ('Bordereau signé',  true,  'JUSTIFICATIF',   1),
  ('Annexe de calcul', true,  'JUSTIFICATIF',   2),
  ('Correspondance',   false, 'CORRESPONDANCE', 3)
) as d(label, mandatory, kind, ord)
where ot.code = '${PREFIX}MAIN';

-- Occurrence de l'obligation dont dépend la principale, laissée EN COURS.
insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status)
select id, '2026', '2026-01-01', '2026-12-31', '2027-06-30', '2027-06-15', 'IN_PROGRESS'
from public.obligation_types where code = '${PREFIX}DEP';

insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, submitted_for_validation_at,
   owner_id, validator_id)
select ot.id, p.key, p.start_date, p.end_date, p.legal, p.internal, p.status, p.sent,
       '${USER.agent}'::uuid, '${USER.manager}'::uuid
from public.obligation_types ot
cross join (values
  -- Dossier de travail courant, échéance dans le futur.
  ('2026-01', date '2026-01-01', date '2026-01-31', date '2099-02-20', date '2099-02-15',
   'IN_PROGRESS'::public.occurrence_status, null::timestamptz),
  -- Dossier validé dont l'échéance légale est PASSÉE : motif de retard exigible.
  ('2026-02', date '2026-02-01', date '2026-02-28', date '2026-03-20', date '2026-03-15',
   'VALIDATED'::public.occurrence_status, null::timestamptz),
  -- Dossier déposé : point de départ d'une rectificative.
  ('2026-03', date '2026-03-01', date '2026-03-31', date '2026-04-20', date '2026-04-15',
   'SUBMITTED'::public.occurrence_status, null::timestamptz),
  -- Dossier EN ATTENTE DE VALIDATION, pièces déjà déposées (voir plus bas).
  -- submitted_for_validation_at est renseigné : c'est la condition d'entrée dans
  -- la branche de repli DIRECTION de can_validate_occurrence(), celle qui appelle
  -- add_business_days().
  ('2026-04', date '2026-04-01', date '2026-04-30', date '2099-05-20', date '2099-05-15',
   'PENDING_VALIDATION'::public.occurrence_status, now()),
  -- Périodes antérieures, pour l'onglet dédié.
  ('2025-11', date '2025-11-01', date '2025-11-30', date '2025-12-20', date '2025-12-15',
   'ARCHIVED'::public.occurrence_status, null::timestamptz),
  ('2025-12', date '2025-12-01', date '2025-12-31', date '2026-01-20', date '2026-01-15',
   'ARCHIVED'::public.occurrence_status, null::timestamptz)
) as p(key, start_date, end_date, legal, internal, status, sent)
where ot.code = '${PREFIX}MAIN';

insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status)
select id, '2026-01', '2026-01-01', '2026-01-31', '2099-02-20', '2099-02-15', 'TODO'
from public.obligation_types where code = '${PREFIX}SOCIAL';

-- Liste de contrôle figée, comme le ferait la génération d'occurrences.
insert into public.occurrence_checklist_items
  (occurrence_id, required_document_id, label, is_mandatory, document_kind, order_index)
select oc.id, rd.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
from public.obligation_occurrences oc
join public.obligation_types ot on ot.id = oc.obligation_type_id
join public.obligation_required_documents rd on rd.obligation_type_id = ot.id
where ot.code = '${PREFIX}MAIN';

-- Pièces du dossier 2026-04 : il doit être COMPLET dès le départ, pour que les
-- tests de validation n'aient rien à écrire avant de commencer.
insert into public.documents
  (occurrence_id, checklist_item_id, storage_path, original_filename, normalized_filename,
   mime_type, size_bytes, sha256, document_kind, uploaded_by)
select ci.occurrence_id, ci.id, 'fiscal/seed-' || ci.id || '.pdf', 'piece.pdf',
       'SEED_' || ci.order_index || '_v1.pdf', 'application/pdf', 1024,
       repeat('b', 64), 'JUSTIFICATIF', '${USER.agent}'
from public.occurrence_checklist_items ci
join public.obligation_occurrences oc on oc.id = ci.occurrence_id
join public.obligation_types ot on ot.id = oc.obligation_type_id
where ot.code = '${PREFIX}MAIN' and oc.period_key = '2026-04' and ci.is_mandatory;
`;

const CLEANUP = `
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;
delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;

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

let occurrenceIds: Record<string, string> = {};

async function loadIds(): Promise<void> {
  const { rows } = await pool.query<{ period_key: string; id: string; code: string }>(
    `select oc.id, oc.period_key, ot.code
       from public.obligation_occurrences oc
       join public.obligation_types ot on ot.id = oc.obligation_type_id
      where ot.code like $1`,
    [`${PREFIX}%`],
  );
  occurrenceIds = Object.fromEntries(rows.map((row) => [`${row.code}:${row.period_key}`, row.id]));
}

const MAIN = (period: string): string => {
  const id = occurrenceIds[`${PREFIX}MAIN:${period}`];
  if (id === undefined) throw new Error(`occurrence ${period} absente du jeu d'essai`);
  return id;
};

/**
 * Dépose une pièce sur une ligne de la liste de contrôle.
 *
 * ⚠️ `uploaded_by` DOIT être l'utilisateur courant : la politique d'insertion le
 * compare à `current_profile_id()`. Le figer sur un compte unique faisait échouer
 * tout dépôt joué sous une autre identité.
 */
/**
 * Pose une pièce DÉJÀ déposée, pour installer un état de départ.
 *
 * ⚠️ Passe hors RLS depuis 0009 : l'insertion directe dans `documents` a été
 * FERMÉE à `authenticated` (la policy `documents_insert` est retirée), parce
 * qu'elle permettait d'adopter n'importe quel objet orphelin du bucket et donc
 * de contourner la vérification de signature binaire. Une ligne ne naît plus
 * que de `confirm_document_upload`.
 *
 * Ce que ces tests-ci veulent n'est pas d'éprouver le dépôt — il l'est dans
 * `documents.test.ts` — mais de disposer d'un dossier déjà pourvu. On installe
 * donc l'état directement, comme le ferait une migration.
 */
async function attachDocument(
  client: PoolClient,
  occurrenceId: string,
  checklistItemId: string | null,
  kind: string,
  uploader: string,
): Promise<string> {
  const id = randomUUID();
  await client.query("reset role");
  await client.query(
    `insert into public.documents
       (id, occurrence_id, checklist_item_id, storage_path, original_filename,
        normalized_filename, mime_type, size_bytes, sha256, document_kind, uploaded_by)
     values ($1, $2, $3, $4, 'piece.pdf', $5, 'application/pdf', 1024, $6, $7, $8)`,
    [
      id,
      occurrenceId,
      checklistItemId,
      `fiscal/${id}.pdf`,
      `PIECE_${id.slice(0, 8)}_v1.pdf`,
      "a".repeat(64),
      kind,
      uploader,
    ],
  );
  await client.query("set local role authenticated");
  return id;
}

async function checklistOf(
  client: PoolClient,
  occurrenceId: string,
): Promise<{ id: string; label: string; is_mandatory: boolean }[]> {
  const { rows } = await client.query<{ id: string; label: string; is_mandatory: boolean }>(
    `select id, label, is_mandatory from public.occurrence_checklist_items
      where occurrence_id = $1 order by order_index`,
    [occurrenceId],
  );
  return rows;
}

/** Dépose toutes les pièces obligatoires du dossier, sous l'identité fournie. */
async function completeDossier(
  client: PoolClient,
  occurrenceId: string,
  uploader: string,
): Promise<void> {
  for (const item of (await checklistOf(client, occurrenceId)).filter((row) => row.is_mandatory)) {
    await attachDocument(client, occurrenceId, item.id, "JUSTIFICATIF", uploader);
  }
}

/**
 * Relit sans RLS, dans la MÊME transaction.
 *
 * ⚠️ `audit_log` n'est visible que de `audit.read`, et les lignes retirées sortent
 * du champ de leur politique de lecture. Les interroger sous l'identité de l'acteur
 * rendrait toujours zéro — et un test qui ne peut pas échouer ne prouve rien. Une
 * autre connexion ne conviendrait pas davantage : la transaction n'est pas validée.
 */
async function withoutRls<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  await client.query("reset role");
  try {
    return await run();
  } finally {
    await client.query("set local role authenticated");
  }
}

beforeAll(async () => {
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.query(SEED);
  await loadIds();
}, 60_000);

afterAll(async () => {
  await pool.query(CLEANUP);
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("complétude du dossier", () => {
  it("nomme précisément les pièces obligatoires absentes", async () => {
    const { rows } = await pool.query<{ missing: string[] }>(
      "select public.occurrence_missing_items($1) as missing",
      [MAIN("2026-01")],
    );

    // Les deux obligatoires manquent ; la facultative n'est pas réclamée.
    expect(rows[0]?.missing).toEqual(["Bordereau signé", "Annexe de calcul"]);
  });

  it("refuse la soumission à validation tant qu'une pièce obligatoire manque", async () => {
    await asUser(USER.agent, async (client) => {
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'PENDING_VALIDATION', $2) as result",
        [MAIN("2026-01"), 1],
      );

      expect(rows[0]?.result).toMatchObject({
        outcome: "INCOMPLETE",
        missing: ["Bordereau signé", "Annexe de calcul"],
      });

      // ⚠️ Aucun effet de bord : le refus doit être total, pas partiel.
      const after = await client.query<{ status: string; version: number }>(
        "select status, version from public.obligation_occurrences where id = $1",
        [MAIN("2026-01")],
      );
      expect(after.rows[0]).toEqual({ status: "IN_PROGRESS", version: 1 });
    });
  });

  it("accepte la soumission une fois les pièces obligatoires déposées", async () => {
    await asUser(USER.agent, async (client) => {
      await completeDossier(client, MAIN("2026-01"), USER.agent);

      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'PENDING_VALIDATION', $2) as result",
        [MAIN("2026-01"), 1],
      );

      expect(rows[0]?.result).toMatchObject({ outcome: "APPLIED", status: "PENDING_VALIDATION" });
    });
  });

  it("cocher une pièce à la main est SANS EFFET : seule la pièce déposée compte", async () => {
    await asUser(USER.agent, async (client) => {
      const [first] = await checklistOf(client, MAIN("2026-01"));
      expect(first).toBeDefined();

      await client.query(
        "update public.occurrence_checklist_items set is_checked = true where id = $1",
        [first?.id],
      );

      const { rows } = await client.query<{ is_checked: boolean }>(
        "select is_checked from public.occurrence_checklist_items where id = $1",
        [first?.id],
      );
      expect(rows[0]?.is_checked).toBe(false);

      // Et la garde de soumission n'est donc toujours pas franchie.
      const attempt = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'PENDING_VALIDATION', $2) as result",
        [MAIN("2026-01"), 1],
      );
      expect(attempt.rows[0]?.result).toMatchObject({ outcome: "INCOMPLETE" });
    });
  });

  it("le dépôt d'une pièce coche la ligne, son retrait la décoche", async () => {
    await asUser(USER.manager, async (client) => {
      const [target] = await checklistOf(client, MAIN("2026-01"));
      const documentId = await attachDocument(
        client,
        MAIN("2026-01"),
        target?.id ?? null,
        "JUSTIFICATIF",
        USER.manager,
      );

      const checked = await client.query<{ is_checked: boolean; checked_by: string | null }>(
        "select is_checked, checked_by from public.occurrence_checklist_items where id = $1",
        [target?.id],
      );
      expect(checked.rows[0]?.is_checked).toBe(true);
      expect(checked.rows[0]?.checked_by).toBe(USER.manager);

      const removed = await client.query<{ ok: boolean }>(
        "select public.soft_delete_document($1, 'pièce erronée') as ok",
        [documentId],
      );
      expect(removed.rows[0]?.ok).toBe(true);

      const cleared = await client.query<{ is_checked: boolean }>(
        "select is_checked from public.occurrence_checklist_items where id = $1",
        [target?.id],
      );
      expect(cleared.rows[0]?.is_checked).toBe(false);
    });
  });

  it("le retrait d'une pièce exige un motif", async () => {
    await asUser(USER.manager, async (client) => {
      const documentId = await attachDocument(
        client,
        MAIN("2026-01"),
        null,
        "ANNEXE",
        USER.manager,
      );

      await expect(
        client.query("select public.soft_delete_document($1, '  ')", [documentId]),
      ).rejects.toThrow(/au moins 10 caractères/);
    });
  });
});

describe("verrouillage optimiste", () => {
  it("rejette une écriture fondée sur une version périmée, sans rien écraser", async () => {
    await asUser(USER.agent, async (client) => {
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'TODO', $2) as result",
        [MAIN("2026-01"), 99],
      );

      expect(rows[0]?.result).toMatchObject({ outcome: "VERSION_CONFLICT", version: 1 });

      const after = await client.query<{ status: string }>(
        "select status from public.obligation_occurrences where id = $1",
        [MAIN("2026-01")],
      );
      expect(after.rows[0]?.status).toBe("IN_PROGRESS");
    });
  });

  it("la version rendue permet à l'appelant de rejouer immédiatement", async () => {
    await asUser(USER.agent, async (client) => {
      const conflict = await client.query<{ result: { version: number } }>(
        "select public.apply_occurrence_transition($1, 'TODO', 42) as result",
        [MAIN("2026-01")],
      );

      const applied = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'TODO', $2) as result",
        [MAIN("2026-01"), conflict.rows[0]?.result.version],
      );
      expect(applied.rows[0]?.result).toMatchObject({ outcome: "APPLIED", version: 2 });
    });
  });

  it("une seconde transition avec la version d'origine est refusée", async () => {
    await asUser(USER.agent, async (client) => {
      await client.query("select public.apply_occurrence_transition($1, 'TODO', 1)", [
        MAIN("2026-01"),
      ]);

      // Deux onglets ouverts sur le même dossier : le second a lu la version 1.
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'IN_PROGRESS', 1) as result",
        [MAIN("2026-01")],
      );
      expect(rows[0]?.result).toMatchObject({ outcome: "VERSION_CONFLICT", version: 2 });
    });
  });
});

describe("dépôt tardif", () => {
  it("réclame la preuve de dépôt avant tout le reste", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'SUBMITTED', $2, null, 'REF-1') as result",
        [MAIN("2026-02"), 1],
      );

      expect(rows[0]?.result).toMatchObject({ outcome: "PROOF_REQUIRED" });
    });
  });

  it("réclame le motif une fois la preuve et la référence fournies", async () => {
    await asUser(USER.manager, async (client) => {
      await attachDocument(client, MAIN("2026-02"), null, "PREUVE_DEPOT", USER.manager);

      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'SUBMITTED', $2, null, 'REF-1') as result",
        [MAIN("2026-02"), 1],
      );
      expect(rows[0]?.result).toMatchObject({
        outcome: "LATE_REASON_REQUIRED",
        dueDate: "2026-03-20",
      });
    });
  });

  it("enregistre catégorie ET texte libre du retard", async () => {
    await asUser(USER.manager, async (client) => {
      await attachDocument(client, MAIN("2026-02"), null, "PREUVE_DEPOT", USER.manager);

      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select public.apply_occurrence_transition(
                  $1, 'SUBMITTED', $2, null, 'REF-1', 'VALIDATOR_UNAVAILABLE',
                  'validateur en congé sur toute la période') as result`,
        [MAIN("2026-02"), 1],
      );
      expect(rows[0]?.result).toMatchObject({ outcome: "APPLIED" });

      const stored = await client.query<{
        late_reason_code: string;
        late_reason: string;
        reference_number: string;
      }>(
        `select late_reason_code, late_reason, reference_number
           from public.obligation_occurrences where id = $1`,
        [MAIN("2026-02")],
      );
      expect(stored.rows[0]).toEqual({
        late_reason_code: "VALIDATOR_UNAVAILABLE",
        late_reason: "validateur en congé sur toute la période",
        reference_number: "REF-1",
      });
    });
  });

  it("n'exige aucun motif quand le dépôt intervient dans les délais", async () => {
    await asUser(USER.manager, async (client) => {
      // 2026-04 est dû en 2099 et déjà complet : le dépôt ne peut pas être tardif.
      await attachDocument(client, MAIN("2026-04"), null, "PREUVE_DEPOT", USER.manager);
      await client.query("select public.apply_occurrence_transition($1, 'VALIDATED', 1)", [
        MAIN("2026-04"),
      ]);

      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'SUBMITTED', 2, null, 'REF-9') as result",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.result).toMatchObject({ outcome: "APPLIED" });

      const stored = await client.query<{ late_reason_code: string | null }>(
        "select late_reason_code from public.obligation_occurrences where id = $1",
        [MAIN("2026-04")],
      );
      expect(stored.rows[0]?.late_reason_code).toBeNull();
    });
  });

  it("refuse « autre » sans explication, jusque dans la contrainte de table", async () => {
    await expect(
      pool.query(
        `update public.obligation_occurrences
            set late_reason_code = 'OTHER', late_reason = null
          where id = $1`,
        [MAIN("2026-03")],
      ),
    ).rejects.toThrow(/late_reason_other/);
  });

  it("réclame une référence quand l'obligation exige une preuve", async () => {
    await asUser(USER.manager, async (client) => {
      await attachDocument(client, MAIN("2026-04"), null, "PREUVE_DEPOT", USER.manager);
      await client.query("select public.apply_occurrence_transition($1, 'VALIDATED', 1)", [
        MAIN("2026-04"),
      ]);

      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'SUBMITTED', 2) as result",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.result).toMatchObject({ outcome: "REFERENCE_REQUIRED" });
    });
  });
});

describe("permissions", () => {
  it("DIRECTION valide, alors qu'elle ne détient PAS occurrence.write", async () => {
    // ⚠️ Le cœur du dispositif SECURITY DEFINER. La politique UPDATE de
    // obligation_occurrences exige occurrence.write ; DIRECTION ne l'a pas, mais
    // détient occurrence.validate. Sans la fonction, le bouton serait sans effet.
    await asUser(USER.direction, async (client) => {
      const before = await client.query<{ ok: boolean }>(
        "select public.has_permission_in_domain('occurrence.write', (select domain_id from public.obligation_types where code = $1)) as ok",
        [`${PREFIX}MAIN`],
      );
      expect(before.rows[0]?.ok, "DIRECTION ne doit PAS détenir occurrence.write").toBe(false);

      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'VALIDATED', 1) as result",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.result).toMatchObject({ outcome: "APPLIED", status: "VALIDATED" });
    });
  });

  it("refuse la validation à qui ne détient pas occurrence.validate", async () => {
    /*
     * ⚠️ CONTRAT MODIFIÉ EN 0010. Le refus n'est plus une EXCEPTION mais une
     * ISSUE : `apply_occurrence_transition` consulte `evaluate_transition`, qui
     * rend un verdict. C'est ce que veut la machine à états — un refus est un
     * fait métier que l'interface doit pouvoir expliquer, pas un incident.
     *
     * Le dernier rempart, lui, n'a pas changé : un UPDATE direct lève toujours,
     * et c'est éprouvé dans `tests/integration/workflow.test.ts`.
     */
    await asUser(USER.agent, async (client) => {
      const { rows } = await client.query<{ result: { outcome: string; permission: string } }>(
        "select public.apply_occurrence_transition($1, 'VALIDATED', 1) as result",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.result.outcome).toBe("FORBIDDEN");
      expect(rows[0]?.result.permission).toBe("occurrence.validate");
    });
  });

  it("can_validate_occurrence rend false sans lever, même dans sa branche de repli", async () => {
    // ⚠️ RÉGRESSION. add_business_days() — appelée par cette branche — levait
    // « column reference "value" is ambiguous » : la fonction censée rendre false
    // faisait échouer le chargement de toute fiche en attente de validation.
    await asUser(USER.agent, async (client) => {
      const { rows } = await client.query<{ can: boolean }>(
        "select public.can_validate_occurrence($1) as can",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.can).toBe(false);
    });
  });

  it("add_business_days rend une date, week-end algérien déduit", async () => {
    // 2026-01-01 est un jeudi ; +1 jour ouvré tombe le dimanche 4, vendredi et
    // samedi étant chômés en Algérie.
    const { rows } = await pool.query<{ result: string }>(
      "select to_char(public.add_business_days(date '2026-01-01', 1), 'YYYY-MM-DD') as result",
    );
    expect(rows[0]?.result).toBe("2026-01-04");
  });

  it("refuse une transition absente de status_transition_rules", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ result: { outcome: string } }>(
        "select public.apply_occurrence_transition($1, 'ARCHIVED', 1) as result",
        [MAIN("2026-01")],
      );
      // Issue et non exception depuis 0010 — l'interdiction, elle, est intacte.
      expect(rows[0]?.result.outcome).toBe("INVALID_TRANSITION");
    });
  });

  it("un dossier d'un autre domaine est INTROUVABLE, pas « interdit »", async () => {
    await asUser(USER.rh, async (client) => {
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'IN_PROGRESS', 1) as result",
        [MAIN("2026-01")],
      );
      // Un « accès refusé » confirmerait l'existence du dossier : c'est exactement
      // ce que le cloisonnement interdit de révéler.
      expect(rows[0]?.result).toEqual({ outcome: "NOT_FOUND" });
    });
  });

  it("can_see_occurrence rend le MÊME verdict que la politique de lecture", async () => {
    for (const [name, userId] of Object.entries(USER)) {
      await asUser(userId, async (client) => {
        const viaPolicy = await client.query<{ visible: boolean }>(
          "select exists(select 1 from public.obligation_occurrences where id = $1) as visible",
          [MAIN("2026-01")],
        );
        const viaFunction = await client.query<{ visible: boolean }>(
          "select public.can_see_occurrence($1) as visible",
          [MAIN("2026-01")],
        );

        expect(
          { user: name, visible: viaFunction.rows[0]?.visible },
          "la copie du USING a divergé de la politique",
        ).toEqual({ user: name, visible: viaPolicy.rows[0]?.visible });
      });
    }
  });

  it("la séparation des tâches se lit avant d'afficher « Valider »", async () => {
    // agent est le préparateur (owner_id) ; manager est le validateur.
    await asUser(USER.agent, async (client) => {
      const { rows } = await client.query<{ blocked: boolean }>(
        "select public.self_validation_blocked_for($1) as blocked",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.blocked).toBe(true);
    });

    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ blocked: boolean }>(
        "select public.self_validation_blocked_for($1) as blocked",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.blocked).toBe(false);
    });
  });

  it("le préparateur qui tenterait quand même de valider est refusé", async () => {
    await asUser(USER.manager, async (client) => {
      await client.query("update public.obligation_occurrences set owner_id = $2 where id = $1", [
        MAIN("2026-04"),
        USER.manager,
      ]);

      const { rows } = await client.query<{ result: { outcome: string } }>(
        "select public.apply_occurrence_transition($1, 'VALIDATED', 2) as result",
        [MAIN("2026-04")],
      );
      expect(rows[0]?.result.outcome).toBe("SELF_VALIDATION_BLOCKED");
    });
  });
});

describe("déclaration rectificative", () => {
  it("crée une occurrence liée, suffixée -R1, avec sa liste de pièces", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "select public.create_occurrence_rectification($1, $2) as id",
        [MAIN("2026-03"), "erreur de base imposable sur la ligne 12"],
      );
      const rectificationId = rows[0]?.id;
      expect(rectificationId).toBeDefined();

      const created = await client.query<{
        period_key: string;
        status: string;
        rectification_index: number;
        rectifies_occurrence_id: string;
        legal_due_date: string;
      }>(
        `select period_key, status, rectification_index, rectifies_occurrence_id,
                to_char(legal_due_date, 'YYYY-MM-DD') as legal_due_date
           from public.obligation_occurrences where id = $1`,
        [rectificationId],
      );

      expect(created.rows[0]).toEqual({
        period_key: "2026-03-R1",
        status: "TODO",
        rectification_index: 1,
        rectifies_occurrence_id: MAIN("2026-03"),
        // Reprise de l'échéance d'origine : l'échéance légale d'une période est un
        // fait, pas un confort que l'on se choisit.
        legal_due_date: "2026-04-20",
      });

      const checklist = await checklistOf(client, rectificationId ?? "");
      expect(checklist.map((item) => item.label)).toEqual([
        "Bordereau signé",
        "Annexe de calcul",
        "Correspondance",
      ]);
    });
  });

  it("les deux occurrences se retrouvent l'une l'autre", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "select public.create_occurrence_rectification($1, $2) as id",
        [MAIN("2026-03"), "erreur de base imposable"],
      );

      const children = await client.query<{ id: string }>(
        "select id from public.obligation_occurrences where rectifies_occurrence_id = $1",
        [MAIN("2026-03")],
      );
      expect(children.rows.map((row) => row.id)).toEqual([rows[0]?.id]);
    });
  });

  it("porte son motif dès la ligne de création du journal d'état", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "select public.create_occurrence_rectification($1, $2) as id",
        [MAIN("2026-03"), "montant de TVA déductible corrigé"],
      );

      const journal = await client.query<{ reason: string; to_status: string }>(
        `select reason, to_status from public.occurrence_transitions
          where occurrence_id = $1 and reason is not null`,
        [rows[0]?.id],
      );
      expect(journal.rows[0]).toMatchObject({
        reason: "montant de TVA déductible corrigé",
        to_status: "TODO",
      });
    });
  });

  it("numérote la deuxième rectificative -R2, période de base comprise", async () => {
    await asUser(USER.manager, async (client) => {
      await client.query(
        "select public.create_occurrence_rectification($1, 'première correction')",
        [MAIN("2026-03")],
      );
      const second = await client.query<{ id: string }>(
        "select public.create_occurrence_rectification($1, 'seconde correction') as id",
        [MAIN("2026-03")],
      );

      const created = await client.query<{ period_key: string; rectification_index: number }>(
        "select period_key, rectification_index from public.obligation_occurrences where id = $1",
        [second.rows[0]?.id],
      );
      expect(created.rows[0]).toEqual({ period_key: "2026-03-R2", rectification_index: 2 });
    });
  });

  it("refuse une rectificative depuis un dossier non déposé", async () => {
    await asUser(USER.manager, async (client) => {
      await expect(
        client.query("select public.create_occurrence_rectification($1, 'motif suffisant')", [
          MAIN("2026-01"),
        ]),
      ).rejects.toThrow(/déposé ou archivé/);
    });
  });

  it("refuse une rectificative sans motif", async () => {
    await asUser(USER.manager, async (client) => {
      await expect(
        client.query("select public.create_occurrence_rectification($1, '   ')", [MAIN("2026-03")]),
      ).rejects.toThrow(/Motif obligatoire/);
    });
  });

  it("refuse une rectificative à qui ne détient pas occurrence.write", async () => {
    await asUser(USER.direction, async (client) => {
      await expect(
        client.query("select public.create_occurrence_rectification($1, 'motif suffisant')", [
          MAIN("2026-03"),
        ]),
      ).rejects.toThrow(/occurrence\.write/);
    });
  });
});

describe("dépendance entre obligations", () => {
  it("rapporte l'état de l'obligation dont celle-ci dépend", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{
        obligation_code: string;
        status: string;
        period_key: string;
      }>("select * from public.occurrence_dependency_state($1)", [MAIN("2026-03")]);

      expect(rows[0]).toMatchObject({
        obligation_code: `${PREFIX}DEP`,
        period_key: "2026",
        status: "IN_PROGRESS",
      });
    });
  });

  it("ne bloque AUCUNE transition — l'information n'est pas une barrière", async () => {
    await asUser(USER.agent, async (client) => {
      await completeDossier(client, MAIN("2026-01"), USER.agent);

      // La dépendance est IN_PROGRESS, donc non clôturée. La transition passe.
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        "select public.apply_occurrence_transition($1, 'PENDING_VALIDATION', 1) as result",
        [MAIN("2026-01")],
      );
      expect(rows[0]?.result).toMatchObject({ outcome: "APPLIED" });
    });
  });

  it("ne rend rien pour une obligation sans dépendance", async () => {
    const { rows } = await pool.query("select * from public.occurrence_dependency_state($1)", [
      occurrenceIds[`${PREFIX}SOCIAL:2026-01`],
    ]);
    expect(rows).toEqual([]);
  });
});

describe("traçabilité", () => {
  it("un commentaire produit une entrée d'audit", async () => {
    await asUser(USER.agent, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into public.occurrence_comments (occurrence_id, author_id, body, mentioned_user_ids)
         values ($1, $2, 'point de blocage sur la ligne 12', array[$3]::uuid[])
         returning id`,
        [MAIN("2026-01"), USER.agent, USER.manager],
      );

      const rows = await withoutRls(client, async () => {
        const result = await client.query<{ count: string }>(
          `select count(*) as count from public.audit_log
            where entity_table = 'occurrence_comments' and entity_id_ref = $1
              and action = 'INSERT'`,
          [inserted.rows[0]?.id],
        );
        return result.rows;
      });
      expect(Number(rows[0]?.count)).toBe(1);
    });
  });

  it("cocher une pièce laisse une trace d'audit", async () => {
    await asUser(USER.agent, async (client) => {
      const [target] = await checklistOf(client, MAIN("2026-01"));
      await attachDocument(client, MAIN("2026-01"), target?.id ?? null, "JUSTIFICATIF", USER.agent);

      const rows = await withoutRls(client, async () => {
        const result = await client.query<{ changed: string[] }>(
          `select changed_fields as changed from public.audit_log
            where entity_table = 'occurrence_checklist_items' and entity_id_ref = $1
            order by occurred_at desc limit 1`,
          [target?.id],
        );
        return result.rows;
      });
      expect(rows[0]?.changed).toContain("is_checked");
    });
  });

  it("la suppression d'un commentaire conserve la ligne et sa trace", async () => {
    await asUser(USER.agent, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into public.occurrence_comments (occurrence_id, author_id, body)
         values ($1, $2, 'à supprimer') returning id`,
        [MAIN("2026-01"), USER.agent],
      );
      const commentId = inserted.rows[0]?.id;

      const removed = await client.query<{ ok: boolean }>(
        "select public.soft_delete_comment($1) as ok",
        [commentId],
      );
      expect(removed.rows[0]?.ok).toBe(true);

      // Invisible en lecture applicative…
      const visible = await client.query("select 1 from public.occurrence_comments where id = $1", [
        commentId,
      ]);
      expect(visible.rowCount).toBe(0);

      // …mais la ligne existe, et l'audit porte son texte d'avant retrait.
      await withoutRls(client, async () => {
        const stored = await client.query<{ body: string; deleted: boolean }>(
          `select body, deleted_at is not null as deleted
             from public.occurrence_comments where id = $1`,
          [commentId],
        );
        expect(stored.rows[0]).toEqual({ body: "à supprimer", deleted: true });

        const audited = await client.query<{ before_body: string }>(
          `select before ->> 'body' as before_body from public.audit_log
            where entity_table = 'occurrence_comments' and entity_id_ref = $1
              and action = 'UPDATE'`,
          [commentId],
        );
        expect(audited.rows[0]?.before_body).toBe("à supprimer");
      });
    });
  });

  it("seul l'auteur retire son commentaire", async () => {
    await asUser(USER.agent, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into public.occurrence_comments (occurrence_id, author_id, body)
         values ($1, $2, 'commentaire de l''agent') returning id`,
        [MAIN("2026-01"), USER.agent],
      );
      const commentId = inserted.rows[0]?.id;

      // La transaction est celle de l'agent : on bascule l'identité de session.
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USER.manager, role: "authenticated" }),
      ]);

      await expect(
        client.query("select public.soft_delete_comment($1)", [commentId]),
      ).rejects.toThrow(/Seul l'auteur/);
    });
  });

  it("une transition journalise l'acteur ET son motif", async () => {
    await asUser(USER.manager, async (client) => {
      // ⚠️ status_transition_rules n'ouvre NOT_APPLICABLE que depuis TODO : le
      // dossier repasse donc à faire avant d'être déclaré sans objet. La table
      // décide, l'application suit — c'est tout l'intérêt d'un cycle en données.
      await client.query("select public.apply_occurrence_transition($1, 'TODO', 1)", [
        MAIN("2026-01"),
      ]);
      await client.query("select public.apply_occurrence_transition($1, 'NOT_APPLICABLE', 2, $2)", [
        MAIN("2026-01"),
        "établissement fermé sur la période",
      ]);

      const { rows } = await client.query<{
        from_status: string;
        to_status: string;
        actor_id: string;
        reason: string;
      }>(
        `select from_status, to_status, actor_id, reason
           from public.occurrence_transitions
          where occurrence_id = $1 and to_status = 'NOT_APPLICABLE'`,
        [MAIN("2026-01")],
      );

      expect(rows[0]).toMatchObject({
        from_status: "TODO",
        to_status: "NOT_APPLICABLE",
        actor_id: USER.manager,
        reason: "établissement fermé sur la période",
      });
    });
  });
});

describe("chargement de la fiche", () => {
  it("l'agrégat complet répond sous 300 ms", async () => {
    await asUser(USER.manager, async (client) => {
      for (const item of await checklistOf(client, MAIN("2026-03"))) {
        await attachDocument(client, MAIN("2026-03"), item.id, "JUSTIFICATIF", USER.manager);
      }
      for (let index = 0; index < 20; index += 1) {
        await client.query(
          `insert into public.occurrence_comments (occurrence_id, author_id, body)
           values ($1, $2, $3)`,
          [MAIN("2026-03"), USER.manager, `échange ${String(index)}`],
        );
      }

      const durations: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        const started = performance.now();
        await client.query(
          `select oc.id,
                  (select count(*) from public.occurrence_checklist_items ci
                    where ci.occurrence_id = oc.id) as items,
                  (select count(*) from public.documents d
                    where d.occurrence_id = oc.id and d.deleted_at is null) as docs,
                  (select count(*) from public.occurrence_comments c
                    where c.occurrence_id = oc.id and c.deleted_at is null) as comments,
                  (select count(*) from public.occurrence_transitions t
                    where t.occurrence_id = oc.id) as transitions,
                  public.occurrence_missing_items(oc.id) as missing
             from public.obligation_occurrences oc
            where oc.id = $1`,
          [MAIN("2026-03")],
        );
        durations.push(performance.now() - started);
      }

      expect(Math.max(...durations)).toBeLessThan(300);
    });
  });

  it("les périodes précédentes se trient par clé de période, décroissante", async () => {
    await asUser(USER.manager, async (client) => {
      const { rows } = await client.query<{ period_key: string }>(
        `select oc.period_key from public.obligation_occurrences oc
          join public.obligation_types ot on ot.id = oc.obligation_type_id
         where ot.code = $1 and oc.period_key < $2 and oc.deleted_at is null
         order by oc.period_key desc limit 12`,
        [`${PREFIX}MAIN`, "2026-02"],
      );

      expect(rows.map((row) => row.period_key)).toEqual(["2026-01", "2025-12", "2025-11"]);
    });
  });
});

describe("stockage des pièces", () => {
  it("la constante applicative désigne un bucket qui EXISTE, et privé", async () => {
    /*
     * ⚠️ RÉGRESSION. STORAGE_BUCKET_DOCUMENTS valait « documents » alors que le
     * bucket créé en 0003 s'appelle « compliance-documents » : aucun dépôt
     * n'aboutissait. L'écart a survécu à trois phases parce que rien n'écrivait
     * encore dans le stockage — un test de plus valait mieux qu'un commentaire.
     */
    const { STORAGE_BUCKET_DOCUMENTS } = await import("@/config/constants");

    const { rows } = await pool.query<{ id: string; public: boolean }>(
      "select id, public from storage.buckets where id = $1",
      [STORAGE_BUCKET_DOCUMENTS],
    );

    expect(rows[0], `bucket « ${STORAGE_BUCKET_DOCUMENTS} » introuvable`).toBeDefined();
    // Un bucket public rendrait toute URL signée décorative.
    expect(rows[0]?.public).toBe(false);
  });

  it("le bucket n'accepte ni UPDATE ni DELETE : un fichier déposé ne s'écrase pas", async () => {
    const { rows } = await pool.query<{ cmd: string }>(
      `select polcmd::text as cmd from pg_policy
        where polrelid = 'storage.objects'::regclass
          and polname like 'compliance_documents%'`,
    );

    // 'r' = SELECT, 'a' = INSERT. Ni 'w' (UPDATE) ni 'd' (DELETE).
    expect([...rows.map((row) => row.cmd)].sort()).toEqual(["a", "r"]);
  });
});
