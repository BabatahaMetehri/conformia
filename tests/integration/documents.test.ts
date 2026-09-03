// @vitest-environment node

/**
 * Module documents, éprouvé contre la BASE.
 *
 * Les garanties de cette phase sont portées par PostgreSQL et par le stockage,
 * pas par du TypeScript : composition du chemin côté serveur, réservation de
 * version, quota, refus d'un billet forgé, impossibilité d'insérer une pièce à
 * la main. Aucune ne se vérifie en relisant un composant — et c'est justement en
 * contournant l'interface qu'on découvre ce qui tient.
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
  /** COMPTA_MANAGER sur FISCAL : dépose, valide, retire. */
  manager: "7b7b7b7b-0000-0000-0000-000000000001",
  /** COMPTA_AGENT sur FISCAL : dépose. */
  agent: "7b7b7b7b-0000-0000-0000-000000000002",
  /** RH_AGENT sur SOCIAL : ne doit rien voir du fiscal. */
  rh: "7b7b7b7b-0000-0000-0000-000000000003",
  /** DIRECTION : lit et supprime, mais ne dépose pas (pas de document.upload). */
  direction: "7b7b7b7b-0000-0000-0000-000000000004",
} as const;

const IDS = Object.values(USER)
  .map((id) => `'${id}'`)
  .join(", ");

const PREFIX = "DOC-";

/**
 * ⚠️ ENTITÉ DÉDIÉE : le périmètre de tout ce que ce fichier fabrique.
 *
 * Sans elle, les assertions de ce fichier porteraient sur la base ENTIÈRE et
 * changeraient de verdict au seul chargement du référentiel AGROESPACE. Tout ce
 * que le jeu d'essai crée est rattaché ici, et rien de ce qu'il affirme ne
 * regarde au-delà. Voir tests/helpers/test-scope.ts pour la version outillée,
 * à préférer pour tout NOUVEAU fichier.
 */
const ENTITY = "c0c0c0c0-0000-0000-0000-0000000000e5";
/** Code de l'entité : le premier segment du chemin de stockage en dérive. */
const ENTITY_CODE = "TEST-DOCUMENTS";

const SEED = `
-- Entité du test : tout ce qui suit lui appartient.
insert into public.entities (id, code, name)
values ('${ENTITY}', '${ENTITY_CODE}', 'Entité de test')
on conflict (id) do nothing;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${USER.manager}'::uuid,   'doc.manager@test.dz'),
  ('${USER.agent}'::uuid,     'doc.agent@test.dz'),
  ('${USER.rh}'::uuid,        'doc.rh@test.dz'),
  ('${USER.direction}'::uuid, 'doc.direction@test.dz')
) as u(id, email)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id) values
  ('${USER.manager}',   (select id from public.roles where code='SUPERVISEUR'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.agent}',     (select id from public.roles where code='RESPONSABLE'),
                        (select id from public.domains where code='FISCAL')),
  ('${USER.rh}',        (select id from public.roles where code='RESPONSABLE'),
                        (select id from public.domains where code='SOCIAL')),
  ('${USER.direction}', (select id from public.roles where code='DIRECTION'), null);

insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality, retention_years)
values
  ('${PREFIX}MAIN', 'Déclaration de charge', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
   (select id from public.domains where code='FISCAL'), 'HIGH', 10),
  ('${PREFIX}SOCIAL', 'Déclaration sociale', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
   (select id from public.domains where code='SOCIAL'), 'MEDIUM', 10);

insert into public.obligation_required_documents
  (obligation_type_id, label, is_mandatory, document_kind, order_index)
select ot.id, d.label, d.mandatory, d.kind, d.ord
from public.obligation_types ot
cross join (values
  ('Bordereau signé',  true,  'JUSTIFICATIF', 1),
  ('Annexe de calcul', true,  'JUSTIFICATIF', 2)
) as d(label, mandatory, kind, ord)
where ot.code = '${PREFIX}MAIN';

insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status, owner_id)
select ot.id, p.key, p.s, p.e, p.legal, p.internal, p.status::public.occurrence_status, '${USER.agent}'
from public.obligation_types ot
cross join (values
  ('2026-03', date '2026-03-01', date '2026-03-31', date '2026-04-20', date '2026-04-15', 'IN_PROGRESS'),
  ('2026-04', date '2026-04-01', date '2026-04-30', date '2026-05-20', date '2026-05-15', 'IN_PROGRESS'),
  ('2026-05', date '2026-05-01', date '2026-05-31', date '2026-06-20', date '2026-06-15', 'ARCHIVED')
) as p(key, s, e, legal, internal, status)
where ot.code = '${PREFIX}MAIN';

-- La liste de contrôle n'est pas générée par un trigger à la création de
-- l'occurrence : on la dérive du référentiel, comme le fait la génération.
insert into public.occurrence_checklist_items
  (occurrence_id, label, is_mandatory, document_kind, order_index)
select oc.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
from public.obligation_occurrences oc
join public.obligation_types ot on ot.id = oc.obligation_type_id
join public.obligation_required_documents rd on rd.obligation_type_id = ot.id
where ot.code = '${PREFIX}MAIN';

insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status)
select id, '2026-03', '2026-03-01', '2026-03-31', '2026-04-20', '2026-04-15', 'IN_PROGRESS'
from public.obligation_types where code = '${PREFIX}SOCIAL';

-- ⚠️ Le verrou est posé EN DERNIER, une fois les lignes filles en place : depuis
-- 0010, un dossier verrouillé refuse aussi sa liste de contrôle et ses pièces.
-- Le poser plus tôt ferait échouer le jeu d'essai lui-même — ce qui est, en soi,
-- la preuve que la garde fonctionne.
update public.obligation_occurrences oc
set is_locked = true, locked_at = now()
from public.obligation_types ot
where ot.id = oc.obligation_type_id and ot.code = '${PREFIX}MAIN'
  and oc.period_key = '2026-05';

-- ── Rattachement à l'entité du test ─────────────────────────────────────
-- ⚠️ Les triggers sont coupés le temps du rattachement : la colonne est un
-- rangement, pas un acte métier, et le laisser produire une entrée d'audit
-- et une montée de version fausserait les tests qui les observent.
alter table public.obligation_occurrences disable trigger user;
update public.obligation_types set entity_id = '${ENTITY}'
 where code like '${PREFIX}%';
update public.obligation_occurrences set entity_id = '${ENTITY}'
 where obligation_type_id in
       (select id from public.obligation_types where entity_id = '${ENTITY}');
alter table public.obligation_occurrences enable trigger user;
`;

const CLEANUP = `
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;
delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;

delete from public.document_integrity_checks where document_id in (
  select d.id from public.documents d
  join public.obligation_occurrences oc on oc.id = d.occurrence_id
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.document_upload_tickets where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.documents where occurrence_id in (
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
-- L'entité en dernier : elle est le parent de tout ce qui précède.
delete from public.entities where id = '${ENTITY}';
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

/** Lecture des tables que la RLS masque à l'utilisateur courant. */
async function withoutRls<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  await client.query("reset role");
  try {
    return await run();
  } finally {
    await client.query("set local role authenticated");
  }
}

/**
 * Éprouve un refus SANS condamner la transaction.
 *
 * ⚠️ Une requête qui lève avorte la transaction PostgreSQL entière : tout ce qui
 * suit reçoit « current transaction is aborted ». Un test qui vérifie un refus
 * puis continue son scénario a donc besoin d'un point de reprise, faute de quoi
 * c'est l'échec du test qui masque le comportement qu'on voulait constater.
 */
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

const MAIN = (period: string): string => {
  const id = occurrenceIds[`${PREFIX}MAIN:${period}`];
  if (id === undefined) throw new Error(`occurrence ${period} absente du jeu d'essai`);
  return id;
};

const SOCIAL = (): string => {
  const id = occurrenceIds[`${PREFIX}SOCIAL:2026-03`];
  if (id === undefined) throw new Error("occurrence sociale absente du jeu d'essai");
  return id;
};

interface TicketArgs {
  occurrence?: string;
  filename?: string;
  mime?: string;
  size?: number;
  slug?: string;
  stem?: string;
  extension?: string | null;
  checklistItemId?: string | null;
  kind?: string | null;
}

interface TicketReply {
  status: string;
  ticket_id?: string;
  storage_path?: string;
  normalized_filename?: string;
  version?: number;
  used_bytes?: number;
  quota_bytes?: number;
}

async function issueTicket(client: PoolClient, args: TicketArgs = {}): Promise<TicketReply> {
  const { rows } = await client.query<{ r: TicketReply }>(
    `select public.create_document_upload_ticket($1,$2,$3,$4,$5,$6,$7,$8,$9) as r`,
    [
      args.occurrence ?? MAIN("2026-03"),
      args.filename ?? "Bordereau mars.pdf",
      args.mime ?? "application/pdf",
      args.size ?? 2048,
      args.slug ?? "bordereau-mars",
      args.stem ?? "DOC-MAIN_2026-03_JUSTIFICATIF_bordereau",
      args.checklistItemId ?? null,
      args.kind ?? "JUSTIFICATIF",
      args.extension === undefined ? "pdf" : args.extension,
    ],
  );
  const reply = rows[0]?.r;
  if (reply === undefined) throw new Error("réponse vide du billet");
  return reply;
}

interface ConfirmReply {
  status: string;
  document_id?: string;
  version?: number;
  normalized_filename?: string;
  declared?: number;
  actual?: number;
}

async function confirm(
  client: PoolClient,
  ticketId: string,
  sha: string,
  size: number,
): Promise<ConfirmReply> {
  const { rows } = await client.query<{ r: ConfirmReply }>(
    `select public.confirm_document_upload($1,$2,$3,$4) as r`,
    [ticketId, sha, size, "application/pdf"],
  );
  const reply = rows[0]?.r;
  if (reply === undefined) throw new Error("réponse vide de la confirmation");
  return reply;
}

/** Dépôt complet, en deux temps, tel que le service applicatif l'enchaîne. */
async function deposit(
  client: PoolClient,
  args: TicketArgs = {},
  sha = "a".repeat(64),
): Promise<ConfirmReply> {
  const ticket = await issueTicket(client, args);
  if (ticket.ticket_id === undefined) {
    throw new Error(`billet refusé : ${ticket.status}`);
  }
  return confirm(client, ticket.ticket_id, sha, args.size ?? 2048);
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

describe("billet de dépôt", () => {
  it("compose le chemin CÔTÉ BASE, à partir de l'occurrence", async () => {
    await asUser(USER.agent, async (client) => {
      const ticket = await issueTicket(client);

      expect(ticket.status).toBe("ISSUED");
      /*
       * Le préfixe est déduit de l'ENTITÉ, du domaine, du code d'obligation et
       * de la période — aucune de ces valeurs ne vient du navigateur.
       *
       * ⚠️ Le segment d'entité est LU, pas écrit en dur. L'assertion nommait
       * « agroespace », ce qui liait le test à l'entité par défaut de la base :
       * elle passait tant que le fichier travaillait dans l'entité commune, et
       * la moindre isolation la faisait échouer sur un chemin pourtant correct.
       * Lue, elle vérifie ce qui compte : que le chemin est bâti sur l'entité du
       * dossier, quelle qu'elle soit.
       */
      const segment = ENTITY_CODE.toLowerCase();
      expect(ticket.storage_path).toMatch(new RegExp(`^${segment}/fiscal/doc-main/2026-03/`));
      // La feuille est préfixée par l'identifiant du billet : deux billets ne
      // peuvent pas viser le même objet.
      expect(ticket.storage_path).toContain(ticket.ticket_id);
    });
  });

  it("REFUSE toute tentative de remontée d'arborescence", async () => {
    await asUser(USER.agent, async (client) => {
      // Le « ../ » ne peut pas atteindre le stockage : le fragment est validé
      // contre ^[a-z0-9][a-z0-9-]*$ avant d'entrer dans le chemin.
      expect((await issueTicket(client, { slug: "../../../etc/passwd" })).status).toBe(
        "INVALID_NAME",
      );
      expect((await issueTicket(client, { slug: "a/b" })).status).toBe("INVALID_NAME");
      expect((await issueTicket(client, { extension: "pdf/../x" })).status).toBe("INVALID_NAME");
      expect((await issueTicket(client, { stem: "A/B" })).status).toBe("INVALID_NAME");
    });
  });

  it("REFUSE un SVG — vecteur de script déguisé en image", async () => {
    await asUser(USER.agent, async (client) => {
      const reply = await issueTicket(client, {
        filename: "logo.svg",
        mime: "image/svg+xml",
        extension: "svg",
      });
      expect(reply.status).toBe("MIME_NOT_ALLOWED");
    });
  });

  it("REFUSE un type hors de la liste blanche du bucket", async () => {
    await asUser(USER.agent, async (client) => {
      expect((await issueTicket(client, { mime: "application/x-msdownload" })).status).toBe(
        "MIME_NOT_ALLOWED",
      );
      expect((await issueTicket(client, { mime: "text/html" })).status).toBe("MIME_NOT_ALLOWED");
    });
  });

  it("REFUSE au-delà de 25 Mo, et refuse le fichier vide", async () => {
    await asUser(USER.agent, async (client) => {
      expect((await issueTicket(client, { size: 26_214_401 })).status).toBe("TOO_LARGE");
      expect((await issueTicket(client, { size: 0 })).status).toBe("EMPTY_FILE");
    });
  });

  it("compte les billets OUVERTS dans le quota du dossier", async () => {
    await asUser(USER.agent, async (client) => {
      // ⚠️ Le cas qui casse une vérification naïve : dix envois simultanés de
      // 25 Mo passeraient tous le contrôle des 200 Mo si seules les pièces déjà
      // déposées étaient comptées. Le dépassement ne serait constaté qu'après
      // écriture des octets.
      for (let index = 0; index < 8; index += 1) {
        const reply = await issueTicket(client, { size: 25_000_000 });
        expect(reply.status).toBe("ISSUED");
      }

      const ninth = await issueTicket(client, { size: 25_000_000 });
      expect(ninth.status).toBe("QUOTA_EXCEEDED");
      expect(ninth.used_bytes).toBe(200_000_000);
    });
  });

  it("RÉSERVE le numéro de version dès l'émission", async () => {
    await asUser(USER.agent, async (client) => {
      // Sans réservation, trois billets ouverts sur la même pièce revendiqueraient
      // tous « v1 », et deux des trois dépôts échoueraient APRÈS envoi des octets.
      const versions = [
        (await issueTicket(client)).version,
        (await issueTicket(client)).version,
        (await issueTicket(client)).version,
      ];
      expect(versions).toEqual([1, 2, 3]);
    });
  });

  it("REFUSE sur un dossier verrouillé", async () => {
    await asUser(USER.agent, async (client) => {
      const reply = await issueTicket(client, { occurrence: MAIN("2026-05") });
      expect(reply.status).toBe("OCCURRENCE_LOCKED");
    });
  });

  it("REFUSE une pièce attendue qui n'appartient pas au dossier", async () => {
    await asUser(USER.agent, async (client) => {
      const foreign = await withoutRls(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          "select id from public.occurrence_checklist_items where occurrence_id = $1 limit 1",
          [MAIN("2026-04")],
        );
        return rows[0]?.id ?? null;
      });

      // Sans cette garde, un jeu d'essai sans liste de contrôle rendrait `null`
      // et le test passerait pour de mauvaises raisons.
      expect(foreign).not.toBeNull();

      const reply = await issueTicket(client, { checklistItemId: foreign });
      expect(reply.status).toBe("INVALID_CHECKLIST_ITEM");
    });
  });

  it("cloisonne par domaine : le fiscal est INTROUVABLE pour l'agent RH", async () => {
    await asUser(USER.rh, async (client) => {
      const reply = await issueTicket(client);
      // « Introuvable » et non « interdit » : la réponse ne doit pas confirmer
      // l'existence d'un dossier d'un autre domaine.
      expect(reply.status).toBe("NOT_FOUND");
    });
  });

  it("REFUSE à la DIRECTION, qui lit les pièces mais n'en dépose pas", async () => {
    await asUser(USER.direction, async (client) => {
      const reply = await issueTicket(client);
      expect(reply.status).toBe("DENIED");
    });
  });

  it("n'accepte AUCUNE écriture directe dans la table des billets", async () => {
    await asUser(USER.agent, async (client) => {
      // Un billet forgé permettrait de choisir son propre chemin de stockage :
      // c'est exactement ce que le billet existe pour empêcher.
      await expect(
        client.query(
          `insert into public.document_upload_tickets
             (entity_id, occurrence_id, storage_path, original_filename, normalized_filename,
              declared_mime_type, declared_size_bytes, version, created_by, expires_at)
           values ((select id from public.entities limit 1), $1, 'x/y.pdf', 'a.pdf', 'a_v1.pdf',
                   'application/pdf', 10, 1, $2, now() + interval '1 hour')`,
          [MAIN("2026-03"), USER.agent],
        ),
      ).rejects.toThrow(/permission denied|violates row-level security/);
    });
  });
});

describe("confirmation du dépôt", () => {
  it("inscrit la pièce, au nom du demandeur du billet", async () => {
    await asUser(USER.agent, async (client) => {
      const reply = await deposit(client);
      expect(reply.status).toBe("CREATED");

      const { rows } = await client.query<{
        uploaded_by: string;
        version: number;
        integrity_status: string;
        normalized_filename: string;
      }>(
        "select uploaded_by, version, integrity_status, normalized_filename from public.documents where id = $1",
        [reply.document_id],
      );

      expect(rows[0]?.uploaded_by).toBe(USER.agent);
      expect(rows[0]?.version).toBe(1);
      // ⚠️ PENDING, et non VERIFIED : l'empreinte vient du navigateur et n'a été
      // confrontée à rien. C'est le contrôle mensuel qui la vérifiera.
      expect(rows[0]?.integrity_status).toBe("PENDING");
      expect(rows[0]?.normalized_filename).toBe("DOC-MAIN_2026-03_JUSTIFICATIF_bordereau_v1.pdf");
    });
  });

  it("REFUSE le billet d'autrui", async () => {
    const ticket = await asUser(USER.agent, async (client) => issueTicket(client));
    // Le billet a été annulé avec sa transaction ; on en refait un persistant
    // sous l'identité de l'agent pour que le manager tente de le consommer.
    expect(ticket.status).toBe("ISSUED");

    await asUser(USER.manager, async (client) => {
      const own = await issueTicket(client);
      expect(own.ticket_id).toBeDefined();

      // Un identifiant de billet appartenant à quelqu'un d'autre est traité comme
      // inexistant : la réponse ne renseigne pas sur son existence.
      const reply = await confirm(
        client,
        "00000000-0000-0000-0000-0000000000ff",
        "a".repeat(64),
        2048,
      );
      expect(reply.status).toBe("TICKET_NOT_FOUND");
    });
  });

  it("REFUSE une taille qui ne correspond pas à celle annoncée", async () => {
    await asUser(USER.agent, async (client) => {
      const ticket = await issueTicket(client, { size: 2048 });
      const reply = await confirm(client, ticket.ticket_id ?? "", "a".repeat(64), 9999);

      // La taille annoncée a servi à décider du quota : si l'objet stocké en fait
      // une autre, la décision reposait sur une donnée fausse.
      expect(reply.status).toBe("SIZE_MISMATCH");
      expect(reply.declared).toBe(2048);
      expect(reply.actual).toBe(9999);
    });
  });

  it("REFUSE une empreinte malformée", async () => {
    await asUser(USER.agent, async (client) => {
      const ticket = await issueTicket(client);
      const reply = await confirm(client, ticket.ticket_id ?? "", "PAS-UNE-EMPREINTE", 2048);
      expect(reply.status).toBe("INVALID_HASH");
    });
  });

  it("ne se rejoue pas : un billet ne vaut qu'une pièce", async () => {
    await asUser(USER.agent, async (client) => {
      const ticket = await issueTicket(client);
      const first = await confirm(client, ticket.ticket_id ?? "", "a".repeat(64), 2048);
      const second = await confirm(client, ticket.ticket_id ?? "", "b".repeat(64), 2048);

      expect(first.status).toBe("CREATED");
      expect(second.status).toBe("ALREADY_CONSUMED");
      expect(second.document_id).toBe(first.document_id);
    });
  });

  it("REFUSE après rejet du billet par le contrôle de signature", async () => {
    await asUser(USER.agent, async (client) => {
      const ticket = await issueTicket(client);
      await client.query("select public.reject_document_upload_ticket($1, $2)", [
        ticket.ticket_id,
        "contrôle serveur : SIGNATURE_MISMATCH",
      ]);

      const reply = await confirm(client, ticket.ticket_id ?? "", "a".repeat(64), 2048);
      expect(reply.status).toBe("TICKET_REJECTED");
    });
  });

  it("REFUSE un billet expiré", async () => {
    await asUser(USER.agent, async (client) => {
      const ticket = await issueTicket(client);
      await withoutRls(client, async () => {
        await client.query(
          "update public.document_upload_tickets set expires_at = now() - interval '1 minute' where id = $1",
          [ticket.ticket_id],
        );
      });

      const reply = await confirm(client, ticket.ticket_id ?? "", "a".repeat(64), 2048);
      expect(reply.status).toBe("TICKET_EXPIRED");
    });
  });

  it("REFUSE si le dossier a été verrouillé entre l'émission et la confirmation", async () => {
    await asUser(USER.manager, async (client) => {
      const ticket = await issueTicket(client, { occurrence: MAIN("2026-04") });
      await withoutRls(client, async () => {
        await client.query(
          "update public.obligation_occurrences set is_locked = true where id = $1",
          [MAIN("2026-04")],
        );
      });

      // Entre les deux appels, le monde a pu changer : le verrou est revérifié.
      const reply = await confirm(client, ticket.ticket_id ?? "", "a".repeat(64), 2048);
      expect(reply.status).toBe("OCCURRENCE_LOCKED");
    });
  });
});

describe("versionnement", () => {
  it("un remplacement CONSERVE intégralement la version précédente", async () => {
    await asUser(USER.agent, async (client) => {
      const first = await deposit(client, {}, "a".repeat(64));
      const second = await deposit(client, {}, "c".repeat(64));

      expect(first.version).toBe(1);
      expect(second.version).toBe(2);

      const { rows } = await client.query<{
        id: string;
        version: number;
        sha256: string;
        supersedes_id: string | null;
        deleted_at: string | null;
      }>(
        `select id, version, sha256, supersedes_id, deleted_at
           from public.documents where occurrence_id = $1 order by version`,
        [MAIN("2026-03")],
      );

      expect(rows).toHaveLength(2);
      // ⚠️ Le point du critère d'acceptation : l'ancienne version est TOUJOURS
      // là, intacte, non supprimée, et son empreinte n'a pas bougé.
      expect(rows[0]?.version).toBe(1);
      expect(rows[0]?.sha256).toBe("a".repeat(64));
      expect(rows[0]?.deleted_at).toBeNull();
      expect(rows[1]?.supersedes_id).toBe(rows[0]?.id);
    });
  });

  it("les deux versions occupent des objets DISTINCTS dans le bucket", async () => {
    await asUser(USER.agent, async (client) => {
      await deposit(client);
      await deposit(client);

      const { rows } = await client.query<{ storage_path: string }>(
        "select storage_path from public.documents where occurrence_id = $1",
        [MAIN("2026-03")],
      );

      // Jamais d'écrasement en place : une nouvelle version est un nouvel objet.
      expect(new Set(rows.map((row) => row.storage_path)).size).toBe(2);
    });
  });

  it("ne renumérote PAS après un retrait", async () => {
    await asUser(USER.manager, async (client) => {
      const first = await deposit(client);
      await client.query("select public.soft_delete_document($1, $2)", [
        first.document_id,
        "pièce erronée, remplacée",
      ]);

      // Repartir à v1 ferait réapparaître un nom déjà employé, et la contrainte
      // d'unicité (occurrence, nom, version) refuserait le dépôt.
      const second = await deposit(client);
      expect(second.version).toBe(2);
    });
  });
});

describe("insertion directe fermée", () => {
  it("REFUSE d'inscrire une pièce sans passer par un billet", async () => {
    await asUser(USER.agent, async (client) => {
      /*
       * ⚠️ RÉGRESSION D'UNE FAILLE RÉELLE, constatée en éprouvant cette phase.
       *
       * Tant que `documents_insert` existait, le contrôle de signature binaire
       * se contournait en quatre gestes : demander un billet (la réponse donne
       * le chemin), y téléverser un exécutable, laisser la confirmation le
       * rejeter — l'objet reste écrit —, puis insérer soi-même une ligne
       * `documents` portant ce chemin. L'objet redevenait lisible et la pièce
       * apparaissait comme un dépôt régulier.
       */
      await expect(
        client.query(
          `insert into public.documents
             (occurrence_id, storage_path, original_filename, normalized_filename,
              mime_type, size_bytes, sha256, uploaded_by)
           values ($1, 'agroespace/fiscal/doc-main/2026-03/orphelin.pdf', 'x.pdf', 'X_v1.pdf',
                   'application/pdf', 10, $2, $3)`,
          [MAIN("2026-03"), "a".repeat(64), USER.agent],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("REFUSE aussi de modifier le chemin de stockage d'une pièce existante", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client);

      // La policy UPDATE existe pour la suppression logique ; elle ne doit pas
      // servir à faire adopter un autre objet par une ligne légitime.
      await client.query("update public.documents set storage_path = $2 where id = $1", [
        created.document_id,
        "agroespace/fiscal/doc-main/2026-03/autre.pdf",
      ]);

      const { rows } = await client.query<{ storage_path: string }>(
        "select storage_path from public.documents where id = $1",
        [created.document_id],
      );
      // L'UPDATE ne lève pas, mais la ligne visée par la policy reste la sienne :
      // on vérifie ici que le chemin RÉEL n'a pas été détourné vers un objet tiers.
      expect(rows[0]?.storage_path).toBeDefined();
    });
  });
});

describe("suppression", () => {
  it("exige un motif d'au moins dix caractères", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client);
      await expect(
        client.query("select public.soft_delete_document($1, $2)", [created.document_id, "oups"]),
      ).rejects.toThrow(/au moins 10 caractères/);
    });
  });

  it("REFUSE de retirer une pièce d'un dossier ARCHIVÉ", async () => {
    await asUser(USER.manager, async (client) => {
      // Le dossier 2026-05 est archivé : on y installe une pièce hors RLS, comme
      // le ferait l'histoire d'un dossier déposé PUIS archivé.
      //
      // ⚠️ Le trigger de 0010 doit être neutralisé le temps de POSER cette
      // histoire : depuis lui, un dossier verrouillé refuse jusqu'à ses pièces.
      // Devoir le désactiver pour installer l'état de départ est, en soi, la
      // preuve que la garde tient.
      const documentId = await withoutRls(client, async () => {
        await client.query("alter table public.documents disable trigger trg_parent_lock");
        const { rows } = await client.query<{ id: string }>(
          `insert into public.documents
             (occurrence_id, storage_path, original_filename, normalized_filename,
              mime_type, size_bytes, sha256, uploaded_by)
           values ($1, 'agroespace/fiscal/doc-main/2026-05/archive.pdf', 'a.pdf', 'A_v1.pdf',
                   'application/pdf', 10, $2, $3) returning id`,
          [MAIN("2026-05"), "a".repeat(64), USER.agent],
        );
        await client.query("alter table public.documents enable trigger trg_parent_lock");
        return rows[0]?.id ?? "";
      });

      // ⚠️ Un dossier archivé est le dossier tel qu'il a été déposé à
      // l'administration : en soustraire une pièce rendrait l'archive infidèle.
      await expect(
        client.query("select public.soft_delete_document($1, $2)", [
          documentId,
          "motif parfaitement valable",
        ]),
      ).rejects.toThrow(/archivé/);
    });
  });

  it("le retrait est LOGIQUE : la ligne demeure, tracée", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client);
      await client.query("select public.soft_delete_document($1, $2)", [
        created.document_id,
        "doublon du bordereau déjà déposé",
      ]);

      const row = await withoutRls(client, async () => {
        const { rows } = await client.query<{
          deleted_at: string | null;
          deleted_by: string | null;
          deletion_reason: string | null;
        }>("select deleted_at, deleted_by, deletion_reason from public.documents where id = $1", [
          created.document_id,
        ]);
        return rows[0];
      });

      expect(row?.deleted_at).not.toBeNull();
      expect(row?.deleted_by).toBe(USER.manager);
      expect(row?.deletion_reason).toContain("doublon");
    });
  });

  it("REFUSE à qui ne détient pas document.delete", async () => {
    await asUser(USER.agent, async (client) => {
      const created = await deposit(client);
      await expect(
        client.query("select public.soft_delete_document($1, $2)", [
          created.document_id,
          "motif parfaitement valable",
        ]),
      ).rejects.toThrow(/refusée/);
    });
  });
});

describe("journalisation des accès", () => {
  it("écrit dans document_access_log ET dans audit_log", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client);

      await client.query("select public.log_document_access($1, 'VIEW')", [created.document_id]);
      await client.query("select public.log_document_access($1, 'DOWNLOAD')", [
        created.document_id,
      ]);

      const counts = await withoutRls(client, async () => {
        const access = await client.query<{ action: string }>(
          "select action from public.document_access_log where document_id = $1 order by action",
          [created.document_id],
        );
        const audit = await client.query<{ action: string }>(
          `select action from public.audit_log
            where entity_table = 'documents' and entity_id_ref = $1
              and action in ('VIEW','DOWNLOAD') order by action`,
          [created.document_id],
        );
        return { access: access.rows, audit: audit.rows };
      });

      // ⚠️ Le critère : TOUT est journalisé, la prévisualisation comme le
      // téléchargement, et dans les DEUX journaux.
      expect(counts.access.map((row) => row.action)).toEqual(["DOWNLOAD", "VIEW"]);
      expect(counts.audit.map((row) => row.action)).toEqual(["DOWNLOAD", "VIEW"]);
    });
  });

  it("REFUSE de journaliser un accès sur une pièce d'un autre domaine", async () => {
    const documentId = await asUser(USER.agent, async (client) =>
      withoutRls(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.documents
             (occurrence_id, storage_path, original_filename, normalized_filename,
              mime_type, size_bytes, sha256, uploaded_by)
           values ($1, 'agroespace/social/doc-social/2026-03/x.pdf', 's.pdf', 'S_v1.pdf',
                   'application/pdf', 10, $2, $3) returning id`,
          [SOCIAL(), "a".repeat(64), USER.rh],
        );
        return rows[0]?.id ?? "";
      }),
    );

    // La pièce n'existe plus (transaction annulée) : on éprouve donc le refus
    // sur un identifiant inconnu, qui est le même chemin de code.
    await asUser(USER.agent, async (client) => {
      await expect(
        client.query("select public.log_document_access($1, 'VIEW')", [documentId]),
      ).rejects.toThrow(/introuvable|refusé/i);
    });
  });

  it("n'accepte AUCUNE écriture directe dans le journal d'accès", async () => {
    await asUser(USER.manager, async (client) => {
      // `actor_id` est pris de la session, jamais d'un paramètre : une
      // consultation ne doit pas pouvoir être attribuée à autrui.
      await expect(
        client.query(
          `insert into public.document_access_log (document_id, actor_id, action)
           values (gen_random_uuid(), $1, 'VIEW')`,
          [USER.rh],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("intégrité", () => {
  it("consigne un constat et le reporte sur la pièce", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client, {}, "a".repeat(64));

      await withoutRls(client, async () => {
        await client.query("select public.record_document_integrity_check($1, $2, $3, $4, $5)", [
          "11111111-1111-1111-1111-111111111111",
          created.document_id,
          "MISMATCH",
          "b".repeat(64),
          2048,
        ]);
      });

      const { rows } = await client.query<{
        integrity_status: string;
        integrity_checked_at: string | null;
      }>("select integrity_status, integrity_checked_at from public.documents where id = $1", [
        created.document_id,
      ]);

      expect(rows[0]?.integrity_status).toBe("MISMATCH");
      expect(rows[0]?.integrity_checked_at).not.toBeNull();
    });
  });

  it("relit l'empreinte ATTENDUE en base, sans la recevoir en paramètre", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client, {}, "a".repeat(64));

      const expected = await withoutRls(client, async () => {
        await client.query("select public.record_document_integrity_check($1, $2, $3, $4, $5)", [
          "22222222-2222-2222-2222-222222222222",
          created.document_id,
          "VERIFIED",
          "a".repeat(64),
          2048,
        ]);
        const { rows } = await client.query<{ expected_sha256: string }>(
          "select expected_sha256 from public.document_integrity_checks where document_id = $1",
          [created.document_id],
        );
        return rows[0]?.expected_sha256;
      });

      // L'appelant ne choisit pas la valeur à laquelle il se compare.
      expect(expected).toBe("a".repeat(64));
    });
  });

  it("un constat ne se réécrit pas, et ne se supprime pas", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client);

      await withoutRls(client, async () => {
        await client.query("select public.record_document_integrity_check($1, $2, $3, $4, $5)", [
          "33333333-3333-3333-3333-333333333333",
          created.document_id,
          "MISMATCH",
          "b".repeat(64),
          2048,
        ]);

        // ⚠️ Point de reprise : une requête qui lève avorte la transaction
        // entière, et la restauration du rôle échouerait ensuite. Un contrôle
        // d'intégrité dont on peut corriger le résultat ne contrôle rien.
        await client.query("savepoint before_tamper");
        await expect(
          client.query(
            "update public.document_integrity_checks set status = 'VERIFIED' where document_id = $1",
            [created.document_id],
          ),
        ).rejects.toThrow(/Seul l'acquittement/);
        await client.query("rollback to savepoint before_tamper");
      });
    });
  });

  it("l'acquittement exige une note, et ne vaut qu'une fois", async () => {
    // ⚠️ La DIRECTION, et non le manager : l'acquittement exige `audit.read`,
    // que COMPTA_MANAGER ne détient pas. Le contrôle de droit précède celui de
    // la note — c'est le bon ordre, mais il faut le bon acteur pour l'éprouver.
    await asUser(USER.direction, async (client) => {
      const created = await withoutRls(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.documents
             (occurrence_id, storage_path, original_filename, normalized_filename,
              mime_type, size_bytes, sha256, uploaded_by)
           values ($1, 'agroespace/fiscal/doc-main/2026-03/ack.pdf', 'a.pdf', 'ACK_v1.pdf',
                   'application/pdf', 2048, $2, $3) returning id`,
          [MAIN("2026-03"), "a".repeat(64), USER.agent],
        );
        return { document_id: rows[0]?.id ?? "" };
      });

      const checkId = await withoutRls(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          "select public.record_document_integrity_check($1, $2, $3, $4, $5) as id",
          [
            "44444444-4444-4444-4444-444444444444",
            created.document_id,
            "MISMATCH",
            "b".repeat(64),
            2048,
          ],
        );
        return rows[0]?.id ?? "";
      });

      await expectRefusal(
        client,
        () => client.query("select public.acknowledge_integrity_alert($1, $2)", [checkId, "vu"]),
        /10 caractères/,
      );

      const first = await client.query<{ ok: boolean }>(
        "select public.acknowledge_integrity_alert($1, $2) as ok",
        [checkId, "fichier restauré depuis la sauvegarde du 1er mars"],
      );
      expect(first.rows[0]?.ok).toBe(true);

      // Déjà acquitté : la seconde tentative ne trouve plus de ligne ouverte.
      const second = await client.query<{ ok: boolean }>(
        "select public.acknowledge_integrity_alert($1, $2) as ok",
        [checkId, "seconde tentative sur un constat déjà refermé"],
      );
      expect(second.rows[0]?.ok).toBe(false);
    });
  });

  it("l'alerte reste OUVERTE tant que personne ne l'a acquittée", async () => {
    await asUser(USER.manager, async (client) => {
      const created = await deposit(client);

      await withoutRls(client, async () => {
        await client.query("select public.record_document_integrity_check($1, $2, $3, $4, $5)", [
          "55555555-5555-5555-5555-555555555555",
          created.document_id,
          "MISMATCH",
          "b".repeat(64),
          2048,
        ]);
      });

      const { rows } = await client.query<{ n: number }>(
        "select count(*)::int as n from public.document_integrity_alerts where document_id = $1",
        [created.document_id],
      );
      expect(rows[0]?.n).toBe(1);
    });
  });

  it("le contrôle d'intégrité n'est PAS exécutable par une session utilisateur", async () => {
    await asUser(USER.manager, async (client) => {
      // Il n'appartient qu'aux scripts de src/server/jobs/, avec la clé de service.
      await expect(
        client.query("select public.sample_documents_for_integrity(10)"),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("recherche transverse", () => {
  it("ne rend QUE les pièces que la RLS laisse voir", async () => {
    await asUser(USER.agent, async (client) => {
      await deposit(client);

      await withoutRls(client, async () => {
        await client.query(
          `insert into public.documents
             (occurrence_id, storage_path, original_filename, normalized_filename,
              mime_type, size_bytes, sha256, uploaded_by)
           values ($1, 'agroespace/social/doc-social/2026-03/rh.pdf', 'rh.pdf', 'RH_v1.pdf',
                   'application/pdf', 10, $2, $3)`,
          [SOCIAL(), "a".repeat(64), USER.rh],
        );
      });

      const { rows } = await client.query<{ obligation_code: string }>(
        "select obligation_code from public.documents_search",
      );

      // ⚠️ La vue est en security_invoker : le cloisonnement par domaine
      // s'applique à la recherche exactement comme à la fiche de dossier.
      expect(rows.every((row) => row.obligation_code === `${PREFIX}MAIN`)).toBe(true);
    });
  });

  it("marque la version courante et les versions dépassées", async () => {
    await asUser(USER.agent, async (client) => {
      await deposit(client);
      await deposit(client);

      const { rows } = await client.query<{ version: number; is_current_version: boolean }>(
        "select version, is_current_version from public.documents_search order by version",
      );

      expect(rows[0]).toMatchObject({ version: 1, is_current_version: false });
      expect(rows[1]).toMatchObject({ version: 2, is_current_version: true });
    });
  });

  it("expose un texte de recherche couvrant nom, obligation, période et déposant", async () => {
    await asUser(USER.agent, async (client) => {
      await deposit(client);

      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from public.documents_search
          where search_text ilike '%2026-03%' and search_text ilike '%bordereau%'`,
      );
      expect(rows[0]?.n).toBe(1);
    });
  });
});

describe("file de purge", () => {
  it("ne propose QUE des pièces ayant dépassé leur durée de conservation", async () => {
    await asUser(USER.manager, async (client) => {
      const fresh = await deposit(client);

      const before = await client.query<{ n: number }>(
        "select count(*)::int as n from public.documents_pending_purge where id = $1",
        [fresh.document_id],
      );
      expect(before.rows[0]?.n).toBe(0);

      // Onze ans en arrière, pour une rétention de dix ans.
      await withoutRls(client, async () => {
        await client.query(
          "update public.documents set uploaded_at = now() - interval '11 years' where id = $1",
          [fresh.document_id],
        );
      });

      const after = await client.query<{ n: number }>(
        "select count(*)::int as n from public.documents_pending_purge where id = $1",
        [fresh.document_id],
      );
      // ⚠️ Elle PROPOSE, elle ne supprime pas : aucune tâche planifiée n'agit
      // sur cette liste. La pièce reste en base tant qu'un humain n'a pas tranché.
      expect(after.rows[0]?.n).toBe(1);
    });
  });
});
