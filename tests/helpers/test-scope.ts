import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";

import type { Database } from "@/types/database.types";

/**
 * CONTEXTE DE TEST ISOLÉ PAR ENTITÉ.
 *
 * ⚠️ LE DÉFAUT QUE CE MODULE CORRIGE EST STRUCTUREL, PAS ACCIDENTEL.
 *
 * Une suite d'intégration qui affirme sur des comptages GLOBAUX —
 * `select count(*) from obligation_occurrences` — ne mesure pas ce qu'elle
 * croit : elle mesure l'état de la base. Elle passe sur une base vide, elle
 * échoue dès qu'on y charge le référentiel réel, et il devient alors impossible
 * d'avoir en même temps une application utilisable et une suite verte. C'est
 * exactement ce qui est arrivé ici : quatre tests devenaient rouges au seul
 * chargement des 23 obligations AGROESPACE.
 *
 * Le remède n'est pas de vider la base avant les tests — cela reviendrait à
 * éprouver une situation qui n'existera jamais en production. Il est de rendre
 * chaque test AVEUGLE à ce qu'il n'a pas créé.
 *
 * ⚠️ LE MÉCANISME N'INVENTE RIEN. `entity_id` existe sur toutes les tables
 * métier depuis 0001, avec un défaut pointant l'entité AGROESPACE. La colonne
 * avait été prévue pour un cloisonnement multi-sites à venir ; elle donne ici
 * l'isolation sans une ligne de schéma en plus. Chaque fichier de test crée sa
 * PROPRE entité, y range tout ce qu'il fabrique, et n'affirme que sur elle.
 *
 * Ce que cela apporte au-delà du confort :
 *
 *   • la suite s'exécute sur une base AVEC référentiel — l'état de production ;
 *   • elle passe DEUX fois de suite sans réinitialisation, puisque chaque
 *     exécution nettoie son entité ;
 *   • un test qui échoue nomme un vrai défaut, et non un voisin bruyant.
 */

const DB_URL =
  process.env["SUPABASE_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

/**
 * Mot de passe unique des comptes fabriqués ici.
 *
 * ⚠️ Douze caractères au moins : le formulaire de l'application impose cette
 * longueur, et un compte plus court passerait la connexion pour échouer au
 * premier changement — un écart entre le test et le réel, à l'endroit précis
 * où l'on croit éprouver le réel.
 */
const TEST_PASSWORD = "ConformiaTest2026!";

/** Les sept rôles ATTRIBUABLES. Les rôles par service sont désactivés (0018). */
export const ACTIVE_ROLES = [
  "ADMIN",
  "DIRECTION",
  "RESPONSABLE",
  "SUPPLEANT",
  "SUPERVISEUR",
  "AUDITOR",
  "EXTERNAL",
] as const;

export type ActiveRole = (typeof ACTIVE_ROLES)[number];

export type DomainCode = "FISCAL" | "SOCIAL" | "REGLEMENTAIRE" | "JURIDIQUE";

export interface ObligationOptions {
  readonly code?: string;
  readonly name?: string;
  readonly domain?: DomainCode;
  readonly periodicity?: string;
  readonly scope?: "ENTITY" | "PER_REGISTER";
  readonly dueRule?: Record<string, unknown>;
  readonly criticality?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly validationLevels?: number;
  readonly requiresValidation?: boolean;
  readonly allowSelfValidation?: boolean;
  readonly internalLeadDays?: number;
  readonly effectiveFrom?: string;
}

export interface RegisterOptions {
  readonly rcNumber?: string;
  readonly registerType?: "PRINCIPAL" | "SECONDAIRE" | "ANNEXE";
  readonly status?: "ACTIF" | "SUSPENDU" | "RADIE";
  readonly label?: string;
  readonly issuedAt?: string;
}

export interface OccurrenceOptions {
  readonly obligationId: string;
  readonly periodKey: string;
  readonly status?: string;
  readonly ownerId?: string | null;
  readonly deputyId?: string | null;
  readonly validatorId?: string | null;
  readonly registerId?: string | null;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly legalDueDate?: string;
  readonly internalDueDate?: string;
  readonly submittedForValidationAt?: string | null;
}

export interface ProfileOptions {
  readonly fullName?: string;
  readonly isActive?: boolean;
}

export interface TestScope {
  /** Entité dédiée : le périmètre de tout ce que ce fichier fabrique. */
  readonly entityId: string;
  /** Code lisible de l'entité, `TEST-xxxxxxxx`. */
  readonly code: string;
  /** Accès direct, pour les cas que les fabriques ne couvrent pas. */
  readonly pool: Pool;
  /** Client `service_role` — contourne la RLS. Pour POSER un état, jamais pour l'éprouver. */
  readonly admin: SupabaseClient<Database>;

  createProfile(options?: ProfileOptions): Promise<string>;
  grantRole(userId: string, role: ActiveRole, domain?: DomainCode): Promise<void>;
  /** Raccourci : un compte neuf, doté du rôle demandé. */
  createUserWithRole(role: ActiveRole, domain?: DomainCode): Promise<string>;

  createObligation(options?: ObligationOptions): Promise<string>;
  createRegister(options?: RegisterOptions): Promise<string>;
  createOccurrence(options: OccurrenceOptions): Promise<string>;
  createDocument(options: {
    readonly occurrenceId: string;
    readonly uploadedBy: string;
    readonly kind?: "JUSTIFICATIF" | "PREUVE_DEPOT" | "ANNEXE" | "CORRESPONDANCE";
    readonly filename?: string;
  }): Promise<string>;
  createAbsence(options: {
    readonly userId: string;
    readonly startsAt?: string;
    readonly endsAt?: string;
    readonly reason?: string;
  }): Promise<string>;
  createDelegation(options: {
    readonly delegatorId: string;
    readonly delegateId: string;
    readonly startsAt?: string;
    readonly endsAt?: string;
    readonly reason?: string;
  }): Promise<string>;

  /** Exécute sous la session de cet utilisateur, en transaction annulée à la fin. */
  asUser<T>(userId: string, run: (client: PoolClient) => Promise<T>): Promise<T>;
  /**
   * Client Supabase RÉELLEMENT authentifié sous un compte portant ce rôle.
   *
   * ⚠️ Passe par `signInWithPassword`, donc par le vrai chemin GoTrue et le vrai
   * jeton. C'est la seule façon d'éprouver les politiques telles qu'elles
   * s'appliquent : un client `service_role` les contournerait, et un `set role`
   * en SQL n'exerce pas la chaîne PostgREST.
   */
  asRole(role: ActiveRole, domain?: DomainCode): Promise<SupabaseClient<Database>>;

  /** Nombre de dossiers de CETTE entité — le comptage qu'un test a le droit de faire. */
  countOccurrences(client?: PoolClient): Promise<number>;
}

let sequence = 0;

function nextSuffix(): string {
  sequence += 1;
  return String(sequence).padStart(3, "0");
}

/**
 * Âge au-delà duquel une entité `TEST-` est tenue pour ABANDONNÉE.
 *
 * ⚠️ Un délai, et pas « toutes les entités de test ». Un fichier qui s'exécute
 * en ce moment même a une entité fraîche : la balayer sous ses pieds le ferait
 * échouer pour une raison introuvable. Dix minutes séparent « une exécution en
 * cours » de « une exécution qui a planté avant son `afterAll` ».
 */
const STALE_AFTER = "10 minutes";

/**
 * Efface les entités de test qu'une exécution interrompue a laissées.
 *
 * ⚠️ SANS CELA, LA SUITE NE SE REMET PAS D'UN PLANTAGE. Un `afterAll` qui
 * n'aboutit pas — un délai dépassé, une assertion qui lève dans un hook —
 * abandonne son entité, ses comptes et ses dossiers. Ils ne gênent aucun test,
 * puisque chacun ne regarde que le sien ; mais ils s'accumulent, et la seule
 * façon de s'en défaire finissait par être la réinitialisation de la base —
 * c'est-à-dire ce que ce module existe pour éviter.
 */
async function sweepStaleScopes(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from public.entities
      where code like 'TEST-%' and created_at < now() - interval '${STALE_AFTER}'`,
  );
  if (rows.length === 0) return;

  for (const { id } of rows) {
    await purgeEntity(pool, id, []);
  }
}

export async function createTestScope(): Promise<TestScope> {
  const pool = new Pool({ connectionString: DB_URL, max: 6 });
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  await sweepStaleScopes(pool);

  const { rows } = await pool.query<{ id: string; code: string }>(
    `insert into public.entities (code, name)
     values ('TEST-' || substr(gen_random_uuid()::text, 1, 8), 'Entité de test')
     returning id, code`,
  );

  const entityId = rows[0]?.id ?? "";
  const code = rows[0]?.code ?? "";
  if (entityId === "") throw new Error("Création de l'entité de test impossible.");

  /*
   * ⚠️ Les comptes créés sont mémorisés : `auth.users` NE PORTE PAS `entity_id`
   * — c'est un schéma de Supabase, pas le nôtre — et la suppression en cascade
   * ne saurait donc pas les retrouver. On tient la liste plutôt que de deviner
   * par un motif d'adresse, qui finirait par emporter le compte d'un voisin.
   */
  const createdUsers: string[] = [];
  const sessions = new Map<string, SupabaseClient<Database>>();

  const scope: TestScope = {
    entityId,
    code,
    pool,
    admin,

    async createProfile(options = {}) {
      const email = `${code.toLowerCase()}-${nextSuffix()}@test.dz`;
      const { rows: created } = await pool.query<{ id: string }>(
        `insert into auth.users (
           instance_id, id, aud, role, email, encrypted_password,
           email_confirmed_at, created_at, updated_at,
           raw_app_meta_data, raw_user_meta_data,
           confirmation_token, email_change, email_change_token_current,
           email_change_token_new, phone_change_token, reauthentication_token,
           recovery_token)
         values (
           '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
           'authenticated', 'authenticated', $1,
           extensions.crypt($2, extensions.gen_salt('bf')),
           now(), now(), now(),
           '{"provider":"email","providers":["email"]}'::jsonb,
           '{"email_verified":true}'::jsonb,
           -- ⚠️ Chaînes vides, pas NULL : GoTrue lit ces colonnes dans des
           -- champs Go non nullables, et un NULL y produit « Database error
           -- querying schema » à la connexion.
           '', '', '', '', '', '', '')
         returning id`,
        [email, TEST_PASSWORD],
      );

      const userId = created[0]?.id ?? "";
      createdUsers.push(userId);

      // Le profil naît d'un trigger sur auth.users ; on le rattache à l'entité
      // du test et on le nomme.
      await pool.query(
        `update public.profiles
            set entity_id = $2,
                full_name = $3,
                is_active = $4,
                -- Le second facteur est hors sujet ici : les tests d'intégration
                -- parlent à Postgres, pas au middleware qui l'exige.
                mfa_enrolled = true
          where id = $1`,
        [userId, entityId, options.fullName ?? email, options.isActive ?? true],
      );

      return userId;
    },

    async grantRole(userId, role, domain) {
      await pool.query(
        `insert into public.user_roles (user_id, role_id, domain_id, expires_at)
         select $1, r.id, d.id,
                -- AUDITOR et EXTERNAL sont à durée bornée : sans expiration,
                -- la contrainte refuse l'attribution.
                case when r.max_duration_days is null then null
                     else now() + (r.max_duration_days || ' days')::interval end
           from public.roles r
           left join public.domains d on d.code = $3
          where r.code = $2
         on conflict do nothing`,
        [userId, role, domain ?? null],
      );
    },

    async createUserWithRole(role, domain) {
      const userId = await scope.createProfile();
      await scope.grantRole(userId, role, domain);
      return userId;
    },

    async createObligation(options = {}) {
      const { rows: created } = await pool.query<{ id: string }>(
        `insert into public.obligation_types
           (entity_id, code, name, domain_id, periodicity, due_rule, effective_from,
            criticality, validation_levels, requires_validation, allow_self_validation,
            internal_lead_days, scope)
         values ($1, $2, $3,
                 (select id from public.domains where code = $4),
                 $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
         returning id`,
        [
          entityId,
          options.code ?? `${code}-OBL-${nextSuffix()}`,
          options.name ?? "Obligation de test",
          options.domain ?? "FISCAL",
          options.periodicity ?? "MONTHLY",
          JSON.stringify(options.dueRule ?? { anchor: "PERIOD_END", offset_days: 20 }),
          options.effectiveFrom ?? "2020-01-01",
          options.criticality ?? "MEDIUM",
          options.validationLevels ?? 1,
          options.requiresValidation ?? true,
          options.allowSelfValidation ?? false,
          options.internalLeadDays ?? 7,
          options.scope ?? "ENTITY",
        ],
      );
      return created[0]?.id ?? "";
    },

    async createRegister(options = {}) {
      const { rows: created } = await pool.query<{ id: string }>(
        `insert into public.commercial_registers
           (entity_id, rc_number, register_type, label, status, issued_at)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          entityId,
          options.rcNumber ?? `${code}-RC-${nextSuffix()}`,
          // ⚠️ SECONDAIRE par défaut : un index partiel n'autorise qu'UN SEUL
          // registre PRINCIPAL actif par entité, et une fabrique qui produirait
          // des principaux échouerait au deuxième appel.
          options.registerType ?? "SECONDAIRE",
          options.label ?? `Établissement ${nextSuffix()}`,
          options.status ?? "ACTIF",
          options.issuedAt ?? "2020-01-01",
        ],
      );
      return created[0]?.id ?? "";
    },

    async createOccurrence(options) {
      const { rows: created } = await pool.query<{ id: string }>(
        `insert into public.obligation_occurrences
           (entity_id, obligation_type_id, period_key, period_start, period_end,
            legal_due_date, internal_due_date, status, owner_id, deputy_id,
            validator_id, commercial_register_id, submitted_for_validation_at)
         values ($1, $2, $3,
                 coalesce($4::date, date '2026-01-01'),
                 coalesce($5::date, date '2026-01-31'),
                 coalesce($6::date, date '2026-02-20'),
                 coalesce($7::date, date '2026-02-13'),
                 $8, $9, $10, $11, $12, $13)
         returning id`,
        [
          entityId,
          options.obligationId,
          options.periodKey,
          options.periodStart ?? null,
          options.periodEnd ?? null,
          options.legalDueDate ?? null,
          options.internalDueDate ?? null,
          options.status ?? "TODO",
          options.ownerId ?? null,
          options.deputyId ?? null,
          options.validatorId ?? null,
          options.registerId ?? null,
          options.submittedForValidationAt ?? null,
        ],
      );
      return created[0]?.id ?? "";
    },

    async createDocument(options) {
      const { rows: created } = await pool.query<{ id: string }>(
        `insert into public.documents
           (entity_id, occurrence_id, document_kind, original_filename,
            normalized_filename, storage_path, mime_type, size_bytes, sha256, uploaded_by)
         values ($1, $2, $3, $4, $4, $5, 'application/pdf', 1024,
                 -- L'empreinte doit satisfaire ^[0-9a-f]{64}$ : on la CALCULE
                 -- plutôt que d'inventer une constante qui finirait par être
                 -- partagée entre deux pièces censées différer.
                 encode(extensions.digest($5, 'sha256'), 'hex'), $6)
         returning id`,
        [
          entityId,
          options.occurrenceId,
          options.kind ?? "PREUVE_DEPOT",
          options.filename ?? `${code}-piece-${nextSuffix()}.pdf`,
          `${entityId}/${options.occurrenceId}/${nextSuffix()}.pdf`,
          options.uploadedBy,
        ],
      );
      return created[0]?.id ?? "";
    },

    async createAbsence(options) {
      const { rows: created } = await pool.query<{ id: string }>(
        `insert into public.user_absences (entity_id, user_id, starts_at, ends_at, reason)
         values ($1, $2, coalesce($3::date, current_date - 1),
                 coalesce($4::date, current_date + 30), $5)
         returning id`,
        [
          entityId,
          options.userId,
          options.startsAt ?? null,
          options.endsAt ?? null,
          options.reason ?? "Congé annuel",
        ],
      );
      return created[0]?.id ?? "";
    },

    async createDelegation(options) {
      const { rows: created } = await pool.query<{ id: string }>(
        `insert into public.validation_delegations
           (entity_id, delegator_id, delegate_id, starts_at, ends_at, reason)
         values ($1, $2, $3, coalesce($4::date, current_date - 1),
                 coalesce($5::date, current_date + 30), $6)
         returning id`,
        [
          entityId,
          options.delegatorId,
          options.delegateId,
          options.startsAt ?? null,
          options.endsAt ?? null,
          options.reason ?? "Délégation de test",
        ],
      );
      return created[0]?.id ?? "";
    },

    async asUser(userId, run) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: userId, role: "authenticated" }),
        ]);
        await client.query("set local role authenticated");
        return await run(client);
      } finally {
        // ⚠️ `rollback`, pas `commit` : un test qui laisse ses écritures derrière
        // lui contamine le suivant, et l'ordre d'exécution devient une variable
        // cachée du résultat.
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    },

    async asRole(role, domain) {
      const key = `${role}:${domain ?? "global"}`;
      const existing = sessions.get(key);
      if (existing) return existing;

      const userId = await scope.createUserWithRole(role, domain);
      const { rows: found } = await pool.query<{ email: string }>(
        "select email from auth.users where id = $1",
        [userId],
      );

      const authed = createClient<Database>(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await authed.auth.signInWithPassword({
        email: found[0]?.email ?? "",
        password: TEST_PASSWORD,
      });
      if (error !== null) {
        throw new Error(`Connexion impossible pour le rôle ${role} : ${error.message}`);
      }

      sessions.set(key, authed);
      return authed;
    },

    async countOccurrences(client) {
      const runner = client ?? pool;
      const { rows: counted } = await runner.query<{ n: string }>(
        "select count(*) as n from public.obligation_occurrences where entity_id = $1",
        [entityId],
      );
      return Number(counted[0]?.n ?? 0);
    },
  };

  /*
   * La destruction a besoin de la liste des comptes ; on l'attache au contexte
   * par une propriété non énumérée plutôt que par une variable de module, pour
   * que deux fichiers exécutés dans le même processus ne se marchent pas dessus.
   */
  registry.set(scope, createdUsers);
  return scope;
}

/** Comptes créés par chaque contexte — `auth.users` ne porte pas `entity_id`. */
const registry = new WeakMap<TestScope, string[]>();

/**
 * Efface tout ce que le contexte a fabriqué, puis l'entité elle-même.
 *
 * ⚠️ L'ORDRE EST IMPOSÉ PAR LES CLÉS ÉTRANGÈRES, et deux triggers s'y opposent :
 * `occurrence_transitions` est APPEND-ONLY, et l'audit écrit une ligne par
 * suppression. Les couper le temps du nettoyage n'affaiblit aucune garantie —
 * elles portent sur le flux applicatif, pas sur la capacité d'un test à effacer
 * ce qu'il a lui-même posé — et sans cela le nettoyage échoue à mi-course en
 * laissant une entité orpheline, c'est-à-dire exactement la pollution qu'il
 * devait empêcher.
 */
/**
 * Efface tout ce qui appartient à une entité, puis l'entité elle-même.
 *
 * ⚠️ DEUX TRIGGERS S'OPPOSENT AU NETTOYAGE, et il faut les couper :
 * `occurrence_transitions` est APPEND-ONLY, et l'audit écrit une ligne par
 * suppression. Les couper le temps du nettoyage n'affaiblit aucune garantie —
 * elles portent sur le flux applicatif, pas sur la capacité d'un test à effacer
 * ce qu'il a lui-même posé — et sans cela le nettoyage échoue à mi-course en
 * laissant une entité orpheline, c'est-à-dire exactement la pollution qu'il
 * devait empêcher.
 */
async function purgeEntity(pool: Pool, entityId: string, users: readonly string[]): Promise<void> {
  try {
    await pool.query(`
      alter table public.occurrence_transitions disable trigger trg_occurrence_transitions_append_only;
      alter table public.obligation_occurrences disable trigger user;
      alter table public.documents disable trigger user;
    `);

    /*
     * ⚠️ UNE INSTRUCTION PAR APPEL, et ce n'est pas un choix de style.
     * PostgreSQL refuse plusieurs commandes dans une requête PARAMÉTRÉE —
     * « cannot insert multiple commands into a prepared statement ». Grouper les
     * suppressions dans une seule chaîne échouait en bloc, et l'entité survivait
     * au nettoyage : précisément la pollution qu'il devait empêcher.
     *
     * L'ORDRE EST IMPOSÉ PAR LES CLÉS ÉTRANGÈRES : les enfants d'abord, du plus
     * profond au plus superficiel.
     */
    const suppressions = [
      `delete from public.occurrence_transitions t
        using public.obligation_occurrences oc
        where oc.id = t.occurrence_id and oc.entity_id = $1`,
      `delete from public.occurrence_comments c
        using public.obligation_occurrences oc
        where oc.id = c.occurrence_id and oc.entity_id = $1`,
      `delete from public.occurrence_checklist_items ci
        using public.obligation_occurrences oc
        where oc.id = ci.occurrence_id and oc.entity_id = $1`,
      `delete from public.document_access_log l
        using public.documents d where d.id = l.document_id and d.entity_id = $1`,
      `delete from public.document_integrity_checks ic
        using public.documents d where d.id = ic.document_id and d.entity_id = $1`,
      "delete from public.documents where entity_id = $1",
      "delete from public.document_upload_tickets where entity_id = $1",
      `delete from public.notifications n
        using public.profiles p where p.id = n.recipient_id and p.entity_id = $1`,
      "delete from public.obligation_occurrences where entity_id = $1",
      `delete from public.obligation_required_documents rd
        using public.obligation_types ot
        where ot.id = rd.obligation_type_id and ot.entity_id = $1`,
      "delete from public.obligation_types where entity_id = $1",
      "delete from public.commercial_registers where entity_id = $1",
      "delete from public.user_absences where entity_id = $1",
      "delete from public.validation_delegations where entity_id = $1",
      "delete from public.departments where entity_id = $1",
    ];

    for (const suppression of suppressions) {
      await pool.query(suppression, [entityId]);
    }

    /*
     * ⚠️ Les comptes se retrouvent par leur PROFIL, pas par leur adresse.
     * `auth.users` ne porte pas `entity_id` — c'est un schéma de Supabase — mais
     * `profiles` le porte, et le profil a le même identifiant que le compte. Un
     * balayage par motif d'adresse finirait par emporter le compte d'un voisin.
     */
    const { rows: orphelins } = await pool.query<{ id: string }>(
      "select id from public.profiles where entity_id = $1",
      [entityId],
    );
    const cibles = [...new Set([...users, ...orphelins.map((row) => row.id)])];

    if (cibles.length > 0) {
      await pool.query("delete from public.user_roles where user_id = any($1::uuid[])", [cibles]);
      await pool.query("delete from public.calendar_feed_tokens where user_id = any($1::uuid[])", [
        cibles,
      ]);
      await pool.query("delete from public.profiles where id = any($1::uuid[])", [cibles]);
      await pool.query("delete from auth.users where id = any($1::uuid[])", [cibles]);
    }

    await pool.query("delete from public.entities where id = $1", [entityId]);
  } finally {
    await pool
      .query(
        `
        alter table public.documents enable trigger user;
        alter table public.obligation_occurrences enable trigger user;
        alter table public.occurrence_transitions enable trigger trg_occurrence_transitions_append_only;
      `,
      )
      .catch(() => undefined);
  }
}

/** Referme le contexte : efface son entité, puis rend la réserve de connexions. */
export async function destroyTestScope(scope: TestScope): Promise<void> {
  try {
    await purgeEntity(scope.pool, scope.entityId, registry.get(scope) ?? []);
  } finally {
    await scope.pool.end();
  }
}
