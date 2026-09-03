import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * L'ARABE, DE BOUT EN BOUT.
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE. Les catalogues `fr` et `ar` étaient tenus clé
 * pour clé — 1416 contre 1416 — et l'arabe restait pourtant INATTEIGNABLE : le
 * sélecteur de langue était figé sur le français. Une traduction complète que
 * personne ne peut afficher n'est pas une traduction, c'est un fichier.
 *
 * ⚠️ CE QU'IL VÉRIFIE, ET QUI NE SE DÉDUIT PAS D'UNE COMPARAISON DE CLÉS :
 *   • le choix de langue SURVIT à la navigation suivante (cookie, pas état local) ;
 *   • `dir="rtl"` est réellement posé sur le document ;
 *   • les écrans de travail rendent de l'arabe, pas du français par repli ;
 *   • la mise en page ne DÉBORDE PAS horizontalement une fois retournée ;
 *   • on peut revenir au français.
 */

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const EMAIL = "ar.agent@e2e.test.dz";
const PASSWORD = "conformia-arabe-2026";

const pool = new Pool({ connectionString: DB_URL, max: 2 });
let ready = false;

/** Contient au moins un caractère du bloc arabe. */
function hasArabic(value: string): boolean {
  return /[؀-ۿ]/.test(value);
}

async function signIn(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(EMAIL);
  await page.getByLabel(/mot de passe/i).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("button", { name: /menu utilisateur/i })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Passe dans la langue demandée, PAR LE CLAVIER.
 *
 * ⚠️ LE CLAVIER, ET C'EST UN CHOIX PLUTÔT QU'UN CONTOURNEMENT.
 *
 * Un clic de souris sur l'entrée d'un sous-menu Radix est intercepté dans un
 * navigateur piloté : la bibliothèque pose `pointer-events: none` sur le corps
 * du document pendant qu'un menu est ouvert, et le clic synthétique atterrit sur
 * `<html>` — mesuré, à répétition. Le geste au clavier, lui, passe par le focus
 * et non par des coordonnées.
 *
 * Ce que cela apporte en plus : le sélecteur de langue est éprouvé COMME
 * L'EMPLOIE une personne qui ne se sert pas de la souris. Un menu inaccessible
 * au clavier serait un défaut d'accessibilité réel, et ce test le verrait.
 */
async function switchLanguage(page: Page, label: RegExp): Promise<void> {
  await page.getByRole("button", { name: /menu utilisateur|قائمة المستخدم/i }).click();
  await page.getByRole("menuitem", { name: /langue|اللغة/i }).click();

  const item = page.getByRole("menuitem", { name: label });
  await expect(item).toBeVisible({ timeout: 10_000 });
  // `press` place le focus AVANT la frappe : aucune coordonnée n'entre en jeu.
  await item.press("Enter");
}

test.beforeAll(async () => {
  if (SERVICE_KEY.length === 0) return;

  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });

  let id: string | null = null;
  if (created.ok) id = ((await created.json()) as { id?: string }).id ?? null;
  else if (created.status === 422) {
    const found = await pool.query<{ id: string }>("select id from auth.users where email = $1", [
      EMAIL,
    ]);
    id = found.rows[0]?.id ?? null;
  }
  if (id === null) return;

  await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, d.id from public.roles r, public.domains d
      where r.code = 'COMPTA_AGENT' and d.code = 'FISCAL' on conflict do nothing`,
    [id],
  );
  await pool.query("update public.profiles set full_name = $2 where id = $1", [id, EMAIL]);
  ready = true;
});

test.afterAll(async () => {
  await pool.end();
});

test.beforeEach(() => {
  test.skip(!ready, "Jeu d'essai indisponible : SUPABASE_SERVICE_ROLE_KEY absente ?");
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("l'arabe est atteignable", () => {
  test("le menu utilisateur propose RÉELLEMENT les deux langues", async ({ page }) => {
    /*
     * ⚠️ Le test qui aurait attrapé le défaut. L'entrée « العربية » existait
     * dans les catalogues ; le menu, lui, n'affichait que le français et une
     * note « l'arabe arrivera dans une version ultérieure ».
     */
    await signIn(page);
    await page.getByRole("button", { name: /menu utilisateur/i }).click();
    await page.getByRole("menuitem", { name: /langue/i }).click();

    await expect(page.getByRole("menuitem", { name: "Français" })).toBeVisible();
    const arabic = page.getByRole("menuitem", { name: "العربية" });
    await expect(arabic).toBeVisible();
    // Proposée ET cliquable : une entrée grisée ne serait pas une langue offerte.
    await expect(arabic).toBeEnabled();
  });

  test("basculer en arabe change l'URL, la direction et le contenu", async ({ page }) => {
    await signIn(page);
    await switchLanguage(page, /العربية/);

    await page.waitForURL(/\/ar\//, { timeout: 30_000 });

    // ⚠️ `dir` sur la racine : c'est lui qui retourne la mise en page entière.
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    // Et le contenu est réellement traduit, pas replié sur le français.
    const navigation = await page.locator("nav").first().innerText();
    expect(hasArabic(navigation)).toBe(true);
    expect(navigation).not.toMatch(/Échéancier|Tableau de bord/);
  });

  test("le choix SURVIT à la navigation suivante", async ({ page }) => {
    /*
     * ⚠️ C'est ce que le cookie achète. Un état gardé en mémoire de page
     * ramènerait au français dès la première URL saisie à la main, dès le
     * prochain lien reçu par courriel, et à chaque rechargement.
     */
    await signIn(page);
    await switchLanguage(page, /العربية/);
    await page.waitForURL(/\/ar\//, { timeout: 30_000 });

    // Navigation manuelle vers une URL SANS préfixe : c'est le cookie qui décide.
    await page.goto("/echeancier");
    await expect(page).toHaveURL(/\/ar\/echeancier/, { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("les écrans de travail sont traduits, et ne débordent pas", async ({ page }) => {
    await signIn(page);
    await switchLanguage(page, /العربية/);
    await page.waitForURL(/\/ar\//, { timeout: 30_000 });

    for (const path of ["/ar/echeancier", "/ar/documents", "/ar/referentiel", "/ar/profile"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

      const heading = await page.getByRole("heading", { level: 1 }).first().innerText();
      expect(hasArabic(heading), `${path} rend « ${heading} »`).toBe(true);

      /*
       * ⚠️ AUCUN DÉBORDEMENT HORIZONTAL. C'est le défaut classique du RTL : une
       * marge physique oubliée pousse le contenu hors de l'écran, et la page
       * gagne une barre de défilement latérale que personne ne cherche.
       */
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} déborde de ${String(overflow)} px`).toBeLessThanOrEqual(1);
    }
  });

  test("la langue se choisit AVANT la connexion", async ({ page }) => {
    /*
     * ⚠️ L'IMPASSE QUE CECI FERME. Le sélecteur principal vit dans le menu de
     * l'application, donc derrière la connexion : une personne qui ne lit pas le
     * français devait réussir à se connecter pour pouvoir demander sa propre
     * langue. On ne voit pas cette impasse quand on lit la langue par défaut.
     */
    await page.context().clearCookies();
    await page.goto("/fr/login");

    await page.getByRole("button", { name: "العربية" }).click();
    await page.waitForURL(/\/ar\/login/, { timeout: 30_000 });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // Le formulaire lui-même est traduit : c'est tout l'intérêt.
    const form = await page.locator("main").innerText();
    expect(hasArabic(form)).toBe(true);
  });

  test("on peut revenir au français", async ({ page }) => {
    // Une langue dans laquelle on entre sans pouvoir en sortir est un piège :
    // l'utilisateur qui bascule par curiosité doit pouvoir revenir.
    await signIn(page);
    await switchLanguage(page, /العربية/);
    await page.waitForURL(/\/ar\//, { timeout: 30_000 });

    await switchLanguage(page, /Français/);
    await page.waitForURL(/\/fr\//, { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });
});
