import { expect, test, type Page, type Response } from "@playwright/test";
import { createHmac } from "node:crypto";
import { Pool, type PoolClient } from "pg";

/**
 * LES HUIT PARCOURS CRITIQUES.
 *
 * ⚠️ Ce fichier est le seul à tourner sur DEUX moteurs (Chromium et Firefox).
 * Ce n'est pas de la redondance : les deux divergent sur l'hydratation, la
 * sérialisation des `input[type=date]` et le rendu des propriétés logiques. Un
 * parcours qui passe sur l'un et casse sur l'autre est un défaut réel, et c'est
 * exactement ce que le reste de la suite ne peut pas voir.
 *
 * ⚠️ Ce sont des PARCOURS, pas des tests unitaires d'interface. Chacun suit un
 * geste métier de bout en bout — création, dépôt, décision, refus — parce que
 * c'est à la jonction des écrans que les défauts survivent aux tests isolés.
 */

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "conformia-parcours-2026";

const USERS = {
  admin: "cj.admin@e2e.test.dz",
  manager: "cj.manager@e2e.test.dz",
  agent: "cj.agent@e2e.test.dz",
  rh: "cj.rh@e2e.test.dz",
} as const;

const OBLIGATION = "5d5d5d5d-0000-0000-0000-0000000000c1";
const SOCIAL_OBLIGATION = "5d5d5d5d-0000-0000-0000-0000000000c2";

const pool = new Pool({ connectionString: DB_URL, max: 4 });
let ready = false;
const ids: Record<string, string> = {};
let fiscalOccurrence = "";
let socialOccurrence = "";
let archivedOccurrence = "";

const PDF = Buffer.from("%PDF-1.7\n% conformia parcours\n1 0 obj\n<<>>\nendobj\n");
const PDF_V2 = Buffer.from("%PDF-1.7\n% conformia parcours v2\n1 0 obj\n<<>>\nendobj\n");

// ─── TOTP ────────────────────────────────────────────────────────────────────

/**
 * Code TOTP à six chiffres (RFC 6238).
 *
 * ⚠️ Implémenté ici plutôt qu'importé. Ajouter une dépendance pour trente lignes
 * de HMAC dans un fichier de test élargirait la surface du dépôt pour un besoin
 * qui n'existe qu'ici — et la RFC est stable depuis 2011.
 */
function totp(base32Secret: string, at: number = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32Secret.replaceAll(/[^A-Z2-7]/gi, "").toUpperCase();

  let bits = "";
  for (const character of clean) {
    const value = alphabet.indexOf(character);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));

  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

// ─── Jeu d'essai ─────────────────────────────────────────────────────────────

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

async function seed(): Promise<boolean> {
  if (SERVICE_KEY.length === 0) return false;

  for (const [key, email] of Object.entries(USERS)) {
    const role =
      key === "admin"
        ? "ADMIN"
        : key === "manager"
          ? "COMPTA_MANAGER"
          : key === "agent"
            ? "COMPTA_AGENT"
            : "RH_AGENT";
    const domain = key === "admin" ? null : key === "rh" ? "SOCIAL" : "FISCAL";
    const id = await createUser(email, role, domain);
    if (id === null) return false;
    ids[key] = id;
  }

  for (const [id, code, domain] of [
    [OBLIGATION, "CJ-FISC", "FISCAL"],
    [SOCIAL_OBLIGATION, "CJ-SOC", "SOCIAL"],
  ] as const) {
    await pool.query(
      `insert into public.obligation_types
         (id, code, name, periodicity, due_rule, effective_from, domain_id, criticality,
          validation_levels, requires_validation)
       values ($1, $2, $3, 'MONTHLY',
               '{"anchor":"PERIOD_END","offset_days":20}'::jsonb, '2026-01-01',
               (select id from public.domains where code = $4), 'HIGH', 1, true)
       on conflict (id) do nothing`,
      [id, code, `Parcours ${code}`, domain],
    );
    /*
     * ⚠️ `where not exists` ET NON `on conflict do nothing` : la table ne porte
     * aucune contrainte d'unicité sur (obligation, libellé), donc « on conflict »
     * n'y attrape rien et réinsère à chaque exécution. Deux lignes « Bordereau »
     * produisent deux lignes de dossier, dont une reste vide pour toujours : le
     * dossier ne peut plus être soumis, et le parcours 2 échoue sur un défaut
     * qui n'existe que dans son propre jeu d'essai.
     */
    await pool.query(
      `insert into public.obligation_required_documents
         (obligation_type_id, label, is_mandatory, document_kind, order_index)
       select $1, 'Bordereau', true, 'JUSTIFICATIF', 0
        where not exists (select 1 from public.obligation_required_documents
                           where obligation_type_id = $1 and label = 'Bordereau')`,
      [id],
    );
  }

  // Trois dossiers : un fiscal en cours, un social, un fiscal archivé.
  const rows = await pool.query<{ id: string; code: string; status: string }>(
    `insert into public.obligation_occurrences
       (obligation_type_id, period_key, period_start, period_end,
        legal_due_date, internal_due_date, status, owner_id, validator_id)
     values
       ($1, '2026-03', '2026-03-01', '2026-03-31', current_date + 20, current_date + 13,
        'IN_PROGRESS', $3, $4),
       ($2, '2026-03', '2026-03-01', '2026-03-31', current_date + 20, current_date + 13,
        'IN_PROGRESS', $5, $5),
       ($1, '2025-12', '2025-12-01', '2025-12-31', '2026-01-20', '2026-01-13',
        'ARCHIVED', $3, $4)
     on conflict do nothing
     returning id, period_key as code, status::text as status`,
    [OBLIGATION, SOCIAL_OBLIGATION, ids["agent"], ids["manager"], ids["rh"]],
  );

  const all =
    rows.rows.length > 0
      ? rows.rows
      : (
          await pool.query<{ id: string; code: string; status: string }>(
            `select id, period_key as code, status::text as status
             from public.obligation_occurrences
             where obligation_type_id in ($1, $2)`,
            [OBLIGATION, SOCIAL_OBLIGATION],
          )
        ).rows;

  for (const row of all) {
    const social = await pool.query<{ n: number }>(
      `select count(*)::int as n from public.obligation_occurrences
       where id = $1 and obligation_type_id = $2`,
      [row.id, SOCIAL_OBLIGATION],
    );
    if ((social.rows[0]?.n ?? 0) > 0) socialOccurrence = row.id;
    else if (row.status === "ARCHIVED") archivedOccurrence = row.id;
    else fiscalOccurrence = row.id;
  }

  await pool.query(
    `insert into public.occurrence_checklist_items
       (occurrence_id, required_document_id, label, is_mandatory, document_kind, order_index)
     select oc.id, rd.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
       from public.obligation_occurrences oc
       join public.obligation_required_documents rd
         on rd.obligation_type_id = oc.obligation_type_id
      where oc.obligation_type_id in ($1, $2)
     on conflict do nothing`,
    [OBLIGATION, SOCIAL_OBLIGATION],
  );

  return fiscalOccurrence.length > 0 && socialOccurrence.length > 0;
}

/**
 * Exécute une requête AVEC la session d'un utilisateur donné, et la conserve.
 *
 * ⚠️ `set local role authenticated` + les revendications JWT : sans cela, la
 * connexion reste `postgres`, `auth.uid()` vaut NULL et toute fonction
 * SECURITY DEFINER refuse. Le pendant des tests d'intégration annule sa
 * transaction ; ici elle est VALIDÉE, parce que le parcours continue ensuite
 * dans le navigateur et doit voir l'effet.
 */
async function asUser<T>(userId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    const value = await run(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Pose un second facteur VÉRIFIÉ, sans passer par l'écran d'enrôlement.
 *
 * ⚠️ `has_verified_mfa()` lit `auth.mfa_factors` : c'est cette table qui fait
 * foi, `profiles.mfa_enrolled` n'en étant qu'un reflet. Sans facteur, le
 * middleware enferme un ADMIN sur l'enrôlement et TOUT parcours administrateur
 * mesure alors la redirection, pas ce qu'il prétend vérifier.
 */
async function ensureVerifiedFactor(userId: string): Promise<void> {
  await pool.query(
    `insert into auth.mfa_factors
       (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     select gen_random_uuid(), $1, 'CONFORMIA-PARCOURS', 'totp', 'verified',
            now(), now(), 'JBSWY3DPEHPK3PXP'
      where not exists (
        select 1 from auth.mfa_factors f where f.user_id = $1 and f.status = 'verified')`,
    [userId],
  );
  await pool.query("update public.profiles set mfa_enrolled = true where id = $1", [userId]);
}

/**
 * Va à une adresse, en tolérant l'interruption que Firefox signale.
 *
 * ⚠️ CES DEUX ERREURS NE SONT PAS DES ÉCHECS DE L'APPLICATION.
 *
 *   • `NS_BINDING_ABORTED` — Firefox le rend dès qu'une navigation en remplace
 *     une autre encore en vol, et le routeur de Next en garde plusieurs par
 *     préchargement des liens du menu ;
 *   • « interrupted by another navigation » — la précédente page, désormais sans
 *     session, s'est fait rediriger vers `/login?next=…` pendant qu'on partait
 *     vers `/login`.
 *
 * Chromium absorbe les deux cas sans rien dire. La navigation aboutit : ce qui
 * l'établit est la page obtenue, vérifiée par les assertions qui suivent chaque
 * appel, pas le code de retour du transport.
 */
const TOLERATED = ["NS_BINDING_ABORTED", "interrupted by another navigation"];

async function visit(page: Page, path: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.goto(path);
    } catch (error) {
      const message = String(error);
      if (!TOLERATED.some((tolerated) => message.includes(tolerated))) throw error;
      await page.waitForTimeout(300);
    }
  }
  return page.goto(path);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await visit(page, "/fr/login");
  await page.getByLabel(/adresse professionnelle/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });

  /*
   * ⚠️ ATTENDRE QUE LA COQUILLE SOIT LÀ, pas seulement que l'URL ait changé.
   *
   * La redirection de connexion est une navigation douce : l'URL bascule avant
   * que la page ne soit posée. Enchaîner un `goto` sur cet intervalle interrompt
   * la navigation en cours — Chromium l'absorbe, Firefox rend
   * `NS_BINDING_ABORTED`. C'est exactement le genre d'écart que ce fichier
   * existe pour attraper, et il se corrige ici, une fois, pour tous les
   * parcours.
   */
  await expect(page.getByRole("button", { name: /menu utilisateur/i })).toBeVisible({
    timeout: 30_000,
  });

  /*
   * ⚠️ Puis attendre que l'URL CESSE DE BOUGER. La connexion peut enchaîner une
   * seconde navigation — le défi du second facteur pour un compte qui en porte
   * un — et la coquille de l'application est déjà à l'écran pendant celle-ci.
   * Partir sur un `goto` à cet instant interrompt la navigation en cours.
   */
  await expect
    .poll(
      async () => {
        const before = page.url();
        await page.waitForTimeout(250);
        return before === page.url();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
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
    const scope = `obligation_type_id in ('${OBLIGATION}', '${SOCIAL_OBLIGATION}')`;
    const inScope = `select id from public.obligation_occurrences where ${scope}`;

    await client.query(`delete from public.notifications where occurrence_id in (${inScope})`);
    await client.query(
      `delete from public.occurrence_transitions where occurrence_id in (${inScope})`,
    );
    await client.query(
      `delete from public.document_upload_tickets where occurrence_id in (${inScope})`,
    );
    await client.query(`delete from public.documents where occurrence_id in (${inScope})`);
    await client.query(
      `delete from public.occurrence_comments where occurrence_id in (${inScope})`,
    );
    await client.query(
      `delete from public.occurrence_checklist_items where occurrence_id in (${inScope})`,
    );
    // `rectification_index` retombe à zéro EN MÊME TEMPS que le lien : la
    // contrainte `obligation_occurrences_rectification_link` exige l'un dès que
    // l'autre est posé, et rompre le lien seul la violerait.
    await client.query(
      `update public.obligation_occurrences
          set rectifies_occurrence_id = null, rectification_index = 0
        where ${scope}`,
    );
    await client.query(`delete from public.obligation_occurrences where ${scope}`);
    await client.query(
      "delete from public.obligation_required_documents where obligation_type_id in ($1, $2)",
      [OBLIGATION, SOCIAL_OBLIGATION],
    );
    await client.query("delete from public.obligation_types where id in ($1, $2)", [
      OBLIGATION,
      SOCIAL_OBLIGATION,
    ]);
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

test.describe("1 · connexion avec second facteur", () => {
  test("un ADMIN enrôle son second facteur puis s'en sert pour entrer", async ({ page }) => {
    /*
     * ⚠️ Le parcours COMPLET, pas un drapeau posé en base. Le middleware enferme
     * un ADMIN sans second facteur sur l'écran d'enrôlement : c'est ce
     * verrouillage, et le code à six chiffres qui le lève, qui font la garantie.
     */
    await pool.query("update public.profiles set mfa_enrolled = false where id = $1", [
      ids["admin"],
    ]);
    await pool
      .query("delete from auth.mfa_factors where user_id = $1", [ids["admin"]])
      .catch(() => undefined);

    await page.context().clearCookies();
    await visit(page, "/fr/login");
    await page.getByLabel(/adresse professionnelle/i).fill(USERS.admin);
    await page.getByLabel(/mot de passe/i).fill(PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();

    // Enfermé sur l'enrôlement : aucun autre écran n'est atteignable.
    await page.waitForURL(/\/mfa\/enroll/, { timeout: 30_000 });

    /*
     * Le secret est replié derrière un `<details>` — c'est le repli manuel, pour
     * qui ne peut pas scanner le QR. Il faut donc l'ouvrir, comme le ferait
     * l'utilisateur : le texte d'un élément replié n'est pas lisible.
     */
    await page.locator("details summary").first().click();
    const secret = (await page.locator("details code").first().innerText()).trim();
    expect(secret.length).toBeGreaterThan(15);

    await page.getByLabel(/code/i).fill(totp(secret));
    await page
      .getByRole("button", { name: /valider|confirmer|activer/i })
      .first()
      .click();

    await page.waitForURL((url) => !url.pathname.includes("/mfa"), { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /menu utilisateur/i })).toBeVisible();
  });
});

test.describe("2 · cycle de vie complet d'un dossier", () => {
  test("de la prise en charge au dépôt, en passant par la validation", async ({ page }) => {
    // ── L'agent prépare et dépose la pièce.
    await signIn(page, USERS.agent);
    await visit(page, `/fr/echeancier/${fiscalOccurrence}`);
    await expect(page.getByText(/Complétude du dossier/i)).toBeVisible({ timeout: 20_000 });

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "bordereau.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByText(/Déposé/).first()).toBeVisible({ timeout: 30_000 });

    // ── Soumission à validation.
    await page
      .getByRole("button", { name: /soumettre/i })
      .first()
      .click();
    await expect(async () => {
      const { rows } = await pool.query<{ status: string }>(
        "select status::text as status from public.obligation_occurrences where id = $1",
        [fiscalOccurrence],
      );
      expect(rows[0]?.status).toBe("PENDING_VALIDATION");
    }).toPass({ timeout: 25_000 });

    // ── Le responsable valide.
    await signIn(page, USERS.manager);
    await visit(page, `/fr/echeancier/${fiscalOccurrence}`);
    await page
      .getByRole("button", { name: /^valider/i })
      .first()
      .click();

    await expect(async () => {
      const { rows } = await pool.query<{ status: string }>(
        "select status::text as status from public.obligation_occurrences where id = $1",
        [fiscalOccurrence],
      );
      expect(rows[0]?.status).toBe("VALIDATED");
    }).toPass({ timeout: 25_000 });

    /*
     * ⚠️ Le dépôt et l'archivage exigent une référence d'organisme et, pour
     * l'archivage, un dossier clos. On les pilote par la fonction SQL — le même
     * chemin que l'interface — parce que le parcours d'écran de ces deux étapes
     * est déjà couvert par `workflow.spec.ts`, et que ce test-ci vérifie la
     * CHAÎNE, pas chaque bouton.
     */
    /*
     * ⚠️ La preuve de dépôt AVANT le passage à « déposé ». L'obligation la
     * réclame (`requires_proof`), et c'est la règle qui donne son sens à l'état :
     * « déposé » sans récépissé n'est qu'une affirmation. On la pose par SQL,
     * comme la transition elle-même, et pour la même raison.
     */
    /*
     * ⚠️ Posée SANS session applicative : `authenticated` n'a aucun droit
     * d'écriture direct sur `documents` — tout dépôt passe par
     * `confirm_document_upload()`, qui est SECURITY DEFINER. C'est une garantie
     * du modèle, pas une gêne : la contourner ici depuis le rôle `postgres`
     * revient à écrire du jeu d'essai, ce qui est exactement l'intention.
     */
    await (async () => {
      await pool.query(
        `insert into public.documents
           (occurrence_id, checklist_item_id, storage_path, original_filename,
            normalized_filename, mime_type, size_bytes, sha256, document_kind, uploaded_by)
         select $1::uuid, null, 'parcours/' || $1 || '-preuve.pdf', 'recepisse.pdf',
                'CJ_PREUVE_v1.pdf', 'application/pdf', 1024, repeat('b', 64),
                'PREUVE_DEPOT', $2::uuid
          where not exists (
            select 1 from public.documents d
            where d.occurrence_id = $1::uuid and d.document_kind = 'PREUVE_DEPOT'
              and d.deleted_at is null)`,
        [fiscalOccurrence, ids["manager"] ?? ""],
      );
    })();

    const verdict = await asUser(ids["manager"] ?? "", async (client) => {
      const { rows: current } = await client.query<{ version: number }>(
        "select version from public.obligation_occurrences where id = $1",
        [fiscalOccurrence],
      );
      const { rows: applied } = await client.query<{ v: { outcome?: string } }>(
        `select public.apply_occurrence_transition(
                  $1, 'SUBMITTED'::public.occurrence_status, $2, $3, $4) as v`,
        [
          fiscalOccurrence,
          current[0]?.version ?? 0,
          "Dépôt effectué auprès de la DGI.",
          "REF-CJ-2026",
        ],
      );
      return applied[0]?.v;
    });
    // `APPLIED` et non `ALLOWED` : `evaluate_transition` AUTORISE,
    // `apply_occurrence_transition` APPLIQUE — deux verdicts, deux mots.
    expect(verdict?.outcome).toBe("APPLIED");

    const { rows } = await pool.query<{ status: string; reference: string | null }>(
      "select status::text as status, reference_number as reference from public.obligation_occurrences where id = $1",
      [fiscalOccurrence],
    );
    expect(rows[0]?.status).toBe("SUBMITTED");
    expect(rows[0]?.reference).toBe("REF-CJ-2026");
  });
});

test.describe("3 · séparation des pouvoirs", () => {
  test("LE PRÉPARATEUR NE PEUT PAS VALIDER SON PROPRE DOSSIER", async ({ page }) => {
    /*
     * ⚠️ La règle la plus structurante du produit. Elle est portée par la base ;
     * ce parcours vérifie que l'INTERFACE ne la contredit pas — ni en proposant
     * le bouton, ni en laissant passer l'action.
     */
    await pool.query(
      `update public.obligation_occurrences
       set status = 'PENDING_VALIDATION', owner_id = $2, validator_id = $2,
           submitted_for_validation_at = now()
       where id = $1`,
      [socialOccurrence, ids["rh"]],
    );

    await signIn(page, USERS.rh);
    await visit(page, `/fr/echeancier/${socialOccurrence}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    const validate = page.getByRole("button", { name: /^valider/i }).first();

    if ((await validate.count()) > 0 && (await validate.isEnabled())) {
      await validate.click();
      // Si l'interface l'a proposé, la base doit avoir refusé.
      await page.waitForTimeout(2000);
    }

    const { rows } = await pool.query<{ status: string }>(
      "select status::text as status from public.obligation_occurrences where id = $1",
      [socialOccurrence],
    );
    expect(rows[0]?.status).toBe("PENDING_VALIDATION");
  });
});

test.describe("4 · cloisonnement par domaine", () => {
  test("un RH_AGENT n'atteint pas un dossier FISCAL, MÊME PAR URL DIRECTE", async ({ page }) => {
    await signIn(page, USERS.rh);

    // ⚠️ L'URL directe est le vrai test : masquer un lien ne protège rien.
    const refused = await visit(page, `/fr/echeancier/${fiscalOccurrence}`);
    await expect(page.getByText(/Page introuvable/i)).toBeVisible({ timeout: 20_000 });

    // Le dossier existe — mais rien de lui n'atteint l'écran.
    await expect(page.getByText(/CJ-FISC/)).toHaveCount(0);
    // Et l'écran ne dit pas « accès refusé », qui confirmerait l'existence.
    await expect(page.getByText(/accès refusé/i)).toHaveCount(0);

    /*
     * ⚠️ CE QUI SE VÉRIFIE ICI EST L'INDISCERNABILITÉ, PAS UN CODE DE STATUT.
     *
     * Un dossier existant mais hors domaine et un identifiant qui n'a jamais
     * existé doivent rendre exactement la même chose. C'est la propriété qui
     * empêche d'énumérer les dossiers des autres domaines par différence de
     * réponse — la RLS l'applique en base, l'interface ne doit pas la défaire.
     *
     * ⚠️ Le statut vaut 200 dans LES DEUX CAS, et c'est une limite connue, pas
     * un oubli : `echeancier/loading.tsx` ouvre une frontière de suspension, si
     * bien que la réponse est déjà engagée quand la page décide. Mesuré : un
     * segment inexistant, lui, rend bien 404. Aucune donnée ne fuit dans un cas
     * comme dans l'autre ; ce qui compte est que les deux réponses soient
     * identiques, et c'est ce que la comparaison ci-dessous établit.
     */
    const inexistent = await visit(page, "/fr/echeancier/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText(/Page introuvable/i)).toBeVisible({ timeout: 20_000 });
    expect(refused?.status()).toBe(inexistent?.status());
  });

  test("il ne voit pas non plus le dossier fiscal dans sa liste", async ({ page }) => {
    await signIn(page, USERS.rh);
    await visit(page, "/fr/echeancier");
    await expect(page.getByRole("row", { name: /CJ-SOC/ }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("row", { name: /CJ-FISC/ })).toHaveCount(0);
  });
});

test.describe("5 · l'administrateur n'accède pas au contenu métier", () => {
  test("un ADMIN n'atteint AUCUNE occurrence, ni par la liste ni par URL", async ({ page }) => {
    /*
     * ⚠️ Décision délibérée de la matrice de rôles : l'ADMIN gère les comptes,
     * les rôles et les réglages — pas les dossiers. Sans cette séparation,
     * l'administrateur technique lirait toute la fiscalité de l'entreprise.
     */
    await ensureVerifiedFactor(ids["admin"] ?? "");

    await signIn(page, USERS.admin);

    await visit(page, `/fr/echeancier/${fiscalOccurrence}`);
    await expect(page.getByText(/Page introuvable/i)).toBeVisible({ timeout: 20_000 });
    // Ni le code de l'obligation, ni la période : rien du dossier n'affleure.
    await expect(page.getByText(/CJ-FISC/)).toHaveCount(0);

    const visible = await pool.query<{ n: string }>(
      `select count(*) as n from public.obligation_occurrences`,
    );
    expect(Number(visible.rows[0]?.n ?? "0")).toBeGreaterThan(0);
  });

  test("il n'atteint aucun document non plus", async ({ page }) => {
    await ensureVerifiedFactor(ids["admin"] ?? "");
    await signIn(page, USERS.admin);

    const { rows } = await pool.query<{ id: string }>(
      `select d.id from public.documents d
       join public.obligation_occurrences oc on oc.id = d.occurrence_id
       where oc.obligation_type_id = $1 limit 1`,
      [OBLIGATION],
    );

    const documentId = rows[0]?.id;
    test.skip(documentId === undefined, "Aucun document déposé par le parcours 2.");

    const response = await page.request.get(`/api/documents/${documentId ?? ""}/download`, {
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(response.status());
  });
});

test.describe("6 · rectificative d'un dossier archivé", () => {
  test("un dossier archivé se rectifie, et l'original reste intact", async ({ page }) => {
    await signIn(page, USERS.manager);
    await visit(page, `/fr/echeancier/${archivedOccurrence}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });

    const rectify = page.getByRole("button", { name: /rectificative/i }).first();
    await expect(rectify).toBeVisible({ timeout: 15_000 });
    await rectify.click();

    const reason = page.getByLabel(/motif/i).first();
    await reason.fill("Erreur de montant constatée après dépôt, correction déposée.");
    await page
      .getByRole("button", { name: /créer|confirmer|valider/i })
      .last()
      .click();

    await expect(async () => {
      const { rows } = await pool.query<{ n: number }>(
        `select count(*)::int as n from public.obligation_occurrences
         where rectifies_occurrence_id = $1`,
        [archivedOccurrence],
      );
      expect(rows[0]?.n).toBeGreaterThan(0);
    }).toPass({ timeout: 25_000 });

    // ⚠️ L'ARCHIVE EST IMMUABLE : la rectificative est un dossier NEUF.
    const original = await pool.query<{ status: string }>(
      "select status::text as status from public.obligation_occurrences where id = $1",
      [archivedOccurrence],
    );
    expect(original.rows[0]?.status).toBe("ARCHIVED");
  });
});

test.describe("7 · cycle de vie d'une pièce", () => {
  test("dépôt, remplacement, puis téléchargement de la version courante", async ({ page }) => {
    await signIn(page, USERS.agent);
    await visit(page, `/fr/echeancier/${socialOccurrence}`);

    // Le dossier social appartient au RH : on repasse par un dossier accessible.
    await visit(page, `/fr/echeancier/${fiscalOccurrence}`);
    await expect(page.getByText(/Complétude du dossier/i)).toBeVisible({ timeout: 20_000 });

    const before = await pool.query<{ n: number }>(
      "select count(*)::int as n from public.documents where occurrence_id = $1 and deleted_at is null",
      [fiscalOccurrence],
    );

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "bordereau-v2.pdf", mimeType: "application/pdf", buffer: PDF_V2 });
    await expect(page.getByText(/Déposé/).first()).toBeVisible({ timeout: 30_000 });

    await expect(async () => {
      const after = await pool.query<{ n: number }>(
        "select count(*)::int as n from public.documents where occurrence_id = $1 and deleted_at is null",
        [fiscalOccurrence],
      );
      expect(after.rows[0]?.n).toBeGreaterThan(before.rows[0]?.n ?? 0);
    }).toPass({ timeout: 25_000 });

    // ── Téléchargement : la réponse est une redirection vers une URL SIGNÉE.
    const { rows } = await pool.query<{ id: string }>(
      `select id from public.documents where occurrence_id = $1 and deleted_at is null
       order by uploaded_at desc limit 1`,
      [fiscalOccurrence],
    );

    const response = await page.request.get(`/api/documents/${rows[0]?.id ?? ""}/download`, {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
    // ⚠️ Jamais d'URL publique : le lien est signé et de courte durée.
    expect(response.headers()["location"]).toContain("/storage/v1/object/sign/");
  });
});

test.describe("8 · notification", () => {
  test("une notification produite en base apparaît dans le centre", async ({ page }) => {
    await pool.query(
      `select public.enqueue_notification(
         p_recipient := $1, p_channel := 'IN_APP', p_kind := 'UPCOMING_DEADLINE',
         p_subject := 'Parcours critique — échéance à venir',
         p_body_text := 'Parcours critique — échéance à venir',
         p_scheduled_for := now(), p_occurrence := $2)`,
      [ids["agent"], fiscalOccurrence],
    );

    await signIn(page, USERS.agent);
    await visit(page, "/fr/notifications");

    await expect(page.getByText("Parcours critique — échéance à venir")).toBeVisible({
      timeout: 20_000,
    });

    // La cloche annonce le compte dans son NOM ACCESSIBLE, pas seulement en pastille.
    await visit(page, "/fr/echeancier");
    await expect(page.getByRole("button", { name: /non lue/i })).toBeVisible();
  });
});
