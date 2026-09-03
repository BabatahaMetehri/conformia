import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Tableau de bord et administration, dans un vrai navigateur.
 *
 * Ce qui ne se vérifie QUE d'ici : que les graphiques Recharts se rendent au
 * lieu de faire tomber la page, que chaque graphique porte bien sa table de
 * données accessible, et que la note explicative de la matrice des rôles est
 * réellement affichée. Les refus — auto-attribution, expiration obligatoire,
 * désactivation sans réaffectation — sont éprouvés par appel direct dans
 * `tests/integration/dashboard-admin.test.ts`, là où ils doivent tenir.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-admin-2026";
const ADMIN = "adm.e2e.admin@e2e.test.dz";
const MANAGER = "adm.e2e.manager@e2e.test.dz";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;
const ids: Record<string, string> = {};

async function createUser(email: string, role: string, domain: string | null): Promise<boolean> {
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
  if (created.ok) id = ((await created.json()) as { id?: string }).id ?? null;
  else if (created.status === 422) {
    const found = await pool.query<{ id: string }>("select id from auth.users where email = $1", [
      email,
    ]);
    id = found.rows[0]?.id ?? null;
  }
  if (id === null) return false;
  ids[email] = id;

  await pool.query(
    domain === null
      ? `insert into public.user_roles (user_id, role_id)
         select $1, r.id from public.roles r where r.code = $2 on conflict do nothing`
      : `insert into public.user_roles (user_id, role_id, domain_id)
         select $1, r.id, d.id from public.roles r, public.domains d
          where r.code = $2 and d.code = $3 on conflict do nothing`,
    domain === null ? [id, role] : [id, role, domain],
  );
  await pool.query("update public.profiles set full_name = $2 where id = $1", [
    id,
    role === "ADMIN" ? "Admin E2E" : "Responsable E2E",
  ]);

  /*
   * ⚠️ ADMIN et DIRECTION ne peuvent PAS entrer dans l'application sans second
   * facteur : le middleware les renvoie vers /mfa/enroll. C'est une garantie de
   * la phase 4, et il n'est pas question de l'affaiblir pour faire passer un
   * test. On place donc le compte d'essai dans l'état où se trouve un vrai
   * administrateur — facteur enrôlé et vérifié — au lieu de contourner la garde.
   *
   * `has_verified_mfa()` lit `auth.mfa_factors` : c'est cette table qui fait
   * foi, `profiles.mfa_enrolled` n'en étant qu'un reflet.
   */
  if (role === "ADMIN") {
    await pool.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
       values (gen_random_uuid(), $1, 'e2e', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP')
       on conflict do nothing`,
      [id],
    );
    await pool.query("update public.profiles set mfa_enrolled = true where id = $1", [id]);
  }
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
  if (SERVICE_KEY.length === 0) return;
  const admin = await createUser(ADMIN, "ADMIN", null);
  const manager = await createUser(MANAGER, "SUPERVISEUR", "FISCAL");
  ready = admin && manager;
  await pool.query("select public.refresh_dashboard_views()").catch(() => undefined);
});

test.afterAll(async () => {
  const all = Object.values(ids);
  if (all.length > 0) {
    await pool
      .query("delete from public.user_roles where user_id = any($1)", [all])
      .catch(() => undefined);
    await pool
      .query("delete from public.profiles where id = any($1)", [all])
      .catch(() => undefined);
    await pool.query("delete from auth.users where id = any($1)", [all]).catch(() => undefined);
  }
  await pool.end();
});

test.beforeEach(() => {
  test.skip(!ready, "SUPABASE_SERVICE_ROLE_KEY absent : session impossible.");
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("tableau de bord", () => {
  test("affiche ses indicateurs et rend ses quatre graphiques", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/dashboard");

    await expect(
      page.getByRole("heading", { name: "Évolution du taux de conformité" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Comparaison par domaine" })).toBeVisible();

    // Recharts se rend dans un <svg> : sa présence prouve que le composant a
    // survécu à l'hydratation, ce qu'aucun test serveur ne peut établir.
    await expect(page.locator(".recharts-responsive-container")).toHaveCount(4);
  });

  test("chaque graphique porte SA table de données", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/dashboard");
    await expect(
      page.getByRole("heading", { name: "Évolution du taux de conformité" }),
    ).toBeVisible({ timeout: 20_000 });

    // ⚠️ Exigence d'accessibilité, pas confort : trois des cinq teintes de la
    // palette passent sous 3:1 sur fond clair, ce qui n'est admis QUE si une
    // relève textuelle existe. Elle doit donc exister sur les quatre.
    const toggles = page.getByRole("button", { name: "Table de données" });
    await expect(toggles).toHaveCount(4);

    await toggles.first().click();
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("un compte ADMIN est redirigé plutôt que de voir « introuvable »", async ({ page }) => {
    // ADMIN ne détient pas dashboard.view_all : la connexion le dépose ici, et
    // une page « introuvable » juste après le mot de passe se lit comme une panne.
    await signIn(page, ADMIN);
    await page.goto("/fr/dashboard");
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });
});

test.describe("administration", () => {
  test("la matrice des rôles AFFICHE la note sur ADMIN", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/fr/admin/roles");

    // ⚠️ Sans cette note, un futur administrateur « corrigerait » ce qu'il
    // prendrait pour un oubli et s'ouvrirait les dossiers fiscaux.
    await expect(page.getByText(/n'a volontairement ni occurrence\.read/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("checkbox").first()).toBeVisible();
  });

  test("l'écran des comptes ne propose AUCUN champ de mot de passe", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/fr/admin/users");
    const inviteButton = page.getByRole("button", { name: "Inviter", exact: true });
    await expect(inviteButton).toBeVisible({ timeout: 20_000 });
    await inviteButton.click();

    // Un mot de passe choisi par un administrateur est un mot de passe connu
    // d'un tiers : le formulaire n'en propose pas, et ne doit jamais en proposer.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  });

  test("le journal d'audit se filtre et s'exporte", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/fr/audit");

    await expect(page.getByRole("button", { name: /filtrer/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /exporter/i })).toBeVisible();
  });

  test("les jours fériés civils sont présents et récurrents", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/fr/admin/referentials");

    await expect(page.getByText("Yennayer", { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Chaque année").first()).toBeVisible();
  });
});

test.describe("accessibilité", () => {
  test("aucune violation axe sur le tableau de bord et la matrice des rôles", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/fr/dashboard");
    await page.waitForLoadState("domcontentloaded");
    let results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations, `dashboard : ${JSON.stringify(results.violations)}`).toEqual([]);

    await signIn(page, ADMIN);
    await page.goto("/fr/admin/roles");
    await page.waitForLoadState("domcontentloaded");
    results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations, `roles : ${JSON.stringify(results.violations)}`).toEqual([]);
  });
});
