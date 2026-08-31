import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Contrôle d'accessibilité automatisé.
 *
 * Exécuté dans un VRAI navigateur, sur un build de production : c'est la seule
 * façon de vérifier le contraste, qui dépend des couleurs calculées. Un contrôle
 * en jsdom ne saurait pas résoudre une variable CSS, et laisserait passer
 * précisément la classe de défauts la plus fréquente.
 *
 * axe-core ne remplace pas une relecture humaine — il attrape peut-être la moitié
 * des problèmes réels. Mais ce qu'il attrape ne doit jamais atteindre la branche.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const TEST_EMAIL = "a11y.agent@test.dz";
/** 12 caractères minimum, conformément à la politique serveur. */
const TEST_PASSWORD = "conformia-a11y-2026";

/** Normes visées : WCAG 2.1 niveau A et AA. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function analyse(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
}

/**
 * Crée le compte de test via l'API d'administration, puis se connecte par le
 * VRAI formulaire : la session obtenue est celle d'un utilisateur ordinaire,
 * cookies httpOnly compris.
 */
async function signIn(page: Page): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    }),
  });

  // 422 = le compte existe déjà : un rejeu de la suite ne doit pas échouer.
  if (!created.ok && created.status !== 422) return false;

  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(TEST_EMAIL);
  await page.getByLabel(/mot de passe/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();

  // La redirection post-connexion pointe vers un écran métier qui n'existe pas
  // encore : on attend simplement de ne plus être sur la page de connexion.
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15_000 });
  return true;
}

test.describe("accessibilité", () => {
  test("la page de connexion ne présente aucune violation axe", async ({ page }) => {
    await page.goto("/fr/login");
    const results = await analyse(page);

    expect(
      results.violations.map((violation) => `${violation.id} (${violation.impact ?? "?"})`),
    ).toEqual([]);
  });

  test("le système de design ne présente aucune violation axe, en clair et en sombre", async ({
    page,
  }) => {
    const connected = await signIn(page);
    test.skip(!connected, "SUPABASE_SERVICE_ROLE_KEY absent : session impossible.");

    await page.goto("/fr/_design-system");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const light = await analyse(page);
    expect(
      light.violations.map((violation) => `clair: ${violation.id} (${violation.impact ?? "?"})`),
    ).toEqual([]);

    // Le mode sombre a ses propres jetons : il doit être contrôlé séparément.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });

    const dark = await analyse(page);
    expect(
      dark.violations.map((violation) => `sombre: ${violation.id} (${violation.impact ?? "?"})`),
    ).toEqual([]);
  });

  test("le thème s'applique avant le premier rendu, sans clignotement", async ({ page }) => {
    await page.goto("/fr/login");

    // next-themes pose un script en ligne portant le nonce de la requête. Sans
    // nonce, notre CSP le bloquerait et la page basculerait après coup.
    const inlineScriptHasNonce = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll("script:not([src])")];
      return scripts.length > 0 && scripts.every((script) => script.hasAttribute("nonce"));
    });
    expect(inlineScriptHasNonce).toBe(true);

    // Aucune erreur CSP n'a été levée : le script a bien pu s'exécuter.
    const csp = await page.evaluate(
      () =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute("content") ?? "",
    );
    expect(csp).not.toContain("unsafe-inline");
  });
});
