import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { Pool } from "pg";

/**
 * Exports, dans un vrai navigateur et par de vraies requêtes HTTP.
 *
 * ⚠️ CE QUI NE SE VÉRIFIE QUE D'ICI : que l'archive s'OUVRE, et que son manifeste
 * correspond aux empreintes RÉELLES des fichiers qu'elle contient. C'est le
 * critère d'acceptation numéro un de cette phase, et aucun test à doublures ne
 * peut y répondre — il faut lire les octets que le serveur a effectivement
 * produits.
 *
 * Le cloisonnement, le journal et l'alerte de sauvegarde sont éprouvés sans
 * interface dans `tests/integration/exports-backups.test.ts`.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-exports-2026";
const MANAGER = "exp.e2e.manager@e2e.test.dz";
const OBLIGATION = "7c7c7c7c-0000-0000-0000-0000000000e1";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;
let occurrenceId = "";

/** Un vrai PDF minimal : en-tête %PDF, donc signature conforme au contrôle. */
const PDF_CONTENT = Buffer.from("%PDF-1.7\n% conformia export e2e\n1 0 obj\n<<>>\nendobj\n");

async function createUser(email: string): Promise<string | null> {
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
      where r.code = 'SUPERVISEUR' and d.code = 'FISCAL'
     on conflict do nothing`,
    [id],
  );
  await pool.query("update public.profiles set full_name = 'Responsable Exports' where id = $1", [
    id,
  ]);
  return id;
}

async function seed(): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

  const manager = await createUser(MANAGER);
  if (manager === null) return false;

  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality)
     values ($1, 'EXP-E2E', 'Declaration export e2e', 'MONTHLY',
             '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
             (select id from public.domains where code = 'FISCAL'), 'HIGH')
     on conflict (id) do nothing`,
    [OBLIGATION],
  );

  await pool.query(
    `insert into public.obligation_required_documents
       (obligation_type_id, label, is_mandatory, document_kind, order_index)
     values ($1, 'Bordereau', true, 'JUSTIFICATIF', 0)
     on conflict do nothing`,
    [OBLIGATION],
  );

  const inserted = await pool.query<{ id: string }>(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id)
     values ($1, '2026-05', '2026-05-01', '2026-05-31',
             current_date + 20, current_date + 13, 'IN_PROGRESS', $2)
     on conflict do nothing
     returning id`,
    [OBLIGATION, manager],
  );

  /*
   * ⚠️ La checklist est créée EXPLICITEMENT. Aucun trigger ne la dérive des
   * pièces requises : sans ces lignes, l'écran du dossier s'affiche mais la zone
   * de dépôt n'existe pas — il n'y a rien à quoi rattacher un fichier.
   */
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

  occurrenceId =
    inserted.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        "select id from public.obligation_occurrences where obligation_type_id = $1 limit 1",
        [OBLIGATION],
      )
    ).rows[0]?.id ??
    "";

  return occurrenceId.length > 0;
}

async function signIn(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(MANAGER);
  await page.getByLabel(/mot de passe/i).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });
}

/**
 * Lecture d'un ZIP sans dépendance.
 *
 * ⚠️ On lit le RÉPERTOIRE CENTRAL, pas les en-têtes locaux : c'est lui qui fait
 * foi dans le format, et c'est lui que lisent les outils d'archivage. Un fichier
 * dont les en-têtes locaux seraient corrects mais le répertoire central absent
 * s'ouvrirait ici et nulle part ailleurs.
 */
function readZipEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();

  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin.
  let end = -1;
  for (let index = archive.length - 22; index >= 0; index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("répertoire central absent : ce n'est pas un ZIP valide.");

  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);

  for (let item = 0; item < count; item += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("entrée de répertoire central malformée.");
    }
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = archive.subarray(dataStart, dataStart + compressedSize);

    // 0 = stocké, 8 = DEFLATE. Les deux sont légitimes dans une archive écrite
    // par `archiver`, qui ne compresse pas ce qui ne gagnerait rien.
    entries.set(name, method === 0 ? raw : inflateRawSync(raw));

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
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
    await client.query(
      "delete from public.obligation_required_documents where obligation_type_id = $1",
      [OBLIGATION],
    );
    await client.query("delete from public.obligation_types where id = $1", [OBLIGATION]);
    await client.query(
      "delete from public.export_runs where requested_by in (select id from auth.users where email = $1)",
      [MANAGER],
    );
  } finally {
    await client
      .query(
        "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
      )
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
});

test.beforeEach(async ({ page }) => {
  test.skip(!ready, "Jeu d'essai indisponible : SUPABASE_SERVICE_ROLE_KEY absente ?");
  await signIn(page);
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("archive de dossier", () => {
  test("L'ARCHIVE S'OUVRE ET LE MANIFESTE CORRESPOND AUX EMPREINTES RÉELLES", async ({ page }) => {
    // ── Une vraie pièce, déposée par le vrai chemin de dépôt direct.
    await page.goto(`/fr/echeancier/${occurrenceId}`);
    await expect(page.getByText(/Complétude du dossier/i)).toBeVisible({ timeout: 20_000 });
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "bordereau-export.pdf",
      mimeType: "application/pdf",
      buffer: PDF_CONTENT,
    });
    await expect(page.getByText(/Déposé/).first()).toBeVisible({ timeout: 30_000 });

    // ── L'archive, par une vraie requête HTTP.
    const response = await page.request.get(`/api/exports/dossier/${occurrenceId}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    expect(response.headers()["content-disposition"]).toMatch(
      /attachment; filename="AGROESPACE_EXP-E2E_2026-05_\d{8}-\d{4}\.zip"/,
    );

    const archive = Buffer.from(await response.body());
    const entries = readZipEntries(archive);

    // ── La fiche, les pièces, l'historique, le manifeste.
    expect([...entries.keys()]).toContain("00_fiche_recapitulative.pdf");
    expect([...entries.keys()]).toContain("manifest.json");
    expect([...entries.keys()]).toContain("historique.csv");

    const sheet = entries.get("00_fiche_recapitulative.pdf");
    expect(sheet?.subarray(0, 5).toString()).toBe("%PDF-");

    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}") as {
      files: {
        path: string;
        sha256: string;
        bytes: number;
        recordedSha256: string | null;
        matches: boolean | null;
      }[];
    };

    expect(manifest.files.length).toBeGreaterThanOrEqual(2);

    /*
     * ⚠️ LE CRITÈRE D'ACCEPTATION. Pour chaque fichier annoncé, on recalcule
     * l'empreinte des octets RÉELLEMENT présents dans l'archive et on la compare
     * à celle que le manifeste annonce. Un manifeste qui recopierait la base
     * sans relire les octets passerait un test plus faible — et laisserait
     * passer exactement l'altération qu'il prétend exclure.
     */
    for (const entry of manifest.files) {
      const bytes = entries.get(entry.path);
      expect(bytes, `fichier annoncé mais absent : ${entry.path}`).toBeDefined();
      if (bytes === undefined) continue;

      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
      expect(bytes.byteLength).toBe(entry.bytes);
    }

    // ── Et la pièce déposée concorde avec l'empreinte enregistrée au dépôt.
    const piece = manifest.files.find((entry) => entry.recordedSha256 !== null);
    expect(piece?.matches).toBe(true);
    expect(piece?.recordedSha256).toBe(createHash("sha256").update(PDF_CONTENT).digest("hex"));
  });

  test("l'historique consigne l'export, avec son auteur et son volume", async ({ page }) => {
    await page.request.get(`/api/exports/dossier/${occurrenceId}`);

    await expect(async () => {
      const { rows } = await pool.query<{ status: string; documents: number; author: string }>(
        `select r.status::text, r.document_count as documents, p.full_name as author
         from public.export_runs r join public.profiles p on p.id = r.requested_by
         where r.kind = 'DOSSIER' order by r.started_at desc limit 1`,
      );
      expect(rows[0]?.status).toBe("SUCCEEDED");
      expect(rows[0]?.author).toBe("Responsable Exports");
      expect(rows[0]?.documents).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
  });

  test("un dossier inconnu rend 404, jamais « accès refusé »", async ({ page }) => {
    // Un « accès refusé » confirmerait l'existence du dossier deviné.
    const response = await page.request.get(
      "/api/exports/dossier/00000000-0000-0000-0000-000000000000",
    );
    expect(response.status()).toBe(404);
  });
});

test.describe("page Rapports", () => {
  test("produit un tableau de suivi téléchargeable", async ({ page }) => {
    await page.goto("/fr/rapports");
    await expect(page.getByRole("heading", { name: /rapports et exports/i })).toBeVisible();

    const download = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /produire l'export/i }).click();

    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^suivi-occurrences-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test("affiche l'historique avec le nombre de dossiers réellement sortis", async ({ page }) => {
    await page.goto("/fr/rapports");
    await expect(page.getByRole("heading", { name: /historique des exports/i })).toBeVisible();
    await expect(page.getByRole("row").first()).toBeVisible();
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * DEUX GESTES ENCHAÎNÉS — L'ÉTAT D'ATTENTE, DANS UN VRAI NAVIGATEUR
 *
 * ⚠️ CE QUE CE TEST ÉTABLIT, ET CE QU'IL N'ÉTABLIT PAS. Il constate que pendant
 * la production d'un export, le bouton ANNONCE son travail et refuse le geste
 * suivant. Il ne prétend PAS distinguer l'ancien motif du nouveau : la
 * distinction se mesure au niveau du hook, où elle est déterministe — voir
 * `tests/unit/hooks/use-action-runner.test.tsx`, bloc « ce que les motifs
 * remplacés perdaient ».
 *
 * La raison est instructive. L'état d'attente de l'ancien motif retombait dans
 * la même image que le clic ; un relevé de navigateur, qui interroge le DOM
 * quelques millisecondes plus tard et réessaie, attrapait parfois l'image
 * précédente. Un test de bout en bout bâti là-dessus aurait été vert un jour
 * sur deux — c'est-à-dire pire qu'absent.
 *
 * Ce test garde donc le CONTRAT VISIBLE : l'écran dit qu'il travaille. Il
 * échouerait si le bouton cessait d'être gouverné par l'état d'attente.
 * ════════════════════════════════════════════════════════════════════════════
 */
test.describe("enchaînement de deux gestes — exports", () => {
  test("pendant la production, le geste suivant est HORS D'ATTEINTE", async ({ page }) => {
    await page.goto("/fr/rapports");

    /*
     * ⚠️ LE SÉLECTEUR NE PEUT PAS DÉPENDRE DU LIBELLÉ : le bouton s'intitule
     * « Produire l'export » au repos et « Production en cours… » pendant le
     * travail. Le viser par son nom au repos le ferait disparaître au moment
     * précis où l'on veut l'observer, et le test échouerait sur un élément
     * introuvable en laissant croire à un défaut de l'écran.
     */
    const bouton = page.getByRole("button", { name: /produire l'export|production en cours/i });
    await expect(bouton).toBeEnabled({ timeout: 20_000 });

    const telechargement = page.waitForEvent("download", { timeout: 60_000 });
    await bouton.click();

    // Le bouton DIT qu'il travaille, et refuse le geste suivant.
    await expect(bouton).toBeDisabled();
    await expect(bouton).toHaveText(/production en cours/i);

    await telechargement;

    // Puis il rend la main, l'export produit.
    await expect(bouton).toBeEnabled({ timeout: 20_000 });
    await expect(bouton).toHaveText(/produire l'export/i);
  });
});

test.describe("accessibilité", () => {
  test("aucune violation axe sur la page Rapports", async ({ page }) => {
    await page.goto("/fr/rapports");
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
