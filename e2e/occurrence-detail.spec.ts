import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Fiche d'occurrence, dans un vrai navigateur.
 *
 * Un critère d'acceptation ne se vérifie QUE d'ici : « un utilisateur sans droit
 * de validation ne voit pas les boutons ». L'autre moitié — « et ne peut pas
 * déclencher l'action » — est vérifiée par appel direct dans
 * `tests/integration/occurrence-detail.test.ts`, sans passer par l'interface.
 * Les deux niveaux sont exigés ; aucun ne remplace l'autre.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-fiche-2026";
const MANAGER = "fiche.manager@e2e.test.dz";
const AGENT = "fiche.agent@e2e.test.dz";

const OBLIGATION = "89898989-0000-0000-0000-0000000000a1";
const DEPENDENCY = "89898989-0000-0000-0000-0000000000a2";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;
const ids: Record<string, string> = {};

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
  // L'API d'administration ne renseigne aucun nom : sans cela, la fiche
  // afficherait « Non renseigné » partout et les assertions ne prouveraient rien.
  await pool.query("update public.profiles set full_name = $2 where id = $1", [
    id,
    email === MANAGER ? "Responsable Fiche" : "Agent Fiche",
  ]);
  return id;
}

async function seed(): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

  // ⚠️ COMPTA_MANAGER et COMPTA_AGENT n'exigent pas de second facteur : contrairement
  // aux specs qui jouent DIRECTION, aucun facteur MFA n'a besoin d'être posé ici.
  const manager = await createUser(MANAGER, "SUPERVISEUR", "FISCAL");
  const agent = await createUser(AGENT, "RESPONSABLE", "FISCAL");
  if (manager === null || agent === null) return false;

  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality,
        procedure_md, portal_url)
     values ($1, 'FICHE-DEP', 'Assemblee generale ordinaire', 'ANNUAL',
             '{"anchor":"PERIOD_END","offset_days":180}'::jsonb, '2026-01-01',
             (select id from public.domains where code = 'FISCAL'), 'HIGH', null, null)
     on conflict (id) do nothing`,
    [DEPENDENCY],
  );

  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality,
        procedure_md, portal_url, depends_on_obligation_type_id)
     values ($1, 'FICHE-G', 'Declaration de charge trimestrielle', 'MONTHLY',
             '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
             (select id from public.domains where code = 'FISCAL'), 'HIGH',
             '## Marche a suivre' || chr(10) || chr(10) || 'Deposer le bordereau signe.',
             'https://portail.example.dz', $2)
     on conflict (id) do nothing`,
    [OBLIGATION, DEPENDENCY],
  );

  await pool.query(
    `insert into public.obligation_required_documents
       (obligation_type_id, label, is_mandatory, document_kind, order_index)
     values ($1, 'Bordereau signe', true, 'JUSTIFICATIF', 1),
            ($1, 'Annexe de calcul', true, 'JUSTIFICATIF', 2),
            ($1, 'Correspondance', false, 'CORRESPONDANCE', 3)
     on conflict do nothing`,
    [OBLIGATION],
  );

  // Dépendance laissée EN COURS : le bandeau doit apparaître, sans rien bloquer.
  await pool.query(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status)
     values ($1, '2026', '2026-01-01', '2026-12-31', '2027-06-30', '2027-06-15', 'IN_PROGRESS')
     on conflict do nothing`,
    [DEPENDENCY],
  );

  await pool.query(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, submitted_for_validation_at,
        owner_id, validator_id)
     values
       ($1, '2026-01', '2026-01-01', '2026-01-31', '2099-02-20', '2099-02-15',
        'IN_PROGRESS', null, $2, $3),
       ($1, '2026-02', '2026-02-01', '2026-02-28', '2099-03-20', '2099-03-15',
        'PENDING_VALIDATION', now(), $2, $3),
       ($1, '2025-12', '2025-12-01', '2025-12-31', '2026-01-20', '2026-01-15',
        'ARCHIVED', null, $2, $3)
     on conflict do nothing`,
    [OBLIGATION, agent, manager],
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

  const rows = await pool.query<{ id: string; period_key: string }>(
    "select id, period_key from public.obligation_occurrences where obligation_type_id = $1",
    [OBLIGATION],
  );
  for (const row of rows.rows) ids[row.period_key] = row.id;

  return true;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });
}

const occurrence = (period: string): string => {
  const id = ids[period];
  if (id === undefined) throw new Error(`occurrence ${period} absente du jeu d'essai`);
  return id;
};

test.beforeAll(async () => {
  ready = await seed();
});

test.afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(
      "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
    );
    const scope = `obligation_type_id in ('${OBLIGATION}', '${DEPENDENCY}')`;
    await client.query(
      `delete from public.occurrence_transitions where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    // ⚠️ Les billets de dépôt (0009) référencent l'occurrence : sans ce retrait,
    // la suppression du jeu d'essai bute sur la clé étrangère et fait échouer
    // l'`afterAll`, qui se signale sur un test sans rapport.
    await client.query(
      `delete from public.document_upload_tickets where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      `delete from public.documents where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      `delete from public.occurrence_comments where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      `delete from public.occurrence_checklist_items where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(`delete from public.obligation_occurrences where ${scope}`);
    await client.query(
      "delete from public.obligation_required_documents where obligation_type_id in ($1, $2)",
      [OBLIGATION, DEPENDENCY],
    );
    await client.query("delete from public.obligation_types where id in ($1, $2)", [
      OBLIGATION,
      DEPENDENCY,
    ]);
  } finally {
    await client.query(
      "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
    );
    client.release();
    await pool.end();
  }
});

test.beforeEach(() => {
  test.skip(!ready, "SUPABASE_SERVICE_ROLE_KEY absent : session impossible.");
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("en-tête et bandeaux", () => {
  test("l'échéance interne domine, la légale suit en second", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Declaration de charge trimestrielle",
    );
    await expect(page.getByText("15/02/2099")).toBeVisible();
    await expect(page.getByText("20/02/2099")).toBeVisible();
    await expect(page.getByText("Agent Fiche")).toBeVisible();
    await expect(page.getByText("Responsable Fiche")).toBeVisible();
  });

  test("le bandeau de dépendance informe sans bloquer", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    await expect(page.getByText(/Assemblee generale ordinaire/)).toBeVisible();
    // ⚠️ Informer n'est pas bloquer : les actions restent proposées.
    await expect(page.getByRole("button", { name: "Soumettre à validation" })).toBeVisible();
  });
});

test.describe("dossier", () => {
  test("nomme les pièces obligatoires manquantes et empêche la soumission", async ({ page }) => {
    await signIn(page, AGENT);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    await expect(page.getByText("0 sur 2")).toBeVisible();
    await expect(
      page.getByText(/Il manque encore : Bordereau signe, Annexe de calcul/),
    ).toBeVisible();

    const submit = page.getByRole("button", { name: "Soumettre à validation" });
    await expect(submit).toBeDisabled();
  });

  test("le dépôt d'une pièce fait progresser la complétude", async ({ page }) => {
    await signIn(page, AGENT);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    await expect(page.getByText("0 sur 2")).toBeVisible();

    // Un vrai PDF, réduit à sa signature : c'est elle que le serveur contrôle.
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "bordereau.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1"),
      });

    // ⚠️ Depuis 0009 le dépôt est DIRECT et se déroule en plusieurs temps :
    // billet, envoi vers le stockage, empreinte, confirmation. La file d'envoi
    // annonce l'issue avant que la page ne soit rafraîchie — attendre d'abord
    // « Déposé » évite de conclure sur un compteur pas encore recalculé.
    await expect(page.getByText("Déposé", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("1 sur 2")).toBeVisible({ timeout: 30_000 });
    // Le nom d'origine reste affiché : l'utilisateur doit retrouver sa pièce.
    await expect(page.getByText("bordereau.pdf").first()).toBeVisible();
  });

  test("un format non autorisé est refusé", async ({ page }) => {
    await signIn(page, AGENT);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    // ⚠️ ATTENDRE L'HYDRATATION AVANT DE DÉPOSER. Sans cette attente, Playwright
    // pose le fichier sur un `<input>` encore inerte : l'événement `change` part,
    // React n'a pas de gestionnaire attaché, et RIEN ne se produit — ni requête,
    // ni message. Le test échouait alors en accusant l'absence de refus, alors
    // que le dépôt n'avait tout simplement jamais commencé.
    await expect(page.getByText("Complétude du dossier")).toBeVisible();

    // ⚠️ Exécutable Windows (signature « MZ ») déguisé en PDF : nom, extension et
    // type MIME annoncent tous un justificatif. Seuls les premiers octets disent
    // la vérité, et c'est sur eux que le serveur tranche.
    //
    // Un `.txt` annoncé « text/plain » NE convient PAS pour ce test : les formats
    // textuels n'ont aucune signature, et les refuser bloquerait tout CSV.
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "facture.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
      });

    // ⚠️ Le refus est désormais prononcé AVANT tout envoi : l'interface lit les
    // premiers octets du fichier et constate que la signature dément l'extension.
    // Ce n'est PAS ce qui protège — un client hostile n'exécute pas ce code — et
    // le même contrôle est refait par le serveur sur les octets réellement
    // stockés, éprouvé dans `tests/integration/document-storage.test.ts`. Ici,
    // on vérifie seulement que l'utilisateur honnête est prévenu immédiatement.
    await expect(
      page.getByText(/ne correspond pas à son extension|dépôt a été refusé/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("permissions", () => {
  test("un agent sans droit de validation NE VOIT PAS le bouton Valider", async ({ page }) => {
    await signIn(page, AGENT);
    await page.goto(`/fr/echeancier/${occurrence("2026-02")}`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Valider", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rejeter", exact: true })).toHaveCount(0);
  });

  test("un responsable habilité voit le bouton Valider", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-02")}`);

    await expect(page.getByRole("button", { name: "Valider", exact: true })).toBeVisible();
  });
});

test.describe("onglets", () => {
  test("la procédure du référentiel s'affiche en lecture seule", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    await page.getByRole("tab", { name: "Procédure" }).click();
    await expect(page.getByRole("heading", { name: "Marche a suivre" })).toBeVisible();
    await expect(page.getByRole("link", { name: /ouvrir le portail/i }).first()).toBeVisible();
  });

  test("les périodes précédentes donnent un accès direct", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-02")}`);

    await page.getByRole("tab", { name: "Périodes précédentes" }).click();
    const previous = page.getByRole("link", { name: /2026-01/ });
    await expect(previous).toBeVisible();

    await previous.click();
    await expect(page).toHaveURL(new RegExp(occurrence("2026-01")), { timeout: 30_000 });
  });

  test("un message publié apparaît dans la discussion", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    await page.getByRole("tab", { name: "Discussion" }).click();
    await page.getByLabel("Nouveau message").fill("Bordereau demande au service comptable.");
    await page.getByRole("button", { name: "Publier" }).click();

    await expect(page.getByText("Bordereau demande au service comptable.")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("l'historique montre la chronologie du dossier", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);

    await page.getByRole("tab", { name: "Historique" }).click();
    await expect(page.getByText(/Création du dossier|Modification/).first()).toBeVisible();
  });
});

test.describe("accessibilité", () => {
  test("aucune violation axe sur la fiche", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/fr/echeancier/${occurrence("2026-01")}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
