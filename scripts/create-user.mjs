/**
 * Crée un compte de DÉVELOPPEMENT LOCAL et lui attribue un rôle.
 *
 * L'application n'a pas d'inscription : on entre par invitation, et une
 * invitation suppose un administrateur, qui suppose un compte. Ce script casse
 * cet œuf-et-poule sur un poste de développement, et nulle part ailleurs.
 *
 *   node scripts/create-user.mjs <email> <mot-de-passe> <ROLE> [DOMAINE]
 *   node scripts/create-user.mjs demo@agroespace.dz Conformia2026! COMPTA_MANAGER FISCAL
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
    "Usage : node scripts/create-user.mjs <email> <mot-de-passe> <ROLE> [DOMAINE]\n" +
      "Rôles  : ADMIN, DIRECTION, COMPTA_MANAGER, COMPTA_AGENT, RH_MANAGER, RH_AGENT,\n" +
      "         REGLEMENTAIRE, AUDITOR, EXTERNAL\n" +
      "Domaines : FISCAL, SOCIAL, REGLEMENTAIRE, JURIDIQUE (omettre = portée globale)",
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

  const { rowCount } = await pool.query(
    `insert into public.user_roles (user_id, role_id, domain_id)
     select $1, r.id, d.id
     from public.roles r
     left join public.domains d on d.code = $3
     where r.code = $2
     on conflict do nothing`,
    [userId, roleCode, domainCode ?? null],
  );

  if (rowCount === 0) {
    const { rows: already } = await pool.query(
      `select r.code from public.user_roles ur join public.roles r on r.id = ur.role_id
       where ur.user_id = $1`,
      [userId],
    );
    if (already.length === 0) {
      console.error(`ÉCHEC : rôle « ${roleCode} » inconnu.`);
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
