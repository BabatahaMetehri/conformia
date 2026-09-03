// @vitest-environment node

/**
 * Dépôt direct, éprouvé contre le VRAI stockage.
 *
 * Ce fichier existe parce que trois critères d'acceptation ne se vérifient
 * nulle part ailleurs :
 *
 *   • un exécutable renommé en .pdf est refusé PAR LA SIGNATURE — et le refus
 *     doit porter sur les octets RÉELLEMENT STOCKÉS, pas sur ce que le
 *     navigateur a bien voulu annoncer. Un contrôle côté client ne prouve rien :
 *     un client hostile ne l'exécute pas. On reproduit donc ici le chemin exact
 *     du serveur — billet, envoi direct, relecture d'en-tête — sans passer par
 *     l'interface, qui est précisément ce qu'un attaquant contourne ;
 *   • une URL signée devient inutilisable passé son délai ;
 *   • un objet déposé sans ligne `documents` reste ILLISIBLE.
 *
 * Prérequis : `supabase start`. Lancement : `npm run test:rls`.
 */

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HEADER_SNIFF_BYTES, inspectHeader } from "@/lib/files";

const CONNECTION_STRING =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const pool = new Pool({ connectionString: CONNECTION_STRING, max: 4 });

const AGENT = "7c7c7c7c-0000-0000-0000-000000000001";
const PREFIX = "STO-";
const BUCKET = "compliance-documents";

/** Un vrai en-tête PDF, et un vrai en-tête d'exécutable Windows. */
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n% test conformia\n");
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);

const SEED = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('${AGENT}'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'sto.agent@test.dz', 'x', now(), now(), now())
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, domain_id)
values ('${AGENT}', (select id from public.roles where code='RESPONSABLE'),
                    (select id from public.domains where code='FISCAL'));

insert into public.obligation_types
  (code, name, periodicity, due_rule, effective_from, domain_id, criticality)
values ('${PREFIX}MAIN', 'Dépôt direct', 'MONTHLY',
  '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2000-01-01',
  (select id from public.domains where code='FISCAL'), 'HIGH');

insert into public.obligation_occurrences
  (obligation_type_id, period_key, period_start, period_end,
   legal_due_date, internal_due_date, status)
select id, '2026-03', '2026-03-01', '2026-03-31', '2026-04-20', '2026-04-15', 'IN_PROGRESS'
from public.obligation_types where code = '${PREFIX}MAIN';
`;

const CLEANUP = `
alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;
delete from public.occurrence_transitions where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;
delete from public.document_upload_tickets where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.documents where occurrence_id in (
  select oc.id from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.code like '${PREFIX}%');
delete from public.obligation_occurrences where obligation_type_id in (
  select id from public.obligation_types where code like '${PREFIX}%');
delete from public.obligation_types where code like '${PREFIX}%';
delete from public.user_roles where user_id = '${AGENT}';
delete from public.profiles where id = '${AGENT}';
delete from auth.users where id = '${AGENT}';
`;

let occurrenceId = "";
/** Objets écrits pendant les tests : retirés à la fin, avec la clé de service. */
const writtenPaths: string[] = [];

async function asAgent<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: AGENT, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    return await run(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Autorisation d'écrire un objet, à un chemin, une seule fois. */
async function signUpload(path: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const payload = (await response.json()) as { url?: string };
  if (payload.url === undefined) throw new Error("URL d'envoi non délivrée");
  return `${SUPABASE_URL}/storage/v1${payload.url}`;
}

async function putObject(url: string, bytes: Uint8Array, contentType: string): Promise<number> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes as unknown as BodyInit,
  });
  return response.status;
}

async function signRead(path: string, expiresIn: number): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn }),
  });
  const payload = (await response.json()) as { signedURL?: string };
  if (payload.signedURL === undefined) throw new Error("URL de lecture non délivrée");
  return `${SUPABASE_URL}/storage/v1${payload.signedURL}`;
}

/** Relecture d'en-tête, exactement comme `fetchObjectHead` la fait en production. */
async function readHead(path: string): Promise<{ bytes: Uint8Array; totalSize: number }> {
  const url = await signRead(path, 60);
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${String(HEADER_SNIFF_BYTES - 1)}` },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const total = response.headers.get("content-range")?.split("/").at(-1);
  const parsed = total === undefined ? Number.NaN : Number.parseInt(total, 10);
  return { bytes, totalSize: Number.isInteger(parsed) ? parsed : bytes.length };
}

interface TicketReply {
  status: string;
  ticket_id?: string;
  storage_path?: string;
}

async function issueTicket(
  client: PoolClient,
  filename: string,
  size: number,
): Promise<TicketReply> {
  const { rows } = await client.query<{ r: TicketReply }>(
    `select public.create_document_upload_ticket($1,$2,$3,$4,$5,$6,$7,$8,$9) as r`,
    [
      occurrenceId,
      filename,
      "application/pdf",
      size,
      "piece-jointe",
      "STO-MAIN_2026-03_PIECE_piece",
      null,
      "JUSTIFICATIF",
      "pdf",
    ],
  );
  const reply = rows[0]?.r;
  if (reply === undefined) throw new Error("réponse vide du billet");
  return reply;
}

beforeAll(async () => {
  // ⚠️ Échec BRUYANT plutôt que scénarios sautés : une suite qui saute ses
  // tests de stockage affiche un vert qui ne prouve rien.
  if (SERVICE_KEY.length === 0) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY absent : ces scénarios s'adressent au vrai " +
        "stockage. Vérifier le chargement de .env.local par vitest.integration.mts.",
    );
  }

  await pool.query(CLEANUP).catch(() => undefined);
  await pool.query(SEED);

  const { rows } = await pool.query<{ id: string }>(
    `select oc.id from public.obligation_occurrences oc
       join public.obligation_types ot on ot.id = oc.obligation_type_id
      where ot.code = $1`,
    [`${PREFIX}MAIN`],
  );
  occurrenceId = rows[0]?.id ?? "";
}, 60_000);

afterAll(async () => {
  for (const path of writtenPaths) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => undefined);
  }
  await pool.query(CLEANUP).catch(() => undefined);
  await pool.end();
});

describe("vérification de signature sur les octets STOCKÉS", () => {
  it("REFUSE un exécutable renommé en .pdf, après qu'il a été téléversé", async () => {
    const path = await asAgent(async (client) => {
      const ticket = await issueTicket(client, "facture.pdf", EXE_BYTES.length);
      expect(ticket.status).toBe("ISSUED");
      // ⚠️ Le billet est validé hors transaction annulée : on retient son chemin,
      // qui est ce que le navigateur recevrait.
      return ticket.storage_path ?? "";
    });

    // Le client annonce « application/pdf » et envoie un exécutable Windows.
    // Tous les contrôles d'émission sont passés : le type annoncé est licite,
    // l'extension aussi, la taille aussi. Rien n'a encore regardé les octets.
    const uploadUrl = await signUpload(path);
    writtenPaths.push(path);
    expect(await putObject(uploadUrl, EXE_BYTES, "application/pdf")).toBe(200);

    const head = await readHead(path);
    const inspection = inspectHeader("facture.pdf", "application/pdf", head.bytes);

    // C'est ICI que le mensonge est constaté, sur ce qui est réellement stocké.
    expect(inspection.rejection).toBe("SIGNATURE_MISMATCH");
    expect(inspection.detectedMimeFamily).toBeNull();

    // Et rien ne subsiste en base : aucune pièce n'a été inscrite.
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.documents where storage_path = $1",
      [path],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("ACCEPTE un PDF authentique déposé de la même façon", async () => {
    const path = await asAgent(async (client) => {
      const ticket = await issueTicket(client, "bordereau.pdf", PDF_BYTES.length);
      return ticket.storage_path ?? "";
    });

    const uploadUrl = await signUpload(path);
    writtenPaths.push(path);
    expect(await putObject(uploadUrl, PDF_BYTES, "application/pdf")).toBe(200);

    const head = await readHead(path);
    const inspection = inspectHeader("bordereau.pdf", "application/pdf", head.bytes);

    expect(inspection.rejection).toBeNull();
    expect(inspection.detectedMimeFamily).toBe("pdf");
    // La taille réelle, relue depuis le stockage, sert à recouper celle annoncée.
    expect(head.totalSize).toBe(PDF_BYTES.length);
  });

  it("relit la taille RÉELLE, qui démasque une taille annoncée mensongère", async () => {
    const path = await asAgent(async (client) => {
      // Le client annonce dix octets et en envoie beaucoup plus.
      const ticket = await issueTicket(client, "gonfle.pdf", 10);
      return ticket.storage_path ?? "";
    });

    const uploadUrl = await signUpload(path);
    writtenPaths.push(path);
    await putObject(uploadUrl, PDF_BYTES, "application/pdf");

    const head = await readHead(path);
    // La taille annoncée avait servi à décider du quota : l'écart est un refus.
    expect(head.totalSize).not.toBe(10);
    expect(head.totalSize).toBe(PDF_BYTES.length);
  });
});

describe("URL signée", () => {
  it("devient INUTILISABLE passé son délai", async () => {
    const path = `${occurrenceId}/expiry-probe.pdf`;
    const uploadUrl = await signUpload(path);
    writtenPaths.push(path);
    await putObject(uploadUrl, PDF_BYTES, "application/pdf");

    const shortLived = await signRead(path, 1);

    // Utilisable immédiatement…
    expect((await fetch(shortLived)).status).toBe(200);

    // …et plus du tout deux secondes après. C'est ce qui fait qu'une URL copiée
    // dans un courriel ne donne pas un accès permanent à une déclaration fiscale.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await fetch(shortLived)).ok).toBe(false);
  }, 20_000);

  it("le réglage de durée vaut bien 300 secondes", async () => {
    const { rows } = await pool.query<{ value: number }>(
      "select (value)::int as value from public.app_settings where key = 'signed_url_ttl_seconds'",
    );
    expect(rows[0]?.value).toBe(300);
  });
});

describe("objet sans ligne documents", () => {
  it("reste ILLISIBLE : la politique de lecture exige une pièce qui le décrive", async () => {
    const path = await asAgent(async (client) => {
      const ticket = await issueTicket(client, "orphelin.pdf", PDF_BYTES.length);
      return ticket.storage_path ?? "";
    });

    const uploadUrl = await signUpload(path);
    writtenPaths.push(path);
    await putObject(uploadUrl, PDF_BYTES, "application/pdf");

    // ⚠️ C'est l'état intermédiaire de tout dépôt direct : les octets sont
    // écrits, la ligne n'existe pas encore. Il est SÛR — et c'est pour cela que
    // l'ordre est celui-là, et non l'inverse.
    const readable = await asAgent(async (client) => {
      const { rows } = await client.query<{ readable: boolean }>(
        "select exists(select 1 from public.documents d where d.storage_path = $1) as readable",
        [path],
      );
      return rows[0]?.readable ?? false;
    });

    expect(readable).toBe(false);
  });
});
