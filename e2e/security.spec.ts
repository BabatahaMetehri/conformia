import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * DURCISSEMENT — ce que la plateforme oppose à qui frappe directement.
 *
 * ⚠️ Trois garanties distinctes, et aucune ne se déduit des autres :
 *
 *   1. Les EN-TÊTES sont ceux annoncés. Une politique affaiblie ne se voit nulle
 *      part dans l'interface : elle ne devient visible que le jour où elle
 *      aurait dû arrêter quelque chose.
 *
 *   2. La politique ne CASSE RIEN en silence. Une CSP qui refuse un style
 *      n'affiche aucune erreur — elle affiche un écran faux. C'est arrivé : la
 *      barre de complétude d'un dossier vide s'affichait pleine, parce que
 *      l'attribut `style` rendu par le serveur était refusé. D'où le relevé des
 *      violations, écran par écran.
 *
 *   3. Les ROUTES HANDLER se défendent seules. Elles ne passent par aucun écran,
 *      donc par aucune garde d'affichage : sans session, avec une session
 *      insuffisante, avec la bonne — les trois cas se vérifient ici.
 */

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const PASSWORD = "conformia-securite-2026";
const USERS = {
  fiscal: "sec.fiscal@e2e.test.dz",
  social: "sec.social@e2e.test.dz",
} as const;

const OBLIGATION = "5d5d5d5d-0000-0000-0000-0000000000f1";
const BUCKET = "compliance-documents";

const pool = new Pool({ connectionString: DB_URL, max: 3 });
const ids: Record<string, string> = {};
let occurrenceId = "";
let documentId = "";
let ready = false;

interface Violation {
  readonly directive: string;
  readonly blocked: string;
  readonly sample: string;
}

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
  if (created.ok) id = ((await created.json()) as { id?: string }).id ?? null;
  else if (created.status === 422) {
    const found = await pool.query<{ id: string }>("select id from auth.users where email = $1", [
      email,
    ]);
    id = found.rows[0]?.id ?? null;
  }
  if (id === null) return null;

  await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, d.id from public.roles r, public.domains d
      where r.code = $2 and d.code = $3 on conflict do nothing`,
    [id, role, domain],
  );
  await pool.query("update public.profiles set full_name = $2 where id = $1", [id, email]);
  return id;
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

/** Arme le relevé AVANT tout script de page : une violation manquée ne revient pas. */
async function collectViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store: Violation[] = [];
    (window as unknown as { __csp: Violation[] }).__csp = store;
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      });
    });
  });
}

async function violationsOf(page: Page): Promise<readonly Violation[]> {
  return page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp);
}

/**
 * Un dossier FISCAL avec une pièce obligatoire NON déposée, et une pièce
 * déposée hors liste.
 *
 * ⚠️ Ce jeu d'essai est celui du fichier, jamais celui d'un autre. S'appuyer sur
 * les données laissées par une autre spécification rendrait ces vérifications
 * dépendantes de l'ordre d'exécution — et muettes le jour où elles tourneraient
 * seules.
 */
async function seedFixture(): Promise<boolean> {
  await pool.query(
    `insert into public.obligation_types
       (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality,
        validation_levels, requires_validation)
     values ($1, 'SEC-F', 'Durcissement fiscal', 'MONTHLY',
             '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
             (select id from public.domains where code = 'FISCAL'), 'HIGH', 1, true)
     on conflict (id) do nothing`,
    [OBLIGATION],
  );
  await pool.query(
    `insert into public.obligation_required_documents
       (obligation_type_id, label, is_mandatory, document_kind, order_index)
     select $1, 'Bordereau', true, 'JUSTIFICATIF', 0
      where not exists (select 1 from public.obligation_required_documents
                         where obligation_type_id = $1)`,
    [OBLIGATION],
  );

  const inserted = await pool.query<{ id: string }>(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id, validator_id)
     values ($1, '2026-07', '2026-07-01', '2026-07-31', current_date + 20, current_date + 13,
             'IN_PROGRESS', $2, $2)
     on conflict (entity_id, obligation_type_id, period_key) do nothing
     returning id`,
    [OBLIGATION, ids["fiscal"] ?? ""],
  );

  occurrenceId =
    inserted.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        "select id from public.obligation_occurrences where obligation_type_id = $1 limit 1",
        [OBLIGATION],
      )
    ).rows[0]?.id ??
    "";
  if (occurrenceId.length === 0) return false;

  await pool.query(
    `insert into public.occurrence_checklist_items
       (occurrence_id, required_document_id, label, is_mandatory, document_kind, order_index)
     select $1, rd.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
       from public.obligation_required_documents rd
      where rd.obligation_type_id = $2
        and not exists (select 1 from public.occurrence_checklist_items
                         where occurrence_id = $1)`,
    [occurrenceId, OBLIGATION],
  );

  /*
   * La pièce est rattachée à AUCUNE ligne de la liste : le dossier reste donc
   * « 0 sur 1 » — ce que la jauge doit montrer — tout en offrant un document
   * réel aux vérifications de téléchargement.
   */
  const document = await pool.query<{ id: string }>(
    `insert into public.documents
       (occurrence_id, checklist_item_id, storage_path, original_filename, normalized_filename,
        mime_type, size_bytes, sha256, document_kind, uploaded_by)
     select $1::uuid, null, 'securite/' || $1 || '.pdf', 'piece.pdf', 'SEC_v1.pdf',
            'application/pdf', 1024, repeat('c', 64), 'ANNEXE', $2::uuid
      where not exists (select 1 from public.documents where occurrence_id = $1::uuid)
     returning id`,
    [occurrenceId, ids["fiscal"] ?? ""],
  );
  /*
   * ⚠️ L'OBJET EST RÉELLEMENT DÉPOSÉ DANS LE STOCKAGE. Une ligne `documents`
   * sans octets derrière suffit aux vérifications de refus, mais pas à celle du
   * cas nominal : le service ne peut signer une URL vers un objet qui n'existe
   * pas, et rend alors 502 — ce qui ferait passer le test d'accès autorisé pour
   * un test d'accès refusé.
   */
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/securite/${occurrenceId}.pdf`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    },
    body: Buffer.from("%PDF-1.7\n% securite\n"),
  });

  documentId =
    document.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        "select id from public.documents where occurrence_id = $1 limit 1",
        [occurrenceId],
      )
    ).rows[0]?.id ??
    "";

  return documentId.length > 0;
}

test.beforeAll(async () => {
  if (SERVICE_KEY.length === 0) return;
  const fiscal = await createUser(USERS.fiscal, "COMPTA_AGENT", "FISCAL");
  const social = await createUser(USERS.social, "RH_AGENT", "SOCIAL");
  if (fiscal === null || social === null) return;
  ids["fiscal"] = fiscal;
  ids["social"] = social;
  ready = await seedFixture();
});

test.afterAll(async () => {
  const client = await pool.connect();
  try {
    const inScope = `select id from public.obligation_occurrences where obligation_type_id = '${OBLIGATION}'`;
    await client.query(
      "alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only",
    );
    for (const table of [
      "notifications",
      "occurrence_transitions",
      "document_upload_tickets",
      "documents",
      "occurrence_comments",
      "occurrence_checklist_items",
    ]) {
      await client.query(`delete from public.${table} where occurrence_id in (${inScope})`);
    }
    await client.query("delete from public.obligation_occurrences where obligation_type_id = $1", [
      OBLIGATION,
    ]);
    await client.query(
      "delete from public.obligation_required_documents where obligation_type_id = $1",
      [OBLIGATION],
    );
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

test.beforeEach(() => {
  test.skip(!ready, "Jeu d'essai indisponible : SUPABASE_SERVICE_ROLE_KEY absente ?");
});

// ═════════════════════════════════════════════════════════════════════════════

test.describe("en-têtes de sécurité", () => {
  test("la réponse porte la politique annoncée", async ({ request }) => {
    const response = await request.get("/fr/login");
    const csp = response.headers()["content-security-policy"] ?? "";

    // Le nonce est ce qui rend `script-src` utile : sans lui, `'self'` laisserait
    // passer tout script servi depuis l'origine, injecté compris.
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp).toContain("'strict-dynamic'");
    // Et surtout : AUCUNE tolérance en ligne côté script.
    expect(csp.match(/script-src [^;]*/)?.[0] ?? "").not.toContain("'unsafe-inline'");

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");

    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers()["strict-transport-security"]).toContain("max-age=");
  });

  test("le nonce CHANGE à chaque réponse", async ({ request }) => {
    // Un nonce constant est un nonce inutile : il redevient une liste blanche
    // qu'un attaquant peut lire dans une page et réutiliser dans la suivante.
    const first = await request.get("/fr/login");
    const second = await request.get("/fr/login");
    const nonceOf = (value: string): string => /'nonce-([^']+)'/.exec(value)?.[1] ?? "";

    const one = nonceOf(first.headers()["content-security-policy"] ?? "");
    const two = nonceOf(second.headers()["content-security-policy"] ?? "");
    expect(one.length).toBeGreaterThan(10);
    expect(one).not.toBe(two);
  });
});

test.describe("la politique ne casse rien", () => {
  test("aucune violation CSP sur les écrans de travail", async ({ page }) => {
    await collectViolations(page);
    await signIn(page, USERS.fiscal);

    for (const path of ["/fr/echeancier", "/fr/documents", "/fr/referentiel", "/fr/mes-taches"]) {
      await page.goto(path);
      await page.waitForTimeout(1500);
    }

    const violations = await violationsOf(page);
    const report = violations
      .map((violation) => `${violation.directive} ← ${violation.blocked} ${violation.sample}`)
      .join("\n");

    expect(violations, `Violations relevées :\n${report}`).toEqual([]);
  });

  test("une jauge à zéro s'affiche VIDE", async ({ page }) => {
    /*
     * ⚠️ Le test qui aurait attrapé le défaut. Une barre de progression tire sa
     * valeur d'un attribut `style` rendu par le serveur ; refusée par la
     * politique, elle retombe sur sa largeur pleine et annonce « complet ».
     * On mesure donc la GÉOMÉTRIE, pas la présence de l'élément.
     */
    await signIn(page, USERS.fiscal);
    await page.goto(`/fr/echeancier/${occurrenceId}`);
    await expect(page.getByText(/Complétude du dossier/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/0 sur 1/)).toBeVisible();

    const geometry = await page.evaluate(() => {
      const indicator = document.querySelector('[data-slot="progress-indicator"]');
      if (indicator === null) return null;
      return {
        attribute: indicator.getAttribute("style") ?? "",
        transform: window.getComputedStyle(indicator).transform,
      };
    });

    expect(geometry).not.toBeNull();
    if (geometry === null) return;

    // L'attribut demande le décalage complet…
    expect(geometry.attribute).toContain("translateX(-100%)");
    // …et la valeur CALCULÉE doit le porter. `none` signifierait « refusé », et
    // la jauge annoncerait « complet » sur un dossier vide.
    expect(geometry.transform).not.toBe("none");
  });
});

test.describe("routes handler : trois situations, trois réponses", () => {
  test("sans session, le téléchargement d'une pièce est refusé", async ({ page }) => {
    await page.context().clearCookies();
    const response = await page.request.get(`/api/documents/${documentId}/download`, {
      maxRedirects: 0,
    });

    // Jamais 302 : une redirection ici signifierait une URL signée délivrée.
    expect([401, 403, 404]).toContain(response.status());
  });

  test("avec une session d'un AUTRE domaine, le téléchargement est refusé", async ({ page }) => {
    await signIn(page, USERS.social);
    const response = await page.request.get(`/api/documents/${documentId}/download`, {
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(response.status());
  });

  test("avec la BONNE session, le téléchargement rend une URL SIGNÉE", async ({ page }) => {
    /*
     * ⚠️ Le troisième cas, celui qu'on oublie : une garde qui refuse tout est
     * aussi fausse qu'une garde qui laisse tout passer. Et la redirection doit
     * pointer une URL signée — jamais un chemin de stockage en clair.
     */
    await signIn(page, USERS.fiscal);
    const response = await page.request.get(`/api/documents/${documentId}/download`, {
      maxRedirects: 0,
    });

    expect([302, 307]).toContain(response.status());
    const location = response.headers()["location"] ?? "";
    expect(location).toContain("/storage/v1/object/sign/");
    expect(location).toContain("token=");
  });

  test("l'export d'un dossier invisible rend « introuvable », jamais « interdit »", async ({
    page,
  }) => {
    await signIn(page, USERS.social);
    const response = await page.request.get(`/api/exports/dossier/${occurrenceId}`, {
      maxRedirects: 0,
    });

    // ⚠️ 404 et non 403 : distinguer les deux dirait au demandeur que le dossier
    // existe, et permettrait d'énumérer les dossiers des autres domaines.
    expect(response.status()).toBe(404);
  });

  test("le déclencheur de génération refuse un secret erroné", async ({ request }) => {
    const response = await request.post("/api/cron/generate", {
      headers: { authorization: "Bearer manifestement-faux" },
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(response.status());
  });

  test("le flux de calendrier répond à l'identique sur un jeton inconnu", async ({ request }) => {
    /*
     * ⚠️ Un jeton inconnu ne doit pas se distinguer d'un jeton valide dont le
     * calendrier est vide : l'écart de réponse transformerait cette URL en
     * oracle permettant de deviner un jeton par essais.
     */
    const response = await request.get(
      "/api/calendar/00000000000000000000000000000000000000000000",
      { failOnStatusCode: false },
    );
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
  });
});
