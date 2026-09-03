import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * LES ÉCRANS QUI ÉTAIENT DES COQUILLES.
 *
 * ⚠️ Trois pages rendaient un marque-place « Cette section n'est pas encore
 * construite » : « Mon profil », le sommaire d'Administration, et les règles de
 * notification. Elles étaient référencées par la navigation, atteignables, et
 * vides — la pire forme d'incomplétude, celle qui a l'air d'une fonctionnalité.
 *
 * ⚠️ Ce fichier vérifie qu'elles portent désormais des DONNÉES RÉELLES, pas
 * seulement un titre. Une page qui affiche son en-tête et rien d'autre passerait
 * un test d'existence tout en restant une coquille.
 */

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const PASSWORD = "conformia-ecrans-2026";
const USERS = { agent: "ec.agent@e2e.test.dz", admin: "ec.admin@e2e.test.dz" } as const;

const pool = new Pool({ connectionString: DB_URL, max: 2 });
const ids: Record<string, string> = {};
let ready = false;

async function createUser(
  email: string,
  role: string,
  domain: string | null,
): Promise<string | null> {
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
  if (id === null) return null;

  await pool.query(
    domain === null
      ? `insert into public.user_roles (user_id, role_id)
         select $1, r.id from public.roles r where r.code = $2 on conflict do nothing`
      : `insert into public.user_roles (user_id, role_id, domain_id)
         select $1, r.id, d.id from public.roles r, public.domains d
          where r.code = $2 and d.code = $3 on conflict do nothing`,
    domain === null ? [id, role] : [id, role, domain],
  );
  await pool.query("update public.profiles set full_name = $2 where id = $1", [id, email]);
  return id;
}

/**
 * Pose un second facteur vérifié.
 *
 * ⚠️ `has_verified_mfa()` lit `auth.mfa_factors` : sans facteur, le middleware
 * enferme un ADMIN sur l'écran d'enrôlement, et le test mesurerait cette
 * redirection au lieu de l'écran visé.
 */
async function ensureVerifiedFactor(userId: string): Promise<void> {
  await pool.query(
    `insert into auth.mfa_factors
       (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     select gen_random_uuid(), $1, 'CONFORMIA-ECRANS', 'totp', 'verified',
            now(), now(), 'JBSWY3DPEHPK3PXP'
      where not exists (
        select 1 from auth.mfa_factors f where f.user_id = $1 and f.status = 'verified')`,
    [userId],
  );
  await pool.query("update public.profiles set mfa_enrolled = true where id = $1", [userId]);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("button", { name: /menu utilisateur/i })).toBeVisible({
    timeout: 30_000,
  });
}

test.beforeAll(async () => {
  if (SERVICE_KEY.length === 0) return;
  const agent = await createUser(USERS.agent, "RESPONSABLE", "FISCAL");
  const admin = await createUser(USERS.admin, "ADMIN", null);
  if (agent === null || admin === null) return;
  ids["agent"] = agent;
  ids["admin"] = admin;
  await ensureVerifiedFactor(admin);
  ready = true;
});

test.afterAll(async () => {
  await pool.end();
});

test.beforeEach(() => {
  test.skip(!ready, "Jeu d'essai indisponible : SUPABASE_SERVICE_ROLE_KEY absente ?");
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("mon profil", () => {
  test("montre l'identité, le rôle et sa portée", async ({ page }) => {
    await signIn(page, USERS.agent);
    await page.goto("/fr/profile");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    // L'adresse : c'est ce qui prouve que la page lit la SESSION, pas un gabarit.
    await expect(page.getByText(USERS.agent).first()).toBeVisible();

    /*
     * Le rôle ET son domaine : la réponse à « pourquoi je ne vois pas ce
     * dossier ». Le libellé est celui de la BASE — depuis la migration 0018,
     * la triade a remplacé la répartition par service.
     */
    await expect(page.getByText(/Responsable/i).first()).toBeVisible();
    await expect(page.getByText(/Fiscal/i).first()).toBeVisible();
  });

  test("annonce l'état du second facteur", async ({ page }) => {
    await signIn(page, USERS.agent);
    await page.goto("/fr/profile");

    await expect(page.getByRole("heading", { name: /Sécurité/i })).toBeVisible({
      timeout: 20_000,
    });
    // Ce compte n'a pas de second facteur : l'écran doit le dire, et proposer
    // de l'activer. Une page muette laisserait croire qu'il est en place.
    await expect(page.getByText(/Vérification en deux étapes inactive/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Activer/i })).toBeVisible();
  });

  test("ne propose AUCUNE modification des droits", async ({ page }) => {
    /*
     * ⚠️ La garantie qui compte sur cet écran. Voir ses propres rôles est utile ;
     * pouvoir les changer serait une élévation de privilège offerte à tous.
     */
    await signIn(page, USERS.agent);
    await page.goto("/fr/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("button", { name: /enregistrer|ajouter|supprimer/i })).toHaveCount(
      0,
    );
    await expect(page.locator("form")).toHaveCount(0);
  });
});

test.describe("sommaire de l'administration", () => {
  test("liste les sections réellement accessibles", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/fr/admin");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    // Un ADMIN porte user.manage, role.manage et settings.manage.
    await expect(page.getByRole("link", { name: /Utilisateurs & rôles/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Paramètres/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Travaux planifiés/i })).toBeVisible();
  });

  test("le sommaire ne montre RIEN de plus que la barre latérale", async ({ page }) => {
    /*
     * ⚠️ Deux listes d'entrées d'administration, deux formulations des droits, et
     * le jour où elles divergent c'est la moins stricte qui gagne. Le sommaire
     * lit le MÊME arbre filtré : on le vérifie en comparant les deux.
     *
     * ⚠️ LE GROUPE DOIT ÊTRE DÉPLIÉ D'ABORD. Dans la barre latérale,
     * « Administration » est un bouton repliable, ouvert seulement quand l'un de
     * ses enfants est actif : sur /fr/admin, aucun ne l'est, et les liens
     * existent dans le DOM mais masqués. Les compter sans déplier rendrait un
     * ensemble vide, et la comparaison passerait pour une mauvaise raison.
     */
    await signIn(page, USERS.admin);
    await page.goto("/fr/admin");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    const navigation = page.getByRole("navigation").first();
    const group = navigation.getByRole("button", { name: /administration/i }).first();
    if ((await group.getAttribute("aria-expanded")) === "false") await group.click();

    const pathsOf = async (scope: ReturnType<typeof page.getByRole>): Promise<string[]> =>
      (
        await scope.getByRole("link").evaluateAll((links) =>
          links.map((link) =>
            // Tout ce qui porte le rôle « link » n'est pas une ancre : un bouton
            // ou un élément SVG peut le porter, et n'a alors aucun `pathname`.
            link instanceof HTMLAnchorElement ? link.pathname : "",
          ),
        )
      ).filter((path) => path.includes("/admin/") || path.endsWith("/audit"));

    const hubPaths = new Set(await pathsOf(page.getByRole("main")));
    const sidebarPaths = new Set(await pathsOf(navigation));

    expect(hubPaths.size).toBeGreaterThan(0);
    expect(sidebarPaths.size).toBeGreaterThan(0);

    for (const path of hubPaths) {
      expect(sidebarPaths, `${path} figure au sommaire mais pas dans la navigation`).toContain(
        path,
      );
    }
  });

  test("un agent n'atteint pas le sommaire", async ({ page }) => {
    await signIn(page, USERS.agent);
    await page.goto("/fr/admin");
    await expect(page.getByText(/Page introuvable/i)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("règles de notification", () => {
  test("affiche les rappels et l'escalade tels qu'ils sont en base", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/fr/admin/notifications");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    // Les jalons livrés par défaut : J-30 … J-1, puis J+1 … J+7.
    await expect(page.getByText("30 j avant échéance").first()).toBeVisible();
    await expect(page.getByText("7 j après échéance").first()).toBeVisible();

    // Et la chaîne d'escalade, qui est la partie la moins devinable.
    await expect(page.getByText(/Chef de service/i).first()).toBeVisible();
    await expect(page.getByText(/Direction/i).first()).toBeVisible();
  });

  test("l'écran est en LECTURE : aucun contrôle d'écriture", async ({ page }) => {
    /*
     * ⚠️ Une règle éteinte par mégarde ne casse rien de visible : elle supprime
     * des rappels, et le défaut ne se découvre qu'à la première échéance
     * manquée. Le changement passe par une migration, pas par un clic.
     */
    await signIn(page, USERS.admin);
    await page.goto("/fr/admin/notifications");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /enregistrer|activer|désactiver/i })).toHaveCount(
      0,
    );
  });
});

test.describe("plus aucune coquille", () => {
  test("aucun écran de la navigation ne rend « pas encore construite »", async ({ page }) => {
    /*
     * ⚠️ LE TEST QUI EMPÊCHE LA RÉGRESSION. Un marque-place est confortable à
     * poser et facile à oublier : il a l'air d'une fonctionnalité, il figure au
     * sommaire, et rien ne le signale. On balaie donc les écrans atteignables.
     */
    await signIn(page, USERS.admin);

    const paths = [
      "/fr/profile",
      "/fr/admin",
      "/fr/admin/notifications",
      "/fr/admin/users",
      "/fr/admin/roles",
      "/fr/admin/settings",
      "/fr/admin/jobs",
      "/fr/admin/referentials",
      "/fr/notifications",
    ];

    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByText(/n'est pas encore construite/i),
        `${path} rend encore un marque-place`,
      ).toHaveCount(0);
    }
  });
});
