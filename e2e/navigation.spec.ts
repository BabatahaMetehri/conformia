import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Coquille de navigation, éprouvée dans un vrai navigateur.
 *
 * Le compte de test reçoit le rôle RH_AGENT sur le domaine SOCIAL : c'est
 * exactement le critère d'acceptation — il ne doit voir ni Administration, ni
 * quoi que ce soit du domaine fiscal, y compris dans la recherche.
 *
 * Le rôle est attribué EN BASE et non simulé : c'est la seule façon de vérifier
 * que le filtrage de l'interface et le cloisonnement de la RLS disent la même
 * chose. Deux sources de vérité qui se contredisent produiraient un lien qui
 * mène à une page vide.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TEST_EMAIL = "nav.rh@e2e.test.dz";
const TEST_PASSWORD = "conformia-nav-2026";

const OBLIGATION_FISCAL = "aaaae2e0-0000-0000-0000-0000000000f1";
const OBLIGATION_SOCIAL = "aaaae2e0-0000-0000-0000-0000000000f2";
const OCCURRENCE_SOCIAL = "aaaae2e0-0000-0000-0000-0000000000c2";

const pool = new Pool({ connectionString: DB_URL, max: 4 });

let userId: string | null = null;

/** Crée le compte via l'API d'administration ; rend son identifiant. */
async function ensureAccount(): Promise<string | null> {
  if (SERVICE_KEY.length === 0) return null;

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
  });

  if (created.ok) {
    const body = (await created.json()) as { id?: string };
    return body.id ?? null;
  }
  // 422 : le compte survit d'une exécution précédente. On le retrouve en base.
  if (created.status !== 422) return null;

  const found = await pool.query<{ id: string }>("select id from auth.users where email = $1", [
    TEST_EMAIL,
  ]);
  return found.rows[0]?.id ?? null;
}

async function grantRoleAndSeed(id: string): Promise<void> {
  await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, d.id
     from public.roles r, public.domains d
     where r.code = 'RESPONSABLE' and d.code = 'SOCIAL'
     on conflict do nothing`,
    [id],
  );

  await pool.query(
    `insert into public.obligation_types (id, code, name, periodicity, due_rule, effective_from, domain_id)
     values
       ($1, 'E2E-G50', 'Déclaration G50 mensuelle', 'MONTHLY',
        '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
        (select id from public.domains where code = 'FISCAL')),
       ($2, 'E2E-CNAS', 'Déclaration CNAS trimestrielle', 'QUARTERLY',
        '{"anchor":"PERIOD_END","offset_days":30}'::jsonb, '2026-01-01',
        (select id from public.domains where code = 'SOCIAL'))
     on conflict (id) do nothing`,
    [OBLIGATION_FISCAL, OBLIGATION_SOCIAL],
  );

  await pool.query(
    `insert into public.obligation_occurrences
       (id, obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, owner_id, status)
     values ($1, $2, '2026-Q1', '2026-01-01', '2026-03-31', '2026-04-30', '2026-04-27', $3, 'TODO')
     on conflict (id) do nothing`,
    [OCCURRENCE_SOCIAL, OBLIGATION_SOCIAL, id],
  );
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(TEST_EMAIL);
  await page.getByLabel(/mot de passe/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15_000 });
}

test.beforeAll(async () => {
  userId = await ensureAccount();
  if (userId !== null) await grantRoleAndSeed(userId);
});

/**
 * ⚠️ Le nettoyage ne doit RIEN avaler.
 *
 * Ces lignes vivent dans la base locale que partagent toutes les suites. Une
 * occurrence oubliée ici fait échouer `tests/integration/rls.test.ts`, qui
 * compte les dossiers visibles d'un agent RH — et l'échec apparaît dans une
 * suite qui n'a rien fait de mal, ce qui est le pire endroit pour le chercher.
 *
 * Insérer une occurrence crée une ligne dans `occurrence_transitions`, table
 * append-only protégée par trigger : la supprimer exige de lever ce trigger, de
 * retirer la trace, puis de le remettre. C'est exactement le geste de la suite
 * d'intégration ; l'omettre faisait échouer le DELETE en silence.
 */
test.afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(
      "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
    );
    await client.query("delete from public.occurrence_transitions where occurrence_id = $1", [
      OCCURRENCE_SOCIAL,
    ]);
    await client.query("delete from public.obligation_occurrences where id = $1", [
      OCCURRENCE_SOCIAL,
    ]);
    await client.query("delete from public.obligation_types where id in ($1, $2)", [
      OBLIGATION_FISCAL,
      OBLIGATION_SOCIAL,
    ]);
  } finally {
    await client.query(
      "alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only",
    );
    client.release();
    await pool.end();
  }
});

test.beforeEach(async ({ page }) => {
  test.skip(userId === null, "SUPABASE_SERVICE_ROLE_KEY absent : session impossible.");
  await signIn(page);
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("barre latérale", () => {
  test("RH_AGENT voit son domaine et AUCUNE entrée d'administration", async ({ page }) => {
    const sidebar = page.getByRole("complementary", { name: /navigation principale/i });

    await expect(sidebar.getByRole("link", { name: /échéancier/i })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /documents/i })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /mes tâches/i })).toBeVisible();

    // Absentes, pas masquées : elles ne figurent nulle part dans le document.
    await expect(sidebar.getByRole("button", { name: /administration/i })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: /journal d'audit/i })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: /à valider/i })).toHaveCount(0);
  });

  test("les entrées interdites sont absentes du HTML SERVI, pas seulement de l'écran", async ({
    page,
  }) => {
    // Le vrai test du filtrage serveur : on lit la charge utile, pas le DOM.
    const response = await page.goto("/fr/mes-taches");
    const html = (await response?.text()) ?? "";

    /*
     * ⚠️ On cherche des LIENS, pas des libellés.
     *
     * Chercher « Journal d'audit » échouerait toujours, et pour une raison qui
     * n'a rien à voir avec les permissions : next-intl sérialise le catalogue de
     * messages ENTIER dans la page, catalogue qui contient forcément le libellé
     * de chaque section. Un libellé présent ne prouve donc rien ; un `href`
     * présent, si — il n'apparaît que si le serveur a rendu l'entrée.
     */
    expect(html).toContain('href="/fr/mes-taches"');
    expect(html).toContain('href="/fr/echeancier"');
    expect(html).not.toContain('href="/fr/audit"');
    expect(html).not.toContain('href="/fr/admin');
  });

  test("le repli survit au rechargement", async ({ page }) => {
    await page.getByRole("button", { name: /replier la barre latérale/i }).click();
    await expect(page.getByRole("button", { name: /déployer la barre latérale/i })).toBeVisible();

    await page.reload();
    // Rendu par le SERVEUR depuis le cookie : la barre ne s'affiche pas déployée
    // avant de se replier.
    await expect(page.getByRole("button", { name: /déployer la barre latérale/i })).toBeVisible();

    await page.getByRole("button", { name: /déployer la barre latérale/i }).click();
  });
});

test.describe("recherche globale", () => {
  test("⌘K ouvre la palette et Échap la referme", async ({ page }) => {
    await page.keyboard.press("Control+k");

    const input = page.getByPlaceholder(/rechercher une obligation/i);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("se parcourt entièrement au clavier, jusqu'à la navigation", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("cnas");

    const option = page.getByRole("option", { name: /CNAS/i }).first();
    await expect(option).toBeVisible({ timeout: 10_000 });

    // Aucune souris : flèche puis Entrée.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    // Les sections métier ont été renommées : la palette mène à `/referentiel`
    // ou `/echeancier`, jamais aux anciens chemins.
    await page.waitForURL(/\/(referentiel|echeancier)\//, { timeout: 10_000 });
  });

  test("ne trouve RIEN du domaine fiscal", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("G50");

    // L'obligation fiscale existe en base ; la RLS la rend invisible à ce compte.
    await expect(page.getByText(/aucun résultat/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("option", { name: /G50/i })).toHaveCount(0);
  });

  test("réclame deux caractères avant de chercher", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("c");

    // Ciblé sur l'état vide de la liste : la description du dialogue porte la
    // même phrase, en `sr-only`, et rendrait le sélecteur ambigu.
    await expect(page.locator("[cmdk-empty]")).toHaveText(/au moins 2 caractères/i);
  });
});

test.describe("routage", () => {
  test("le fil d'Ariane traduit les segments", async ({ page }) => {
    await page.goto("/fr/echeancier");
    const crumbs = page.getByRole("navigation", { name: /fil d'ariane/i });
    await expect(crumbs.getByText("Échéancier")).toBeVisible();
  });

  test("une section interdite rend « introuvable », jamais « accès refusé »", async ({ page }) => {
    // RH_AGENT n'a pas settings.manage. La page ne doit pas confirmer qu'elle existe.
    await page.goto("/fr/admin/settings");

    await expect(page.getByText(/page introuvable/i)).toBeVisible();
    await expect(page.getByText(/accès refusé|droits nécessaires|non autorisé/i)).toHaveCount(0);
  });

  test("une URL inconnue rend le même écran qu'une section interdite", async ({ page }) => {
    await page.goto("/fr/cette-page-nexiste-pas");
    await expect(page.getByText(/page introuvable/i)).toBeVisible();

    // Rendu DANS la coquille : on ne perd pas la navigation en se perdant.
    await expect(page.getByRole("complementary", { name: /navigation principale/i })).toBeVisible();
  });

  test("une URL sans locale est redirigée vers le français", async ({ page }) => {
    await page.goto("/echeancier");
    await expect(page).toHaveURL(/\/fr\/echeancier$/);
  });
});

test.describe("accessibilité de la coquille", () => {
  test("aucune violation axe sur un écran de section", async ({ page }) => {
    await page.goto("/fr/echeancier");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(
      results.violations.map((violation) => `${violation.id} (${violation.impact ?? "?"})`),
    ).toEqual([]);
  });

  test("le lien d'évitement est la première cible du clavier", async ({ page }) => {
    await page.goto("/fr/echeancier");
    await page.keyboard.press("Tab");

    await expect(page.getByRole("link", { name: /aller au contenu principal/i })).toBeFocused();
  });
});
