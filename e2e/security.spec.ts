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
     -- ⚠️ LE PRÉDICAT EST OBLIGATOIRE DEPUIS LA MIGRATION 0018. L'unicité des
     -- occurrences est portée par DEUX index partiels : l'un pour les dossiers
     -- d'entreprise, l'autre pour ceux rattachés à un registre. PostgreSQL
     -- n'infère un index partiel que si la clause WHERE de l'instruction reprend
     -- son prédicat ; sans lui, l'insertion échoue sur « no unique or exclusion
     -- constraint matching the ON CONFLICT specification ».
     on conflict (entity_id, obligation_type_id, period_key)
       where commercial_register_id is null
       do nothing
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
  const fiscal = await createUser(USERS.fiscal, "RESPONSABLE", "FISCAL");
  const social = await createUser(USERS.social, "RESPONSABLE", "SOCIAL");
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

  test("une fiche INEXISTANTE et une fiche INTERDITE sont indiscernables", async ({ page }) => {
    /*
     * ⚠️ L'INDISCERNABILITÉ EST LA PROPRIÉTÉ, PAS LE CODE DE STATUT. Répondre
     * pareil dans les deux cas ne suffit pas si l'un répond plus vite, plus
     * court, ou avec un mot de plus : chacune de ces différences est un ORACLE.
     * On devine alors, identifiant par identifiant, quels dossiers existent dans
     * les domaines qu'on n'a pas le droit de voir — et la liste des obligations
     * d'une entreprise en dit long sur ses ennuis.
     *
     * On compare donc les deux réponses terme à terme : même statut, même corps.
     */
    await signIn(page, USERS.social);

    const inexistante = await page.request.get(
      "/fr/echeancier/00000000-0000-0000-0000-000000000000",
      { failOnStatusCode: false },
    );
    const interdite = await page.request.get(`/fr/echeancier/${occurrenceId}`, {
      failOnStatusCode: false,
    });

    expect(interdite.status()).toBe(inexistante.status());

    /*
     * ⚠️ ON COMPARE CE QUI SE LIT, PAS L'OCTET. Le flux HTML de Next porte deux
     * sortes de bruit qui varient d'un appel à l'autre SANS rien dire de la
     * ressource : le nonce de la politique de sécurité, tiré au sort à chaque
     * réponse, et l'échafaudage de streaming — selon l'instant où les métadonnées
     * se résolvent, un même écran arrive d'un bloc ou en deux morceaux recollés
     * par un `<template>`. Mesuré : deux appels à la MÊME adresse diffèrent déjà
     * par là.
     *
     * Comparer les octets bruts reviendrait donc à éprouver l'ordonnanceur de
     * Next. On retient le TEXTE RENDU : c'est ce qu'un humain lit, c'est ce qu'un
     * moteur d'indexation garde, et c'est le seul endroit où une différence
     * apprendrait quelque chose à qui devine des identifiants.
     */
    const lisible = (corps: string): string =>
      corps
        .replaceAll(/<script[\s\S]*?<\/script>/g, " ")
        .replaceAll(/<style[\s\S]*?<\/style>/g, " ")
        .replaceAll(/<[^>]+>/g, " ")
        /*
         * ⚠️ L'IDENTIFIANT DEMANDÉ EST NEUTRALISÉ, et lui seul. Le fil d'Ariane le
         * répète — « Échéancier / ee9f5ec4… » — et les deux réponses diffèrent
         * donc par là. Ce n'est PAS un oracle : celui qui devine un identifiant
         * le connaît déjà, puisqu'il vient de le taper. Ce qui serait un oracle,
         * c'est tout le reste — un mot, un libellé, une section de plus d'un côté
         * que de l'autre. C'est ce que la comparaison retient.
         */
        .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
        .replaceAll(/\s+/g, " ")
        .trim();

    expect(lisible(await interdite.text())).toBe(lisible(await inexistante.text()));
  });

  test("l'écran rendu est bien celui d'une ressource introuvable", async ({ page }) => {
    /*
     * ⚠️ LE STATUT RESTE 200, ET C'EST UN COMPORTEMENT DE NEXT, PAS UN OUBLI.
     *
     * `notFound()` ne fixe le code de réponse que s'il est lancé AVANT que le
     * rendu n'ait commencé à s'écrire. L'attrape-tout de la zone authentifiée
     * (`(app)/[...rest]/page.tsx`) y parvient : c'est un composant SYNCHRONE, il
     * lève avant tout. Une fiche, elle, doit d'abord lire la session puis la base
     * pour savoir si la ressource existe et si l'appelant y a droit — et sur une
     * route rendue dynamiquement, ces attentes suffisent à engager la réponse.
     * Vérifié : la suppression des `loading.tsx` du segment ET de son parent n'y
     * change rien, et il n'existe aucune autre frontière de suspension dans la
     * coquille.
     *
     * Ce que cela coûte est réel mais borné — un moteur d'indexation garde la
     * page, une sonde de supervision ne voit pas l'incident. Ce que cela ne coûte
     * PAS : la confidentialité. Les deux cas répondent à l'identique, c'est ce que
     * vérifie le test précédent, et aucun oracle n'en sort.
     *
     * Le rendre étanche demanderait de porter le contrôle dans le middleware,
     * avec une lecture de base par requête : la décision appartient au projet.
     */
    await signIn(page, USERS.social);

    const reponse = await page.request.get(`/fr/echeancier/${occurrenceId}`, {
      failOnStatusCode: false,
    });

    const corps = await reponse.text();
    expect(corps).toContain("introuvable");
    // Et surtout : jamais le contenu du dossier, ni un mot qui en confirme l'existence.
    expect(corps).not.toContain("accès refusé");
    expect(corps).not.toContain("interdit");
  });

  test("une fiche inexistante et une fiche interdite répondent en un temps COMPARABLE", async ({
    page,
  }) => {
    await signIn(page, USERS.social);

    /*
     * ⚠️ UN ÉCART DE TEMPS EST UN ORACLE, au même titre qu'un écart de corps. Si
     * la fiche interdite coûtait systématiquement une lecture de plus, la mesure
     * la trahirait sans qu'aucun octet ne diffère.
     *
     * On mesure plusieurs fois et l'on compare les MINIMUMS : la moyenne est
     * polluée par l'ordonnanceur de la machine, le minimum ne l'est pas. La
     * tolérance est large — on cherche un écart STRUCTUREL, pas une signature
     * temporelle au millimètre, et un test trop serré clignoterait sans rien
     * apprendre.
     */
    const mesurer = async (url: string): Promise<number> => {
      let minimum = Number.POSITIVE_INFINITY;
      for (let essai = 0; essai < 5; essai += 1) {
        const debut = Date.now();
        await page.request.get(url, { failOnStatusCode: false });
        minimum = Math.min(minimum, Date.now() - debut);
      }
      return minimum;
    };

    const inexistante = await mesurer("/fr/echeancier/00000000-0000-0000-0000-000000000000");
    const interdite = await mesurer(`/fr/echeancier/${occurrenceId}`);

    const ecart = Math.abs(interdite - inexistante);
    const reference = Math.max(inexistante, interdite, 1);
    expect(ecart / reference).toBeLessThan(0.5);
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
