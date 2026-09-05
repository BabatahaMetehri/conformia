import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Centre de notifications et flux calendrier, dans un vrai navigateur.
 *
 * Ce qui ne se vérifie QUE d'ici : que la cloche porte son compteur, que le
 * panneau charge à l'ouverture, que marquer lu fait disparaître la pastille, et
 * surtout que le FLUX ICS est servi par une requête HTTP réelle, avec le bon
 * type de contenu et sans cache partagé. Le reste — déduplication, escalade,
 * cloisonnement du flux — est éprouvé sans interface dans
 * `tests/integration/notifications.test.ts`. Les deux niveaux sont exigés ;
 * aucun ne remplace l'autre.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-notif-2026";
const AGENT = "notif.e2e.agent@e2e.test.dz";
const OBLIGATION = "9c9c9c9c-0000-0000-0000-0000000000a1";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;

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
      where r.code = 'RESPONSABLE' and d.code = 'FISCAL'
     on conflict do nothing`,
    [id],
  );
  await pool.query("update public.profiles set full_name = 'Agent Notification' where id = $1", [
    id,
  ]);
  return id;
}

async function seed(): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

  const agent = await createUser(AGENT);
  if (agent === null) return false;

  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality)
     values ($1, 'NOTIF-E2E', 'Declaration notification', 'MONTHLY',
             '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
             (select id from public.domains where code = 'FISCAL'), 'HIGH')
     on conflict (id) do nothing`,
    [OBLIGATION],
  );

  /*
   * ⚠️ Échéance DANS LES DOUZE MOIS, calculée depuis aujourd'hui. Une date
   * lointaine — 2099, comme dans les autres jeux d'essai — sort de l'horizon du
   * flux calendrier, qui ne publie qu'un an devant. Le dossier existait alors
   * bel et bien, mais le flux était vide : un test rouge pour une raison sans
   * rapport avec ce qu'il vérifie.
   */
  const occurrence = await pool.query<{ id: string }>(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id)
     values ($1, '2099-01', '2099-01-01', '2099-01-31',
             current_date + 37, current_date + 30, 'TODO', $2)
     on conflict do nothing
     returning id`,
    [OBLIGATION, agent],
  );

  const occurrenceId =
    occurrence.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        "select id from public.obligation_occurrences where obligation_type_id = $1 limit 1",
        [OBLIGATION],
      )
    ).rows[0]?.id;

  if (occurrenceId === undefined) return false;

  // Deux messages non lus, écrits par la voie officielle : l'insertion directe
  // est refusée à tout le monde, y compris au rôle de service.
  for (const subject of ["Notification E2E numéro un", "Notification E2E numéro deux"]) {
    await pool.query(
      `select public.enqueue_notification(
         p_recipient := $1,
         p_channel := 'IN_APP',
         p_kind := 'UPCOMING_DEADLINE',
         p_subject := $2,
         p_body_text := $2,
         p_scheduled_for := now(),
         p_occurrence := $3)`,
      [agent, subject, occurrenceId],
    );
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
  ready = await seed();
});

test.afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query(
      "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
    );
    await client.query(
      `delete from public.notifications where occurrence_id in (
         select id from public.obligation_occurrences where obligation_type_id = $1)`,
      [OBLIGATION],
    );
    await client.query(
      `delete from public.occurrence_transitions where occurrence_id in (
         select id from public.obligation_occurrences where obligation_type_id = $1)`,
      [OBLIGATION],
    );
    await client.query("delete from public.obligation_occurrences where obligation_type_id = $1", [
      OBLIGATION,
    ]);
    await client.query("delete from public.obligation_types where id = $1", [OBLIGATION]);
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

  /*
   * ⚠️ ÉTAT DE LECTURE REMIS À ZÉRO avant chaque scénario.
   *
   * Sans cela, « marquer tout comme lu » laissait les deux messages lus pour le
   * scénario suivant, qui filtre justement les NON lues et n'en trouvait plus.
   * Le défaut ne se voyait qu'une fois sur deux : Playwright répartit les
   * fichiers entre plusieurs processus, et l'ordre d'exécution des tests d'un
   * même fichier n'est garanti que lorsqu'ils partagent le même. Un test qui
   * dépend de ce que le précédent a modifié est un test qui échouera un jour,
   * sur une machine différente, pour une raison qu'on cherchera ailleurs.
   */
  await pool.query(
    `update public.notifications set read_at = null, dismissed_at = null
     where recipient_id = (select id from auth.users where email = $1)`,
    [AGENT],
  );

  await signIn(page, AGENT);
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("cloche et panneau", () => {
  test("la cloche annonce le nombre de messages non lus", async ({ page }) => {
    await page.goto("/fr/echeancier");
    // Le compteur est dans le NOM ACCESSIBLE du bouton, pas seulement dans la
    // pastille : la pastille est décorative, et un lecteur d'écran ne la voit pas.
    await expect(page.getByRole("button", { name: /2 non lue/i })).toBeVisible();
  });

  test("le panneau charge ses messages À L'OUVERTURE", async ({ page }) => {
    await page.goto("/fr/echeancier");
    await page.getByRole("button", { name: /non lue/i }).click();
    await expect(page.getByText("Notification E2E numéro un")).toBeVisible();
  });

  test("marquer tout comme lu vide le compteur", async ({ page }) => {
    await page.goto("/fr/notifications");
    await page.getByRole("button", { name: /tout marquer comme lu/i }).click();

    await expect(page.getByRole("button", { name: /tout marquer comme lu/i })).toBeHidden();

    // Le compteur suit à la navigation suivante : il est lu au rendu de
    // l'en-tête, pas rafraîchi par un sondage.
    await page.goto("/fr/echeancier");
    await expect(page.getByRole("button", { name: /aucune non lue/i })).toBeVisible();
  });
});

test.describe("centre de notifications", () => {
  test("filtre les non lues sans quitter la page", async ({ page }) => {
    await page.goto("/fr/notifications");
    await expect(page.getByText("Notification E2E numéro un")).toBeVisible();

    await page.getByRole("button", { name: /^non lues$/i }).click();
    await expect(page.getByText("Notification E2E numéro un")).toBeVisible();
  });

  test("offre les préférences par canal, SMS annoncé indisponible", async ({ page }) => {
    await page.goto("/fr/notifications");
    await expect(page.getByRole("heading", { name: /préférences de notification/i })).toBeVisible();
    // Affiché, et inerte : le masquer laisserait croire que le canal n'existe pas.
    await expect(page.getByText(/le canal sms n'est pas ouvert/i)).toBeVisible();
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * DEUX GESTES ENCHAÎNÉS — L'ÉCRAN CONTRE LA BASE
 *
 * ⚠️ L'ASSERTION NE COMPARE PAS L'ÉCRAN À LUI-MÊME. Un instantané périmé est
 * parfaitement cohérent avec lui-même ; c'est l'écart avec ce qui est ENREGISTRÉ
 * qui définit la donnée périmée. On régénère donc le jeton, on enchaîne
 * immédiatement un second geste, et l'on exige que l'adresse affichée soit celle
 * que la base détient — celle qu'un agenda pourra réellement interroger.
 *
 * Ce test ne prétend pas distinguer l'ancien motif du nouveau : la course que
 * l'ancien rendait possible — deux envois concurrents sur la même ressource —
 * se mesure au niveau du hook, où elle est déterministe. Voir
 * `tests/unit/hooks/use-action-runner.test.tsx`.
 * ════════════════════════════════════════════════════════════════════════════
 */
test.describe("enchaînement de deux gestes — jeton de calendrier", () => {
  test("l'adresse AFFICHÉE est celle de la base, même après deux clics", async ({ page }) => {
    await page.goto("/fr/profile/calendar");

    const champ = page.getByLabel(/adresse du flux/i);
    await expect(champ).toHaveValue(/\/api\/calendar\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const bouton = page.getByRole("button", { name: /régénérer/i });

    /*
     * Deux gestes enchaînés. Le second est FORCÉ : on veut savoir ce que fait
     * l'écran quand l'utilisateur clique alors que le premier envoi n'est pas
     * revenu, et non ce que fait Playwright quand il attend poliment. Sur le
     * bouton désactivé de la version corrigée, le navigateur ignore le clic —
     * c'est précisément la protection qu'on éprouve.
     */
    await bouton.click();
    await bouton.click({ force: true, timeout: 2_000 }).catch(() => undefined);

    await expect(bouton).toBeEnabled({ timeout: 20_000 });

    await expect(async () => {
      const { rows } = await pool.query<{ token: string }>(
        `select token::text as token from public.calendar_feed_tokens
          where user_id = (select id from auth.users where email = $1)`,
        [AGENT],
      );
      const enBase = rows[0]?.token ?? "";
      expect(enBase).not.toBe("");
      // ⚠️ L'écart entre l'affiché et l'enregistré EST la donnée périmée.
      await expect(champ).toHaveValue(new RegExp(`${enBase}$`));
    }).toPass({ timeout: 20_000 });
  });
});

test.describe("flux calendrier", () => {
  test("affiche l'adresse, l'avertissement et le mode d'emploi", async ({ page }) => {
    await page.goto("/fr/profile/calendar");

    const field = page.getByLabel(/adresse du flux/i);
    await expect(field).toHaveValue(/\/api\/calendar\/[0-9a-f-]{36}$/);

    // L'adresse vaut mot de passe : le dire est la moitié de la fonctionnalité.
    await expect(page.getByText(/vaut mot de passe/i)).toBeVisible();
    await expect(page.getByText(/outlook/i)).toBeVisible();
    await expect(page.getByText(/google agenda/i)).toBeVisible();
  });

  test("le flux est servi en text/calendar, et JAMAIS mis en cache partagé", async ({
    page,
    request,
  }) => {
    await page.goto("/fr/profile/calendar");
    /*
     * ⚠️ On rejoue le CHEMIN, pas l'URL absolue affichée. Celle-ci vient de
     * `NEXT_PUBLIC_APP_URL` et vise `localhost`, que Node résout en IPv6 (::1)
     * alors que le serveur de test écoute en IPv4. C'est un artefact de
     * l'environnement, pas un défaut du produit — mais il ferait échouer le test
     * pour une raison sans rapport avec ce qu'il vérifie.
     */
    const url = new URL(await page.getByLabel(/adresse du flux/i).inputValue()).pathname;

    const response = await request.get(url);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/calendar");

    /*
     * ⚠️ `private` : un flux personnel servi depuis un cache partagé livrerait
     * l'échéancier d'un utilisateur à un autre. C'est la seule façon de
     * transformer un compromis maîtrisé — le jeton dans l'URL — en fuite.
     */
    expect(response.headers()["cache-control"]).toContain("private");

    const body = await response.text();
    expect(body.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(body).toContain("NOTIF-E2E");
  });

  test("RÉGÉNÉRER LE JETON coupe l'ancienne adresse immédiatement", async ({ page, request }) => {
    await page.goto("/fr/profile/calendar");
    const before = new URL(await page.getByLabel(/adresse du flux/i).inputValue()).pathname;

    await page.getByRole("button", { name: /régénérer le jeton/i }).click();
    await page
      .getByRole("button", { name: /^régénérer le jeton$/i })
      .last()
      .click();

    await expect(page.getByLabel(/adresse du flux/i)).not.toHaveValue(new RegExp(before));
    const after = new URL(await page.getByLabel(/adresse du flux/i).inputValue()).pathname;

    const stale = await request.get(before);
    expect(stale.status()).toBe(200);
    // Un calendrier VIDE, pas une erreur : un 404 ferait de la route un oracle
    // permettant d'éprouver des jetons au hasard.
    expect(await stale.text()).not.toContain("BEGIN:VEVENT");

    const fresh = await request.get(after);
    expect(await fresh.text()).toContain("NOTIF-E2E");
  });

  test("une adresse malformée rend un calendrier vide, sans erreur", async ({ request }) => {
    const response = await request.get("/api/calendar/pas-un-jeton");
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain("BEGIN:VEVENT");
  });
});

test.describe("accessibilité", () => {
  test("aucune violation axe sur le centre et sur le flux calendrier", async ({ page }) => {
    for (const path of ["/fr/notifications", "/fr/profile/calendar"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      expect(results.violations.map((violation) => `${path}: ${violation.id}`)).toEqual([]);
    }
  });
});
