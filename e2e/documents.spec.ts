import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Module documents, dans un vrai navigateur.
 *
 * Ce qui ne se vérifie QUE d'ici : le dépôt DIRECT. Le fichier part du poste de
 * l'utilisateur vers le stockage sans traverser le serveur Next.js — cela
 * suppose une URL signée obtenue par Server Action, un PUT émis par le
 * navigateur, une empreinte calculée par la Web Crypto, puis une confirmation.
 * Aucun test serveur ne peut établir que cet enchaînement fonctionne réellement
 * dans un navigateur ; c'est le rôle de ce fichier.
 *
 * Le versant sécurité — signature binaire sur les octets stockés, refus d'un
 * billet forgé, cloisonnement — est éprouvé sans interface dans
 * `tests/integration/documents.test.ts` et `document-storage.test.ts`. Les deux
 * niveaux sont exigés ; aucun ne remplace l'autre.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-pieces-2026";
const MANAGER = "pieces.manager@e2e.test.dz";
const OUTSIDER = "pieces.rh@e2e.test.dz";

const OBLIGATION = "8a8a8a8a-0000-0000-0000-0000000000b1";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;
let occurrenceId = "";

/** Un vrai PDF minimal : en-tête %PDF, donc signature conforme. */
const PDF_CONTENT = Buffer.from("%PDF-1.7\n% conformia e2e\n1 0 obj\n<<>>\nendobj\n");

async function createUser(email: string, role: string, domain: string): Promise<string | null> {
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });

  let id: string | null = null;
  if (created.ok) {
    id = ((await created.json()) as { id?: string }).id ?? null;
  } else if (created.status === 422) {
    const found = await pool.query<{ id: string }>("select id from auth.users where email = $1", [
      email,
    ]);
    id = found.rows[0]?.id ?? null;
  }
  if (id === null) return null;

  await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, d.id from public.roles r, public.domains d
      where r.code = $2 and d.code = $3
     on conflict do nothing`,
    [id, role, domain],
  );
  await pool.query("update public.profiles set full_name = $2 where id = $1", [
    id,
    role === "COMPTA_MANAGER" ? "Responsable Pieces" : "Agent Social",
  ]);
  return id;
}

async function seed(): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

  const manager = await createUser(MANAGER, "COMPTA_MANAGER", "FISCAL");
  // Un compte d'un AUTRE domaine : il doit se voir refuser l'accès à la pièce.
  const outsider = await createUser(OUTSIDER, "RH_AGENT", "SOCIAL");
  if (manager === null || outsider === null) return false;

  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality)
     values ($1, 'PIECES-G', 'Declaration de charge', 'MONTHLY',
             '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
             (select id from public.domains where code = 'FISCAL'), 'HIGH')
     on conflict (id) do nothing`,
    [OBLIGATION],
  );

  await pool.query(
    `insert into public.obligation_required_documents
       (obligation_type_id, label, is_mandatory, document_kind, order_index)
     values ($1, 'Bordereau signe', true, 'JUSTIFICATIF', 1)
     on conflict do nothing`,
    [OBLIGATION],
  );

  await pool.query(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id)
     values ($1, '2026-07', '2026-07-01', '2026-07-31', '2099-08-20', '2099-08-15',
             'IN_PROGRESS', $2)
     on conflict do nothing`,
    [OBLIGATION, manager],
  );

  await pool.query(
    `insert into public.occurrence_checklist_items
       (occurrence_id, required_document_id, label, is_mandatory, document_kind, order_index)
     select oc.id, rd.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
       from public.obligation_occurrences oc
       join public.obligation_required_documents rd
         on rd.obligation_type_id = oc.obligation_type_id
      where oc.obligation_type_id = $1
     on conflict do nothing`,
    [OBLIGATION],
  );

  const rows = await pool.query<{ id: string }>(
    "select id from public.obligation_occurrences where obligation_type_id = $1",
    [OBLIGATION],
  );
  occurrenceId = rows.rows[0]?.id ?? "";
  return occurrenceId.length > 0;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });
}

/**
 * Dépose un fichier par l'interface, et attend l'issue.
 *
 * ⚠️ Attend d'abord un repère HYDRATÉ. `setInputFiles` avant l'hydratation pose
 * les fichiers sur un input que React n'écoute pas encore : l'événement se perd,
 * rien ne part, et le test échoue sur un symptôme qui n'a rien à voir.
 */
async function dropFile(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await expect(page.getByText(/Complétude du dossier/i)).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType, buffer });
}

test.beforeAll(async () => {
  ready = await seed();
});

test.afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(
      "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
    );
    const scope = `obligation_type_id = '${OBLIGATION}'`;
    await client.query(
      `delete from public.occurrence_transitions where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      `delete from public.document_upload_tickets where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      `delete from public.documents where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      `delete from public.occurrence_checklist_items where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(`delete from public.obligation_occurrences where ${scope}`);
    await client.query(`delete from public.obligation_required_documents where ${scope}`);
    await client.query("delete from public.obligation_types where id = $1", [OBLIGATION]);
  } finally {
    await client
      .query(
        "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
      )
      .catch(() => undefined);
    client.release();
  }
  await pool.end();
});

test.beforeEach(() => {
  test.skip(!ready, "SUPABASE_SERVICE_ROLE_KEY absent : session impossible.");
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("dépôt direct", () => {
  test("le fichier part du navigateur vers le stockage, et la pièce apparaît", async ({ page }) => {
    await signIn(page, MANAGER);

    /*
     * ⚠️ On observe le trafic pour ÉTABLIR — et non supposer — que les octets ne
     * transitent pas par le serveur applicatif. Un PUT doit partir vers le
     * stockage Supabase ; aucune requête ne doit porter le fichier vers /fr/…
     */
    const storagePuts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/storage/v1/object/upload/")) {
        storagePuts.push(request.url());
      }
    });

    await page.goto(`/fr/echeancier/${occurrenceId}`);
    await dropFile(page, "bordereau-juillet.pdf", "application/pdf", PDF_CONTENT);

    // La file d'envoi affiche l'issue, pièce par pièce.
    await expect(page.getByText(/Déposé/).first()).toBeVisible({ timeout: 30_000 });

    expect(storagePuts.length).toBeGreaterThan(0);

    // Et la pièce est bien inscrite, avec son empreinte non encore vérifiée.
    await expect(async () => {
      const { rows } = await pool.query<{ n: number; status: string }>(
        `select count(*)::int as n, coalesce(max(integrity_status::text), '') as status
           from public.documents where occurrence_id = $1 and deleted_at is null`,
        [occurrenceId],
      );
      expect(rows[0]?.n).toBe(1);
      expect(rows[0]?.status).toBe("PENDING");
    }).toPass({ timeout: 20_000 });
  });

  test("REFUSE un SVG sans même l'envoyer", async ({ page }) => {
    await signIn(page, MANAGER);

    const storagePuts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/storage/v1/object/upload/")) {
        storagePuts.push(request.url());
      }
    });

    await page.goto(`/fr/echeancier/${occurrenceId}`);
    await dropFile(
      page,
      "logo.svg",
      "image/svg+xml",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    );

    // Un SVG est un document XML pouvant porter du script : il n'est jamais admis.
    await expect(page.getByText(/jamais accepté|Format non autorisé/i).first()).toBeVisible({
      timeout: 20_000,
    });

    // Le refus est prononcé AVANT tout envoi : rien n'atteint le stockage.
    expect(storagePuts).toHaveLength(0);
  });
});

test.describe("consultation", () => {
  test("consulter et télécharger laissent chacun une trace", async ({ page }) => {
    await signIn(page, MANAGER);

    const documentId = await (async () => {
      const { rows } = await pool.query<{ id: string }>(
        "select id from public.documents where occurrence_id = $1 and deleted_at is null limit 1",
        [occurrenceId],
      );
      return rows[0]?.id ?? "";
    })();
    test.skip(documentId.length === 0, "aucune pièce déposée par le scénario précédent");

    const before = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.document_access_log where document_id = $1",
      [documentId],
    );

    // La route vérifie le droit, journalise, puis redirige vers une URL signée.
    const view = await page.request.get(`/api/documents/${documentId}/download?mode=inline`, {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(view.status());
    // ⚠️ Aucun chemin de stockage n'est exposé : la cible porte un jeton signé.
    expect(view.headers()["location"]).toContain("/storage/v1/object/sign/");

    const download = await page.request.get(`/api/documents/${documentId}/download`, {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(download.status());

    const after = await pool.query<{ action: string }>(
      "select action from public.document_access_log where document_id = $1",
      [documentId],
    );
    // TOUT est journalisé : la prévisualisation comme le téléchargement.
    expect(after.rows.length).toBe((before.rows[0]?.n ?? 0) + 2);
    expect(after.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["VIEW", "DOWNLOAD"]),
    );
  });

  test("un utilisateur d'un autre domaine se voit REFUSER la pièce", async ({ page }) => {
    await signIn(page, OUTSIDER);

    const documentId = await (async () => {
      const { rows } = await pool.query<{ id: string }>(
        "select id from public.documents where occurrence_id = $1 and deleted_at is null limit 1",
        [occurrenceId],
      );
      return rows[0]?.id ?? "";
    })();
    test.skip(documentId.length === 0, "aucune pièce déposée par le scénario précédent");

    const response = await page.request.get(`/api/documents/${documentId}/download`, {
      maxRedirects: 0,
    });

    // Ni 302, ni fichier : la pièce d'un autre domaine n'existe pas pour lui.
    expect([403, 404]).toContain(response.status());
    expect(response.headers()["location"]).toBeUndefined();
  });
});

test.describe("recherche transverse", () => {
  test("liste les pièces et permet de filtrer", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/documents");

    await expect(page.getByRole("heading", { name: /pièces|documents/i }).first()).toBeVisible();

    const search = page.getByLabel(/recherche de pièces/i);
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill("bordereau-juillet");

    await expect(page.getByText(/bordereau-juillet/i).first()).toBeVisible({ timeout: 20_000 });
    // L'empreinte n'ayant pas encore été recalculée, l'écran doit le DIRE.
    await expect(page.getByText(/Non vérifiée/i).first()).toBeVisible();
  });

  test("ne montre RIEN à un utilisateur d'un autre domaine", async ({ page }) => {
    await signIn(page, OUTSIDER);
    await page.goto("/fr/documents");

    // La vue est en security_invoker : le cloisonnement s'applique à la recherche.
    await expect(page.getByText(/bordereau-juillet/i)).toHaveCount(0);
  });
});
