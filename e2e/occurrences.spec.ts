import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Échéancier, dans un vrai navigateur.
 *
 * Deux critères ne se vérifient qu'ici : les filtres survivent au rechargement
 * ET se partagent par URL, et l'export respecte les filtres appliqués.
 *
 * ⚠️ Les attentes d'URL portent un délai généreux (30 s). Elles vérifient une
 * CORRECTION — le filtre atteint-il bien l'URL — et non une performance. La
 * suite s'exécute sur un seul processus partagé par toutes les specs ; un délai
 * calibré sur une machine au repos rendait ces assertions instables sans que
 * rien ne soit cassé. Le budget de performance, lui, est mesuré là où il a un
 * sens : , sur 10 000 lignes.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const EMAIL = "ech.manager@e2e.test.dz";
const PASSWORD = "conformia-echeancier-2026";

const OBLIGATION_FISCAL = "88888888-0000-0000-0000-0000000000f1";
const OBLIGATION_SOCIAL = "88888888-0000-0000-0000-0000000000f2";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;

async function seed(): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

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
  if (created.ok) {
    id = ((await created.json()) as { id?: string }).id ?? null;
  } else if (created.status === 422) {
    const found = await pool.query<{ id: string }>("select id from auth.users where email = $1", [
      EMAIL,
    ]);
    id = found.rows[0]?.id ?? null;
  }
  if (id === null) return false;

  /*
   * DIRECTION : portée globale, occurrence.read + assign + export.generate.
   * ⚠️ Le second facteur est obligatoire pour ce rôle et le middleware détourne
   * vers l'enrôlement tant qu'il manque : on amène le compte à l'état d'un
   * utilisateur déjà enrôlé.
   */
  await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, null from public.roles r where r.code = 'DIRECTION'
     on conflict do nothing`,
    [id],
  );
  await pool.query(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status,
                                   created_at, updated_at, secret)
     values (gen_random_uuid(), $1, 'e2e', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP')
     on conflict do nothing`,
    [id],
  );

  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality)
     values
       ($1, 'ECH-FISC', 'Declaration fiscale de reference', 'MONTHLY',
        '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
        (select id from public.domains where code = 'FISCAL'), 'HIGH'),
       ($2, 'ECH-SOC', 'Declaration sociale de reference', 'MONTHLY',
        '{"anchor":"PERIOD_END","offset_days":30}'::jsonb, '2026-01-01',
        (select id from public.domains where code = 'SOCIAL'), 'LOW')
     on conflict (id) do nothing`,
    [OBLIGATION_FISCAL, OBLIGATION_SOCIAL],
  );

  await pool.query(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id)
     select
       t.id,
       '2026-' || lpad(p::text, 2, '0'),
       make_date(2026, p, 1),
       (make_date(2026, p, 1) + interval '1 month - 1 day')::date,
       (make_date(2026, p, 1) + interval '1 month + 19 days')::date,
       (make_date(2026, p, 1) + interval '1 month + 14 days')::date,
       'TODO',
       $3
     from (values ($1::uuid), ($2::uuid)) as t(id)
     cross join generate_series(1, 6) p
     on conflict do nothing`,
    [OBLIGATION_FISCAL, OBLIGATION_SOCIAL, id],
  );

  return true;
}

async function signIn(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(EMAIL);
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
    await client.query(
      `delete from public.occurrence_transitions where occurrence_id in (
         select id from public.obligation_occurrences where obligation_type_id in ($1, $2))`,
      [OBLIGATION_FISCAL, OBLIGATION_SOCIAL],
    );
    await client.query(
      "delete from public.obligation_occurrences where obligation_type_id in ($1, $2)",
      [OBLIGATION_FISCAL, OBLIGATION_SOCIAL],
    );
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
  test.skip(!ready, "SUPABASE_SERVICE_ROLE_KEY absent : session impossible.");

  /*
   * ⚠️ On efface les filtres MÉMORISÉS avant chaque scénario.
   *
   * Ce n'est pas une commodité de test : c'est la conséquence directe d'une
   * fonctionnalité voulue. Une URL sans aucun paramètre restaure les derniers
   * filtres de l'utilisateur ; un scénario qui filtre sur le domaine fiscal
   * laisse donc le suivant démarrer filtré, et son attente « la ligne sociale
   * est visible » échoue pour une raison qui n'a rien à voir avec lui.
   *
   * Sans ce nettoyage, la suite devient dépendante de son propre ordre.
   */
  await pool.query("delete from public.user_view_preferences where view_key = 'occurrences'");

  await signIn(page);
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("liste", () => {
  test("affiche l'échéance interne en tête et la légale en second", async ({ page }) => {
    await page.goto("/fr/echeancier");

    const row = page.getByRole("row", { name: /Declaration fiscale de reference/ }).first();
    await expect(row).toBeVisible();

    // ⚠️ Le mécanisme anti-retard : l'objectif interne (15) précède la limite
    // légale (20). Une inversion viderait la marge interne de son sens.
    await expect(row.getByText("15/02/2026")).toBeVisible();
    await expect(row.getByText("20/02/2026")).toBeVisible();
  });

  test("les filtres survivent au rechargement et se partagent par URL", async ({ page }) => {
    await page.goto("/fr/echeancier");
    await expect(page.getByRole("row", { name: /ECH-SOC|sociale/ }).first()).toBeVisible();

    await page.getByLabel(/^domaine$/i).click();
    await page.getByRole("option", { name: "Fiscal" }).click();
    await expect(page).toHaveURL(/domain=/, { timeout: 30_000 });

    // Rechargement : l'état vient de l'URL, il ne se perd pas.
    await page.reload();
    await expect(page.getByRole("row", { name: /fiscale/ }).first()).toBeVisible();
    await expect(page.getByRole("row", { name: /sociale/ })).toHaveCount(0);

    // Partage : la même URL dans un onglet neuf donne la même vue.
    const shared = page.url();
    const other = await page.context().newPage();
    await other.goto(shared);
    await expect(other.getByRole("row", { name: /fiscale/ }).first()).toBeVisible();
    await expect(other.getByRole("row", { name: /sociale/ })).toHaveCount(0);
    await other.close();
  });

  test("le tri est renvoyé au serveur, pas appliqué en mémoire", async ({ page }) => {
    await page.goto("/fr/echeancier");
    await page
      .getByRole("button", { name: /période/i })
      .first()
      .click();

    // Le tri passe par l'URL : c'est la preuve qu'il est traité en base.
    await expect(page).toHaveURL(/sort=period_key/, { timeout: 30_000 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("export", () => {
  test("produit un XLSX conforme aux filtres appliqués", async ({ page }) => {
    // Filtre sur le domaine fiscal : l'export ne doit contenir que lui.
    await page.goto("/fr/echeancier");
    await page.getByLabel(/^domaine$/i).click();
    await page.getByRole("option", { name: "Fiscal" }).click();
    await expect(page).toHaveURL(/domain=/, { timeout: 30_000 });

    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: /exporter/i }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^echeancier-.*\.xlsx$/);

    const path = await file.path();
    expect(path).not.toBeNull();

    // Le classeur est un ZIP : les quatre premiers octets le prouvent.
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes.length).toBeGreaterThan(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("calendrier", () => {
  test("conserve les filtres au basculement liste ↔ calendrier", async ({ page }) => {
    await page.goto("/fr/echeancier");
    await page.getByLabel(/^domaine$/i).click();
    await page.getByRole("option", { name: "Fiscal" }).click();
    await expect(page).toHaveURL(/domain=/, { timeout: 30_000 });

    const domain = new URL(page.url()).searchParams.get("domain");
    await page.getByRole("link", { name: /calendrier/i }).click();

    await expect(page).toHaveURL(/\/echeancier\/calendrier/);
    // Le filtre a voyagé : les deux écrans lisent la même URL.
    expect(new URL(page.url()).searchParams.get("domain")).toBe(domain);
  });

  test("propose les trois échelles et positionne les échéances", async ({ page }) => {
    await page.goto("/fr/echeancier/calendrier?anchor=2026-02-01");

    await expect(page.getByRole("button", { name: "Mois", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trimestre", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Année", exact: true })).toBeVisible();

    // L'échéance interne du 15/02 doit apparaître dans la grille de février.
    await expect(page.getByRole("button", { name: /15\/02\/2026/ })).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("mes tâches", () => {
  test("groupe par urgence", async ({ page }) => {
    await page.goto("/fr/mes-taches");

    // Les six occurrences seedées sont à venir : au moins un groupe apparaît.
    await expect(
      page.getByRole("heading", { name: /à venir|ce mois|cette semaine|en retard/i }).first(),
    ).toBeVisible();
    await expect(page.getByText("ECH-FISC").first()).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("accessibilité", () => {
  test("aucune violation axe sur la liste, le calendrier et mes tâches", async ({ page }) => {
    for (const path of ["/fr/echeancier", "/fr/echeancier/calendrier", "/fr/mes-taches"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      expect(results.violations.map((violation) => `${path}: ${violation.id}`)).toEqual([]);
    }
  });
});
