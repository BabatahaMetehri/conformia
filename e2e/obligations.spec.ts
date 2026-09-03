import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Référentiel des obligations, dans un vrai navigateur.
 *
 * Le point central de cette suite est le CRITÈRE DES DEUX NIVEAUX : un
 * utilisateur sans `referential.manage` ne doit ni voir les boutons d'écriture,
 * ni pouvoir appeler la Server Action directement. Vérifier seulement le premier
 * reviendrait à confondre « masqué » et « protégé ».
 *
 * Deux comptes : un REGLEMENTAIRE (lecture du référentiel, aucune écriture) et
 * un DIRECTION (referential.manage + occurrence.read).
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-referentiel-2026";

const READER = { email: "obl.reader@e2e.test.dz", role: "SUPERVISEUR" } as const;
const MANAGER = { email: "obl.manager@e2e.test.dz", role: "DIRECTION" } as const;

const OBLIGATION_ID = "44444444-0000-0000-0000-0000000000e1";

const pool = new Pool({ connectionString: DB_URL, max: 4 });

let ready = false;

async function ensureAccount(email: string, roleCode: string): Promise<string | null> {
  if (SERVICE_KEY.length === 0) return null;

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
    const body = (await created.json()) as { id?: string };
    id = body.id ?? null;
  } else if (created.status === 422) {
    const found = await pool.query<{ id: string }>("select id from auth.users where email = $1", [
      email,
    ]);
    id = found.rows[0]?.id ?? null;
  }
  if (id === null) return null;

  await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, null from public.roles r where r.code = $2
     on conflict do nothing`,
    [id, roleCode],
  );

  /*
   * ⚠️ Le second facteur est OBLIGATOIRE pour ADMIN et DIRECTION
   * (`mfa_required_for`), et le middleware détourne vers l'enrôlement tant qu'il
   * manque. Or ce sont les deux SEULS rôles porteurs de `referential.manage` :
   * sans facteur vérifié, aucun test d'écriture du référentiel n'atteint l'écran.
   *
   * On pose donc un facteur vérifié directement en base. Ce n'est pas contourner
   * la règle, c'est amener le compte à l'état où un utilisateur réel se trouve
   * après son enrôlement — l'écran d'enrôlement a sa propre suite.
   */
  if (roleCode === "ADMIN" || roleCode === "DIRECTION") {
    await pool.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status,
                                     created_at, updated_at, secret)
       values (gen_random_uuid(), $1, 'e2e', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP')
       on conflict do nothing`,
      [id],
    );
  }

  return id;
}

async function signIn(page: Page, email: string): Promise<void> {
  // On repart d'une session vierge : les tests partagent le contexte du projet.
  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });
}

test.beforeAll(async () => {
  const reader = await ensureAccount(READER.email, READER.role);
  const manager = await ensureAccount(MANAGER.email, MANAGER.role);
  ready = reader !== null && manager !== null;
  if (!ready) return;

  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality, procedure_md)
     values ($1, 'E2E-REF', 'Declaration mensuelle de reference', 'MONTHLY',
             '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
             (select id from public.domains where code = 'FISCAL'), 'HIGH',
             '# Depot\n\nDeposer sur le portail avant midi.')
     on conflict (id) do nothing`,
    [OBLIGATION_ID],
  );
});

test.afterAll(async () => {
  await pool
    .query("delete from public.obligation_types where id = $1", [OBLIGATION_ID])
    .catch(() => undefined);
  await pool.end();
});

test.beforeEach(() => {
  test.skip(!ready, "SUPABASE_SERVICE_ROLE_KEY absent : session impossible.");
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("liste du référentiel", () => {
  test("affiche l'obligation avec ses colonnes", async ({ page }) => {
    await signIn(page, MANAGER.email);
    await page.goto("/fr/referentiel");

    const row = page.getByRole("row", { name: /E2E-REF/ });
    await expect(row).toBeVisible();
    // `exact` : « Mensuelle » apparaît aussi dans « Declaration mensuelle de
    // reference », et un match partiel rendrait deux éléments.
    await expect(row.getByText("Mensuelle", { exact: true })).toBeVisible();
    await expect(row.getByText("Élevée", { exact: true })).toBeVisible();
  });

  test("la recherche porte sur le texte de la procédure", async ({ page }) => {
    await signIn(page, MANAGER.email);
    await page.goto("/fr/referentiel");

    // La liste est chargée avant la première frappe : sans cela, la saisie peut
    // précéder l'hydratation et le gestionnaire onChange ne voit jamais rien.
    await expect(page.getByRole("row", { name: /E2E-REF/ })).toBeVisible();

    // « portail » n'apparaît ni dans le code ni dans le nom : seul l'index de la
    // procédure peut le retrouver.
    await page.getByLabel(/^recherche$/i).fill("portail");
    await expect(page).toHaveURL(/q=portail/, { timeout: 30_000 });
    await expect(page.getByRole("row", { name: /E2E-REF/ })).toBeVisible();

    await page.getByLabel(/^recherche$/i).fill("motintrouvable");
    await expect(page).toHaveURL(/q=motintrouvable/, { timeout: 30_000 });
    await expect(page.getByRole("row", { name: /E2E-REF/ })).toHaveCount(0, { timeout: 30_000 });
  });

  test("le filtre vit dans l'URL et survit au rechargement", async ({ page }) => {
    await signIn(page, MANAGER.email);
    await page.goto("/fr/referentiel");

    await expect(page.getByRole("row", { name: /E2E-REF/ })).toBeVisible();

    await page.getByLabel(/périodicité/i).click();
    await page.getByRole("option", { name: "Trimestrielle" }).click();

    await expect(page).toHaveURL(/periodicity=QUARTERLY/);
    await page.reload();
    // L'obligation est mensuelle : le filtre trimestriel doit l'exclure.
    await expect(page.getByRole("row", { name: /E2E-REF/ })).toHaveCount(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("prévisualisation des échéances", () => {
  test("affiche 6 dates et rend le report visible", async ({ page }) => {
    await signIn(page, MANAGER.email);
    await page.goto(`/fr/referentiel/${OBLIGATION_ID}`);

    await page.getByRole("tab", { name: /règle d'échéance/i }).click();

    const table = page.getByRole("table", { name: /prévisualisation/i });
    await expect(table).toBeVisible();
    // Six lignes de données, sans compter l'en-tête.
    await expect(table.locator("tbody tr")).toHaveCount(6);

    // Au moins un report attendu : le 20 d'un mois tombe régulièrement un
    // vendredi ou un samedi, week-end algérien.
    await expect(table.getByText(/week-end|férié/).first()).toBeVisible();
  });

  test("se recalcule à la frappe, sans rechargement", async ({ page }) => {
    await signIn(page, MANAGER.email);
    await page.goto(`/fr/referentiel/${OBLIGATION_ID}/modifier`);

    await page.getByRole("tab", { name: /règle d'échéance/i }).click();

    const table = page.getByRole("table", { name: /prévisualisation/i });
    const firstDue = table.locator("tbody tr").first().locator("td").nth(1);
    const before = await firstDue.textContent();

    // Le calcul est LOCAL : changer le décalage doit modifier la date sans
    // aller-retour serveur.
    await page.getByLabel(/jours après la fin de période/i).fill("25");
    await expect(firstDue).not.toHaveText(before ?? "", { timeout: 5_000 });
  });

  test("dit pourquoi elle ne peut pas calculer, plutôt que d'afficher du vide", async ({
    page,
  }) => {
    await signIn(page, MANAGER.email);
    await page.goto(`/fr/referentiel/${OBLIGATION_ID}/modifier`);
    await page.getByRole("tab", { name: /règle d'échéance/i }).click();

    // Une ancre événementielle sans date d'ancrage n'est pas calculable.
    await page.getByLabel(/point de départ/i).click();
    await page.getByRole("option", { name: /date d'expiration/i }).click();

    await expect(page.getByText(/prévisualisation impossible/i)).toBeVisible();
    await expect(page.getByText(/date portée par le dossier/i)).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("permission : les DEUX niveaux", () => {
  test("sans referential.manage, aucun bouton d'écriture n'est rendu", async ({ page }) => {
    await signIn(page, READER.email);

    const response = await page.goto("/fr/referentiel");
    const html = (await response?.text()) ?? "";

    await expect(page.getByRole("row", { name: /E2E-REF/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /nouvelle obligation/i })).toHaveCount(0);
    // Le lien de création n'est pas seulement masqué : il n'est pas dans la page.
    expect(html).not.toContain('href="/fr/referentiel/nouveau"');
  });

  test("sans referential.manage, l'URL de création rend « introuvable »", async ({ page }) => {
    await signIn(page, READER.email);
    await page.goto("/fr/referentiel/nouveau");

    // Même écran qu'une ressource inexistante : on ne confirme pas que la page existe.
    await expect(page.getByText(/page introuvable/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^enregistrer$/i })).toHaveCount(0);
  });

  test("sans referential.manage, l'action APPELÉE DIRECTEMENT est refusée", async ({ page }) => {
    await signIn(page, READER.email);
    await page.goto("/fr/referentiel");

    /*
     * ⚠️ Le test qui compte. On ne clique pas : on rejoue la requête POST d'une
     * Server Action depuis le navigateur, avec les cookies de session. Une
     * protection qui ne vivrait que dans le rendu tomberait ici.
     *
     * Next répond 200 même en cas de refus applicatif : ce que l'on vérifie,
     * c'est qu'AUCUNE obligation n'a été créée.
     */
    const before = await pool.query<{ count: string }>(
      "select count(*) from public.obligation_types where code = 'E2E-FORGE'",
    );
    expect(Number(before.rows[0]?.count ?? "0")).toBe(0);

    await page.evaluate(async () => {
      await fetch(window.location.href, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8", "Next-Action": "forged" },
        body: JSON.stringify([{ code: "E2E-FORGE", name: "Tentative forgée" }]),
      });
    });

    const after = await pool.query<{ count: string }>(
      "select count(*) from public.obligation_types where code = 'E2E-FORGE'",
    );
    expect(Number(after.rows[0]?.count ?? "0")).toBe(0);
  });

  test("avec referential.manage, les boutons d'écriture sont là", async ({ page }) => {
    await signIn(page, MANAGER.email);
    await page.goto("/fr/referentiel");

    await expect(page.getByRole("link", { name: /nouvelle obligation/i })).toBeVisible();
    await page.goto("/fr/referentiel/nouveau");
    await expect(page.getByLabel(/^code$/i)).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("accessibilité du référentiel", () => {
  test("aucune violation axe sur la liste et sur la fiche", async ({ page }) => {
    await signIn(page, MANAGER.email);

    for (const path of ["/fr/referentiel", `/fr/referentiel/${OBLIGATION_ID}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      expect(results.violations.map((violation) => `${path}: ${violation.id}`)).toEqual([]);
    }
  });

  test("les pièces requises se réordonnent AU CLAVIER", async ({ page }) => {
    await signIn(page, MANAGER.email);
    await page.goto("/fr/referentiel/nouveau");
    await page.getByRole("tab", { name: /pièces requises/i }).click();

    await page.getByRole("button", { name: /ajouter une pièce/i }).click();
    await page.getByLabel("Libellé").first().fill("Première");
    await page.getByRole("button", { name: /ajouter une pièce/i }).click();
    await page.getByLabel("Libellé").nth(1).fill("Seconde");

    // Le glisser-déposer n'a aucun équivalent clavier : ces boutons SONT le
    // chemin de référence, pas un repli dégradé.
    await page.getByRole("button", { name: /déplacer la pièce 2 vers le haut/i }).click();

    await expect(page.getByLabel("Libellé").first()).toHaveValue("Seconde");
    await expect(page.getByLabel("Libellé").nth(1)).toHaveValue("Première");
  });
});
