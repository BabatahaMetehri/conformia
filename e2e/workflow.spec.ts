import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Circuit de validation, dans un vrai navigateur.
 *
 * Ce qui ne se vérifie QUE d'ici : qu'un dossier de criticité haute ne propose
 * AUCUNE case de validation groupée, et qu'une décision prise depuis la file
 * retire bien le dossier de la file. Le reste — matrice des transitions,
 * séparation des pouvoirs, double niveau, immuabilité d'une archive, délégation
 * expirée — est éprouvé sans interface dans `tests/integration/workflow.test.ts`,
 * par appel direct. Les deux niveaux sont exigés ; aucun ne remplace l'autre.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-workflow-2026";
const MANAGER = "wf.e2e.manager@e2e.test.dz";
const AGENT = "wf.e2e.agent@e2e.test.dz";

const LOW = "8b8b8b8b-0000-0000-0000-0000000000c1";
const CRITICAL = "8b8b8b8b-0000-0000-0000-0000000000c2";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;
let managerId = "";

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
    role === "SUPERVISEUR" ? "Responsable Circuit" : "Agent Circuit",
  ]);
  return id;
}

async function seed(): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

  const manager = await createUser(MANAGER, "SUPERVISEUR", "FISCAL");
  const agent = await createUser(AGENT, "RESPONSABLE", "FISCAL");
  if (manager === null || agent === null) return false;
  managerId = manager;

  for (const [id, code, criticality, levels] of [
    [LOW, "WFE-LOW", "LOW", 1],
    [CRITICAL, "WFE-CRIT", "CRITICAL", 2],
  ] as const) {
    await pool.query(
      `insert into public.obligation_types
         (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality,
          validation_levels)
       values ($1, $2, $3, 'MONTHLY',
               '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
               (select id from public.domains where code = 'FISCAL'), $4, $5)
       on conflict (id) do nothing`,
      [id, code, `Declaration ${criticality}`, criticality, levels],
    );
  }

  // Les deux dossiers attendent la validation du manager, et l'agent en est le
  // préparateur : la séparation des pouvoirs est donc respectée.
  await pool.query(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, submitted_for_validation_at,
        owner_id, validator_id)
     values
       ($1, '2026-09', '2026-09-01', '2026-09-30', '2099-10-20', '2099-10-15',
        'PENDING_VALIDATION', now(), $3, $4),
       ($2, '2026-09', '2026-09-01', '2026-09-30', '2099-10-20', '2099-10-15',
        'PENDING_VALIDATION', now(), $3, $4)
     on conflict do nothing`,
    [LOW, CRITICAL, agent, manager],
  );

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

test.beforeAll(async () => {
  ready = await seed();
});

test.afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(
      "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
    );
    const scope = `obligation_type_id in ('${LOW}', '${CRITICAL}')`;
    await client.query(
      `delete from public.occurrence_transitions where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      `delete from public.notifications where occurrence_id in (
         select id from public.obligation_occurrences where ${scope})`,
    );
    await client.query(
      "delete from public.validation_delegations where delegator_id = $1 or delegate_id = $1",
      [managerId],
    );
    await client.query(`delete from public.obligation_occurrences where ${scope}`);
    await client.query("delete from public.obligation_types where id in ($1, $2)", [LOW, CRITICAL]);
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

test.describe("file de validation", () => {
  test("liste les dossiers en attente de MA validation", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/validation");

    await expect(page.getByText("Declaration LOW")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Declaration CRITICAL")).toBeVisible();
  });

  test("le préparateur, lui, n'y voit RIEN de ses propres dossiers", async ({ page }) => {
    // ⚠️ Séparation des pouvoirs : l'agent a préparé les deux dossiers, il ne
    // peut donc pas les valider — et la file ne doit pas les lui proposer.
    await signIn(page, AGENT);
    await page.goto("/fr/validation");

    await expect(page.getByText("Declaration LOW")).toHaveCount(0);
    await expect(page.getByText("Declaration CRITICAL")).toHaveCount(0);
  });

  test("la validation GROUPÉE n'est proposée que sur les criticités basses", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/validation");
    await expect(page.getByText("Declaration LOW")).toBeVisible({ timeout: 20_000 });

    // Deux dossiers en attente, mais UNE seule case : la criticité CRITICAL
    // n'est jamais groupable, et le geste n'est donc pas même proposé.
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(1);

    await expect(page.getByRole("checkbox", { name: /Declaration LOW/i })).toBeVisible();
  });

  test("valider depuis la file retire le dossier de la file", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/validation");

    const row = page.locator("li", { hasText: "Declaration LOW" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Valider", exact: true }).click();

    await expect(page.getByText("Declaration LOW")).toHaveCount(0, { timeout: 30_000 });

    const { rows } = await pool.query<{ status: string }>(
      "select status from public.obligation_occurrences where obligation_type_id = $1",
      [LOW],
    );
    expect(rows[0]?.status).toBe("VALIDATED");
  });

  test("un dossier à DEUX niveaux reste en attente après la première validation", async ({
    page,
  }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/validation");

    const row = page.locator("li", { hasText: "Declaration CRITICAL" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Valider", exact: true }).click();

    // ⚠️ Le dossier NE bascule PAS : la première validation est une étape, et
    // l'interface doit le dire, sans quoi le validateur croira son geste perdu.
    await expect(page.getByText(/Première validation enregistrée/i)).toBeVisible({
      timeout: 30_000,
    });

    const { rows } = await pool.query<{ status: string }>(
      "select status from public.obligation_occurrences where obligation_type_id = $1",
      [CRITICAL],
    );
    expect(rows[0]?.status).toBe("PENDING_VALIDATION");
  });

  test("rejeter EXIGE un motif", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/validation");

    const row = page.locator("li", { hasText: "Declaration CRITICAL" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Rejeter", exact: true }).click();

    const confirm = page.getByRole("dialog").getByRole("button", { name: "Rejeter", exact: true });
    // Sans motif, le geste n'est pas offert : le préparateur doit savoir quoi corriger.
    await expect(confirm).toBeDisabled();

    await page.getByLabel(/motif du rejet/i).fill("le montant de la case 12 est erroné");
    await expect(confirm).toBeEnabled();
  });
});

test.describe("délégations", () => {
  test("créer puis révoquer une délégation", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/admin/delegations");

    await page.getByRole("button", { name: /nouvelle délégation/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Agent Circuit/i }).click();

    const end = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel(/^fin$/i).fill(end);
    await dialog.getByLabel(/^motif$/i).fill("congé annuel du responsable");
    await dialog.getByRole("button", { name: /enregistrer/i }).click();

    await expect(page.getByText(/Agent Circuit/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Active").first()).toBeVisible();

    // La révocation exige elle aussi un motif : le journal doit dire pourquoi la
    // délégation a été ouverte ET pourquoi elle a été refermée.
    await page
      .getByRole("button", { name: /révoquer/i })
      .first()
      .click();
    const revokeDialog = page.getByRole("dialog");
    const confirm = revokeDialog.getByRole("button", { name: /révoquer/i });
    await expect(confirm).toBeDisabled();

    await revokeDialog.getByLabel(/^motif$/i).fill("retour de congé anticipé");
    await confirm.click();

    await expect(page.getByText("Révoquée").first()).toBeVisible({ timeout: 30_000 });

    // ⚠️ La ligne SURVIT : elle justifie les actions faites sous son couvert.
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.validation_delegations where delegator_id = $1",
      [managerId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

test.describe("accessibilité", () => {
  test("aucune violation axe sur la file et sur les délégations", async ({ page }) => {
    await signIn(page, MANAGER);

    for (const path of ["/fr/validation", "/fr/admin/delegations"]) {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations, `${path} : ${JSON.stringify(results.violations)}`).toEqual([]);
    }
  });
});
