/**
 * Crée un compte de DÉVELOPPEMENT LOCAL et lui attribue un rôle.
 *
 * L'application n'a pas d'inscription : on entre par invitation, et une
 * invitation suppose un administrateur, qui suppose un compte. Ce script casse
 * cet œuf-et-poule sur un poste de développement, et nulle part ailleurs.
 *
 *   node scripts/create-user.mjs <email> <mot-de-passe> <ROLE> [DOMAINE]
 *   node scripts/create-user.mjs demo@agroespace.dz Conformia2026! SUPERVISEUR
 *
 * ⚠️ LES RÔLES PAR SERVICE NE SONT PLUS ATTRIBUABLES. La migration 0018 a
 * introduit la triade RESPONSABLE / SUPPLEANT / SUPERVISEUR et DÉSACTIVÉ
 * COMPTA_MANAGER, COMPTA_AGENT, RH_MANAGER, RH_AGENT et REGLEMENTAIRE. Ils
 * demeurent en base — `user_roles` et `audit_log` portent leurs identifiants, et
 * l'historique doit rester lisible — mais un trigger refuse toute NOUVELLE
 * attribution. Ce script le dit AVANT d'essayer, plutôt que de laisser remonter
 * l'erreur du trigger.
 *
 * ⚠️ N'EMPLOIE PAS la clé `service_role` : il écrit directement dans Postgres,
 * comme `seed.mjs`. Le mot de passe est haché par `crypt()` avec `gen_salt('bf')`
 * — le même bcrypt que GoTrue — de sorte que la connexion se fasse par le vrai
 * chemin d'authentification, sans porte dérobée à maintenir.
 *
 * ⚠️ REFUSE DE S'EXÉCUTER hors d'une base locale. Un script qui fabrique des
 * comptes ne doit pas pouvoir viser une installation réelle par une variable
 * d'environnement mal placée.
 */

import { readFileSync } from "node:fs";
import { Pool } from "pg";

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

loadEnvLocal();

const [email, password, roleCode, domainCode] = process.argv.slice(2);

if (!email || !password || !roleCode) {
  console.error(
    [
      "Usage : node scripts/create-user.mjs <email> <mot-de-passe> <ROLE> [DOMAINE]",
      "",
      "Rôles attribuables :",
      "  RESPONSABLE  prépare et soumet les dossiers",
      "  SUPPLEANT    exactement les mêmes droits ; seule la trace le distingue",
      "  SUPERVISEUR  prépare, valide, affecte, supprime des pièces",
      "  DIRECTION    valide, déverrouille, gère le référentiel et les registres",
      "  ADMIN        comptes, rôles, réglages — AUCUN accès au contenu des dossiers",
      "  AUDITOR      lecture seule, journal d'audit compris",
      "  EXTERNAL     intervenant externe, borné au domaine FISCAL",
      "",
      "Domaines : FISCAL, SOCIAL, REGLEMENTAIRE, JURIDIQUE (omettre = portée globale)",
      "  RESPONSABLE, SUPPLEANT, SUPERVISEUR et DIRECTION sont GLOBAUX par défaut :",
      "  omettre le domaine est le cas normal. Le préciser sert à éprouver le",
      "  cloisonnement, pas à s'en servir au quotidien.",
      "",
      "Pour découvrir l'application, SUPERVISEUR sans domaine ouvre le plus d'écrans.",
    ].join("\n"),
  );
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const isLocal = /(?:127\.0\.0\.1|localhost)/.test(connectionString);
if (!isLocal) {
  console.error(
    "REFUS : DATABASE_URL ne pointe pas vers une base locale.\n" +
      "Ce script fabrique des comptes ; il n'a rien à faire sur une installation réelle.",
  );
  process.exit(1);
}

if (password.length < 12) {
  // Le formulaire de l'application impose une longueur minimale : un compte créé
  // ici avec un mot de passe plus court passerait la connexion et échouerait au
  // premier changement, sans que le lien soit évident.
  console.error("REFUS : mot de passe de 12 caractères minimum.");
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1 });

try {
  /*
   * ⚠️ LE RÔLE EST VÉRIFIÉ AVANT D'ÊTRE ATTRIBUÉ, et il y a trois issues
   * distinctes qu'il serait faux de confondre :
   *
   *   • rôle inconnu       → faute de frappe ;
   *   • rôle DÉSACTIVÉ     → il existe, il est lisible dans l'historique, et le
   *                          trigger `enforce_active_role_grant` (0018) refusera
   *                          l'attribution ;
   *   • domaine inconnu    → le plus sournois. La requête d'attribution fait une
   *                          jointure EXTERNE sur les domaines : un code erroné
   *                          n'échoue pas, il donne un domaine NULL, c'est-à-dire
   *                          une PORTÉE GLOBALE. On demande FISCAL, on obtient
   *                          tous les domaines, et rien ne le signale.
   */
  const { rows: roleRows } = await pool.query(
    "select code, is_active, max_duration_days from public.roles where code = $1",
    [roleCode],
  );

  if (roleRows.length === 0) {
    const { rows: available } = await pool.query(
      "select code from public.roles where is_active order by code",
    );
    console.error(
      `ÉCHEC : rôle « ${roleCode} » inconnu.\n` +
        `Rôles attribuables : ${available.map((row) => row.code).join(", ")}`,
    );
    process.exit(1);
  }

  if (!roleRows[0].is_active) {
    console.error(
      `ÉCHEC : le rôle « ${roleCode} » est DÉSACTIVÉ depuis la migration 0018.\n` +
        "Les rôles par service ont été remplacés par la triade d'affectation :\n" +
        "  COMPTA_AGENT, RH_AGENT, REGLEMENTAIRE  →  RESPONSABLE (ou SUPPLEANT)\n" +
        "  COMPTA_MANAGER, RH_MANAGER             →  SUPERVISEUR\n" +
        "Le rôle reste en base pour que l'historique d'audit qui le cite demeure\n" +
        "lisible ; il n'est simplement plus attribuable.",
    );
    process.exit(1);
  }

  if (domainCode) {
    const { rowCount: domainFound } = await pool.query(
      "select 1 from public.domains where code = $1",
      [domainCode],
    );
    if (domainFound === 0) {
      const { rows: domains } = await pool.query("select code from public.domains order by code");
      console.error(
        `ÉCHEC : domaine « ${domainCode} » inconnu.\n` +
          `Domaines : ${domains.map((row) => row.code).join(", ")}\n` +
          "Sans cette vérification, le compte aurait été créé en portée GLOBALE.",
      );
      process.exit(1);
    }
  }

  /*
   * ⚠️ CERTAINS RÔLES SONT À DURÉE BORNÉE, et la base le fait respecter :
   * AUDITOR expire au bout de 90 jours, EXTERNAL au bout de 365. Sans date
   * d'expiration, l'attribution est refusée par une contrainte — « Le rôle
   * AUDITOR exige une date d'expiration ». Ce n'est pas une friction à
   * contourner : un accès en lecture accordé à un auditeur externe ne doit pas
   * survivre à la mission qui l'a justifié.
   *
   * On pose donc le maximum autorisé, en le DISANT : sur un poste de
   * développement, la date qui compte est celle qui ne surprend pas trois mois
   * plus tard par une déconnexion inexpliquée.
   */

  const { rows: existing } = await pool.query("select id from auth.users where email = $1", [
    email,
  ]);

  let userId = existing[0]?.id ?? null;

  if (userId === null) {
    const { rows } = await pool.query(
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
         -- Adresse confirmée d'office : aucun courriel de confirmation ne part
         -- en développement, et un compte non confirmé ne peut pas se connecter.
         now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         '{"email_verified":true}'::jsonb,
         /*
          * ⚠️ CHAÎNES VIDES, PAS NULL. GoTrue lit ces colonnes dans des champs
          * Go non nullables : un NULL y produit « Database error querying
          * schema » à la connexion — une erreur 500 opaque qui ne nomme ni la
          * colonne, ni la table. L'API d'administration les initialise à '' ;
          * en écrivant directement, c'est à nous de le faire.
          */
         '', '', '', '', '', '', '')
       returning id`,
      [email, password],
    );
    userId = rows[0].id;
    console.log(`compte créé  : ${email}`);
  } else {
    await pool.query(
      "update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1",
      [userId, password],
    );
    console.log(`compte existant : ${email} — mot de passe réinitialisé`);
  }

  // Le profil est créé par un trigger sur auth.users ; on ne fait que le nommer.
  await pool.query("update public.profiles set full_name = coalesce(full_name, $2) where id = $1", [
    userId,
    email.split("@")[0],
  ]);

  const maxDays = roleRows[0].max_duration_days;

  const { rowCount } = await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id, expires_at)
     select $1, r.id, d.id,
            case when $4::int is null then null
                 else pg_catalog.now() + ($4::int || ' days')::interval end
     from public.roles r
     left join public.domains d on d.code = $3
     where r.code = $2
     on conflict do nothing`,
    [userId, roleCode, domainCode ?? null, maxDays ?? null],
  );

  if (maxDays !== null && rowCount > 0) {
    console.log(`expiration   : dans ${maxDays} jours (imposée par le rôle)`);
  }

  if (rowCount === 0) {
    const { rows: already } = await pool.query(
      `select r.code from public.user_roles ur join public.roles r on r.id = ur.role_id
       where ur.user_id = $1`,
      [userId],
    );
    if (already.length === 0) {
      // Le rôle a été vérifié plus haut : arriver ici sans aucune attribution
      // signifie que l'insertion a été refusée pour une raison qu'on n'a pas su
      // anticiper. On le dit plutôt que de laisser croire à un succès.
      console.error(`ÉCHEC : l'attribution du rôle « ${roleCode} » n'a rien inséré.`);
      process.exit(1);
    }
    console.log(`rôle déjà attribué : ${already.map((row) => row.code).join(", ")}`);
  } else {
    console.log(`rôle attribué : ${roleCode}${domainCode ? ` (${domainCode})` : " (global)"}`);
  }

  /*
   * ⚠️ ADMIN et DIRECTION exigent un second facteur : sans lui, le middleware
   * enferme la session sur l'écran d'enrôlement. On marque le drapeau pour que
   * la découverte de l'application ne commence pas par un scan de QR code.
   * `mfa_enrolled` n'est qu'un reflet de confort — la vérité reste dans GoTrue —
   * mais c'est ce drapeau que le middleware consulte.
   */
  if (roleCode === "ADMIN" || roleCode === "DIRECTION") {
    await pool.query("update public.profiles set mfa_enrolled = true where id = $1", [userId]);
    console.log("second facteur : contourné (développement local uniquement)");
  }

  console.log(`\nConnexion : http://localhost:3000/fr/login`);
} finally {
  await pool.end();
}
