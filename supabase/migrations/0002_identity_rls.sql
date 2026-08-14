-- =============================================================================
-- CONFORMIA — 0002 : identité, habilitations, RLS
--
-- Ce fichier détermine le niveau de sécurité réel du système. Tout ce qui n'est
-- pas explicitement autorisé ici est refusé : la RLS est active sur 100 % des
-- tables, aucune politique n'utilise USING (true), et aucune n'est FOR ALL.
--
-- Principe directeur : la RLS est l'autorité. L'interface masque, elle
-- n'autorise pas. Un défaut d'interface expose un bouton ; un défaut de policy
-- expose une déclaration fiscale.
--
-- 0001 est appliquée et donc figée : les tables qui y sont nées sont ALTERées
-- ici, jamais recréées.
-- =============================================================================

create extension if not exists citext with schema extensions;

-- =============================================================================
-- 1. RÉGLAGES APPLICATIFS
--    Référencés par les contrôles de séparation des tâches. Table à ligne
--    unique : ces réglages sont ceux de l'installation, pas d'un utilisateur.
-- =============================================================================

create table public.app_settings (
  id boolean primary key default true,
  allow_self_validation boolean not null default false,
  weekend_days int[] not null default '{5,6}',
  validation_fallback_business_days int not null default 5,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id) values (true);

comment on table public.app_settings is
  'Réglages de l''installation. Une seule ligne, garantie par la contrainte de singleton.';
comment on column public.app_settings.allow_self_validation is
  'Autorise globalement un préparateur à valider son propre dossier. false par défaut : '
  'la séparation des tâches est la règle. Une obligation peut lever l''interdiction '
  'individuellement via obligation_types.allow_self_validation.';
comment on column public.app_settings.weekend_days is
  'Jours chômés hebdomadaires, indices extract(dow) : 0=dimanche … 6=samedi. '
  '{5,6} = vendredi et samedi, week-end algérien. En données et non en dur : '
  'un site à l''étranger n''exigerait aucune migration.';
comment on column public.app_settings.validation_fallback_business_days is
  'Délai, en jours ouvrés, au-delà duquel la DIRECTION peut valider une occurrence '
  'restée en attente, quelle que soit la chaîne prévue.';

-- =============================================================================
-- 2. IDENTITÉ
-- =============================================================================

-- `profiles` existe depuis 0001 : on l'étend.
alter table public.profiles
  alter column email type extensions.citext,
  add column phone text,
  add column job_title text,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles (id) on delete restrict,
  add column mfa_enrolled boolean not null default false,
  add column last_login_at timestamptz,
  add column ics_token uuid not null default gen_random_uuid();

alter table public.profiles
  add constraint profiles_email_key unique (email);

alter table public.profiles
  add constraint profiles_ics_token_key unique (ics_token);

comment on column public.profiles.email is
  'citext : la casse ne doit pas créer deux comptes pour une même personne.';
comment on column public.profiles.mfa_enrolled is
  'Second facteur enrôlé. Renseigné par le flux d''authentification, jamais par l''utilisateur.';
comment on column public.profiles.ics_token is
  'Jeton du flux calendrier personnel (prompt 5.2). Secret porteur : quiconque le détient '
  'lit les échéances de la personne. Il se régénère, il ne se partage pas.';
comment on column public.profiles.deactivated_at is
  'Désactivation d''un compte. Un compte désactivé ne lit plus rien : public.is_active_user() '
  'est le premier filtre de chaque politique.';

-- Création automatique du profil à l'inscription. Sans cela, un compte auth
-- existerait sans identité applicative et échapperait à toute politique.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Crée le profil applicatif à l''inscription. ON CONFLICT DO NOTHING : le rejeu d''un '
  'événement d''inscription ne doit pas faire échouer la création du compte.';

drop trigger if exists trg_auth_users_create_profile on auth.users;
create trigger trg_auth_users_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  is_system boolean not null default false,
  default_domain_code text,
  max_duration_days int check (max_duration_days is null or max_duration_days > 0),
  created_at timestamptz not null default now()
);

comment on table public.roles is
  'Rôles applicatifs. is_system = fourni par la plateforme, non supprimable.';
comment on column public.roles.default_domain_code is
  'Domaine proposé par défaut à l''attribution. Indicatif : la portée réelle est '
  'user_roles.domain_id. Un rôle couvrant deux domaines (COMPTA_MANAGER : FISCAL et '
  'JURIDIQUE) s''attribue deux fois, avec deux domain_id.';
comment on column public.roles.max_duration_days is
  'Durée maximale d''une attribution. Renseignée, elle rend expires_at obligatoire : '
  'un accès d''audit ou externe ne doit jamais être permanent.';

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  category text not null
);

comment on table public.permissions is
  'Vocabulaire des permissions. Miroir de src/config/permissions.ts.';

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete restrict,
  primary key (role_id, permission_id)
);

comment on table public.role_permissions is
  'Matrice rôle → permissions. CASCADE depuis roles : supprimer un rôle retire ses '
  'attributions, aucune trace d''audit n''est portée ici.';

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  role_id uuid not null references public.roles (id) on delete restrict,
  domain_id uuid references public.domains (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete restrict,
  grant_reason text,
  created_at timestamptz not null default now()
);

comment on table public.user_roles is
  'Attributions de rôles. Jamais supprimées : une habilitation retirée reste lisible '
  'via revoked_at. Qui a eu quel droit, quand, et pourquoi, doit rester reconstituable.';
comment on column public.user_roles.domain_id is
  'Portée de l''attribution. NULL = portée globale, valable pour tous les domaines.';
comment on column public.user_roles.expires_at is
  'Expiration. Obligatoire pour les rôles à max_duration_days (AUDITOR, EXTERNAL).';

-- Une même paire (utilisateur, rôle, domaine) ne peut être active qu'une fois.
-- Index partiel : les attributions révoquées peuvent se répéter dans l'historique.
create unique index user_roles_active_unique_idx
  on public.user_roles (user_id, role_id, domain_id)
  where revoked_at is null and domain_id is not null;

create unique index user_roles_active_global_unique_idx
  on public.user_roles (user_id, role_id)
  where revoked_at is null and domain_id is null;

-- Chemin d'accès de TOUTES les fonctions d'autorisation : elles sont appelées
-- une à plusieurs fois par ligne évaluée par la RLS.
create index user_roles_active_idx
  on public.user_roles (user_id)
  where revoked_at is null;

-- =============================================================================
-- 3. DÉLÉGATION DE VALIDATION
-- =============================================================================

create table public.validation_delegations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.entities (id) on delete restrict,
  delegator_id uuid not null references public.profiles (id) on delete restrict,
  delegate_id uuid not null references public.profiles (id) on delete restrict,
  domain_id uuid references public.domains (id) on delete restrict,
  starts_at date not null,
  ends_at date not null,
  reason text not null,
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete restrict,
  constraint validation_delegations_range check (ends_at > starts_at),
  constraint validation_delegations_max_90_days
    check (ends_at <= starts_at + interval '90 days'),
  constraint validation_delegations_distinct_parties check (delegator_id <> delegate_id)
);

comment on table public.validation_delegations is
  'Délégation temporaire des droits de validation, pour absence ou congé. Bornée à '
  '90 jours : une délégation permanente est une réorganisation, elle passe par les rôles.';
comment on column public.validation_delegations.domain_id is
  'Portée de la délégation. NULL = tous les domaines couverts par le délégant.';
comment on column public.validation_delegations.reason is
  'Obligatoire : une délégation de droits sans justification est inauditable.';

create index validation_delegations_delegate_idx
  on public.validation_delegations (delegate_id, starts_at, ends_at)
  where revoked_at is null;

-- =============================================================================
-- 4. SEED — PERMISSIONS, RÔLES, MATRICE
-- =============================================================================

insert into public.permissions (code, label, category) values
  ('obligation.read',     'Consulter le référentiel',        'referential'),
  ('referential.manage',  'Gérer le référentiel',            'referential'),
  ('occurrence.read',     'Consulter les occurrences',       'occurrence'),
  ('occurrence.write',    'Traiter une occurrence',          'occurrence'),
  ('occurrence.assign',   'Affecter une occurrence',         'occurrence'),
  ('occurrence.submit',   'Déclarer un dépôt',               'occurrence'),
  ('occurrence.validate', 'Valider une occurrence',          'occurrence'),
  ('occurrence.mark_na',  'Déclarer sans objet',             'occurrence'),
  ('occurrence.unlock',   'Rouvrir un dossier archivé',      'occurrence'),
  ('document.read',       'Consulter les pièces',            'document'),
  ('document.upload',     'Déposer une pièce',               'document'),
  ('document.delete',     'Supprimer une pièce',             'document'),
  ('audit.read',          'Consulter le journal d''audit',   'audit'),
  ('user.manage',         'Gérer les utilisateurs',          'administration'),
  ('role.manage',         'Gérer les rôles',                 'administration'),
  ('settings.manage',     'Gérer les réglages',              'administration'),
  ('dashboard.view_all',  'Voir tous les tableaux de bord',  'transverse'),
  ('export.generate',     'Produire un export',              'transverse');

insert into public.roles (code, label, description, is_system, default_domain_code, max_duration_days) values
  ('ADMIN', 'Administrateur technique',
   'Administre comptes, rôles et référentiel. N''accède PAS au contenu métier.',
   true, null, null),
  ('DIRECTION', 'Direction',
   'Supervision transverse, validation et réouverture. N''administre pas les comptes.',
   true, null, null),
  ('COMPTA_MANAGER', 'Responsable comptabilité',
   'Pilote les obligations fiscales et juridiques.', true, 'FISCAL', null),
  ('COMPTA_AGENT', 'Agent comptabilité',
   'Prépare les obligations fiscales.', true, 'FISCAL', null),
  ('RH_MANAGER', 'Responsable ressources humaines',
   'Pilote les obligations sociales.', true, 'SOCIAL', null),
  ('RH_AGENT', 'Agent ressources humaines',
   'Prépare les obligations sociales.', true, 'SOCIAL', null),
  ('REGLEMENTAIRE', 'Responsable réglementaire',
   'Pilote les obligations réglementaires. La validation revient à la DIRECTION.',
   true, 'REGLEMENTAIRE', null),
  ('AUDITOR', 'Auditeur',
   'Lecture seule transverse, pour mission d''audit. Habilitation temporaire.',
   true, null, 90),
  ('EXTERNAL', 'Intervenant externe',
   'Cabinet comptable ou conseil. Accès strictement borné et temporaire.',
   true, 'FISCAL', 365);

comment on column public.roles.is_system is
  'Rôle fourni par la plateforme. La matrice ci-dessous est une décision de sécurité '
  'arrêtée : ADMIN est VOLONTAIREMENT privé de occurrence.read, document.read, '
  'occurrence.validate et occurrence.unlock. Séparer l''administration technique de '
  'l''accès au contenu métier est le point le plus important de ce fichier. '
  'Ce n''est pas un oubli : ne pas « corriger ».';

-- Matrice rôle → permissions, injectée telle quelle.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join lateral (
  values
    -- ADMIN : administration uniquement. Aucun accès au contenu métier.
    ('ADMIN', 'obligation.read'),
    ('ADMIN', 'referential.manage'),
    ('ADMIN', 'audit.read'),
    ('ADMIN', 'user.manage'),
    ('ADMIN', 'role.manage'),
    ('ADMIN', 'settings.manage'),

    -- DIRECTION : supervision et validation. Pas d'administration des comptes.
    ('DIRECTION', 'obligation.read'),
    ('DIRECTION', 'referential.manage'),
    ('DIRECTION', 'occurrence.read'),
    ('DIRECTION', 'occurrence.assign'),
    ('DIRECTION', 'occurrence.validate'),
    ('DIRECTION', 'occurrence.mark_na'),
    ('DIRECTION', 'occurrence.unlock'),
    ('DIRECTION', 'document.read'),
    ('DIRECTION', 'document.delete'),
    ('DIRECTION', 'audit.read'),
    ('DIRECTION', 'dashboard.view_all'),
    ('DIRECTION', 'export.generate'),

    ('COMPTA_MANAGER', 'obligation.read'),
    ('COMPTA_MANAGER', 'occurrence.read'),
    ('COMPTA_MANAGER', 'occurrence.write'),
    ('COMPTA_MANAGER', 'occurrence.assign'),
    ('COMPTA_MANAGER', 'occurrence.submit'),
    ('COMPTA_MANAGER', 'occurrence.validate'),
    ('COMPTA_MANAGER', 'occurrence.mark_na'),
    ('COMPTA_MANAGER', 'document.read'),
    ('COMPTA_MANAGER', 'document.upload'),
    ('COMPTA_MANAGER', 'document.delete'),
    ('COMPTA_MANAGER', 'dashboard.view_all'),
    ('COMPTA_MANAGER', 'export.generate'),

    ('COMPTA_AGENT', 'obligation.read'),
    ('COMPTA_AGENT', 'occurrence.read'),
    ('COMPTA_AGENT', 'occurrence.write'),
    ('COMPTA_AGENT', 'occurrence.submit'),
    ('COMPTA_AGENT', 'document.read'),
    ('COMPTA_AGENT', 'document.upload'),

    ('RH_MANAGER', 'obligation.read'),
    ('RH_MANAGER', 'occurrence.read'),
    ('RH_MANAGER', 'occurrence.write'),
    ('RH_MANAGER', 'occurrence.assign'),
    ('RH_MANAGER', 'occurrence.submit'),
    ('RH_MANAGER', 'occurrence.validate'),
    ('RH_MANAGER', 'occurrence.mark_na'),
    ('RH_MANAGER', 'document.read'),
    ('RH_MANAGER', 'document.upload'),
    ('RH_MANAGER', 'document.delete'),
    ('RH_MANAGER', 'dashboard.view_all'),
    ('RH_MANAGER', 'export.generate'),

    ('RH_AGENT', 'obligation.read'),
    ('RH_AGENT', 'occurrence.read'),
    ('RH_AGENT', 'occurrence.write'),
    ('RH_AGENT', 'occurrence.submit'),
    ('RH_AGENT', 'document.read'),
    ('RH_AGENT', 'document.upload'),

    -- REGLEMENTAIRE : pas de occurrence.validate, la validation revient à la DIRECTION.
    ('REGLEMENTAIRE', 'obligation.read'),
    ('REGLEMENTAIRE', 'occurrence.read'),
    ('REGLEMENTAIRE', 'occurrence.write'),
    ('REGLEMENTAIRE', 'occurrence.submit'),
    ('REGLEMENTAIRE', 'occurrence.mark_na'),
    ('REGLEMENTAIRE', 'document.read'),
    ('REGLEMENTAIRE', 'document.upload'),
    ('REGLEMENTAIRE', 'document.delete'),
    ('REGLEMENTAIRE', 'dashboard.view_all'),
    ('REGLEMENTAIRE', 'export.generate'),

    -- AUDITOR : lecture seule, aucune écriture d'aucune sorte.
    ('AUDITOR', 'obligation.read'),
    ('AUDITOR', 'occurrence.read'),
    ('AUDITOR', 'document.read'),
    ('AUDITOR', 'audit.read'),
    ('AUDITOR', 'dashboard.view_all'),
    ('AUDITOR', 'export.generate'),

    -- EXTERNAL : dépose des pièces, ne voit rien d'autre.
    ('EXTERNAL', 'obligation.read'),
    ('EXTERNAL', 'occurrence.read'),
    ('EXTERNAL', 'document.read'),
    ('EXTERNAL', 'document.upload')
) as matrix (role_code, permission_code) on matrix.role_code = r.code
join public.permissions p on p.code = matrix.permission_code;

-- =============================================================================
-- 5. FONCTIONS D'AUTORISATION
--
--    SECURITY DEFINER : elles doivent lire user_roles et role_permissions, qui
--    sont elles-mêmes protégées par RLS. Sans cela, chaque politique déclencherait
--    une récursion sur les tables d'habilitation.
--    SET search_path = '' : une fonction SECURITY DEFINER dont le chemin de
--    recherche est modifiable par l'appelant est une élévation de privilège.
--    Tous les noms sont donc qualifiés intégralement.
--
--    ⚠️ Ces fonctions vivent dans `public` et non dans `auth`, contrairement à
--    l'intention initiale. Ce n'est pas un choix : sur Supabase, le schéma `auth`
--    appartient à `supabase_admin` et le rôle qui applique les migrations
--    (`postgres`, non superutilisateur) n'y a pas le droit CREATE —
--    « permission denied for schema auth ». Seule la pose d'un trigger sur
--    `auth.users` est autorisée, et elle est utilisée plus haut.
--    `auth.uid()` reste appelable : c'est la lecture du schéma qui est permise,
--    pas son extension.
-- =============================================================================

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null;
$$;

comment on function public.current_profile_id() is
  'Profil de l''utilisateur courant, ou NULL. Un compte supprimé logiquement n''a plus '
  'de profil courant : toutes les politiques s''effondrent alors sur NULL, donc sur refus.';

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.deleted_at is null
      and p.deactivated_at is null
  );
$$;

comment on function public.is_active_user() is
  'Premier filtre de toute politique. Un compte désactivé ne lit rien, quels que soient '
  'ses rôles : la désactivation prime sur l''habilitation.';

-- Identités dont l'utilisateur courant porte les droits : lui-même, plus les
-- personnes qui lui ont délégué leur validation sur une période active.
create or replace function public.effective_principals()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid()
  union
  select d.delegator_id
  from public.validation_delegations d
  where d.delegate_id = auth.uid()
    and d.revoked_at is null
    and current_date between d.starts_at and d.ends_at;
$$;

comment on function public.effective_principals() is
  'Utilisateur courant et ses délégants actifs. Une délégation prête des droits ; elle '
  'n''efface pas l''auteur réel, qui reste actor_id dans le journal.';

create or replace function public.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id in (select public.effective_principals())
      and p.code = perm
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  ) and public.is_active_user();
$$;

comment on function public.has_permission(text) is
  'Vrai si l''utilisateur détient la permission, toutes portées confondues. Les '
  'attributions révoquées ou expirées sont ignorées — une habilitation périmée '
  'n''accorde plus rien, sans qu''aucun traitement de nettoyage n''ait à passer.';

create or replace function public.has_permission_in_domain(perm text, target_domain uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id in (select public.effective_principals())
      and p.code = perm
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
      -- Une attribution de portée globale satisfait toute vérification de domaine.
      and (ur.domain_id is null or ur.domain_id = target_domain)
  ) and public.is_active_user();
$$;

comment on function public.has_permission_in_domain(text, uuid) is
  'Vérification de permission bornée à un domaine. Une attribution sans domaine (portée '
  'globale) satisfait n''importe quel domaine ; l''inverse est faux.';

create or replace function public.accessible_domains()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Portée globale : tous les domaines.
  select d.id
  from public.domains d
  where exists (
    select 1
    from public.user_roles ur
    where ur.user_id in (select public.effective_principals())
      and ur.domain_id is null
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  )
  union
  select ur.domain_id
  from public.user_roles ur
  where ur.user_id in (select public.effective_principals())
    and ur.domain_id is not null
    and ur.revoked_at is null
    and (ur.expires_at is null or ur.expires_at > now());
$$;

comment on function public.accessible_domains() is
  'Domaines visibles par l''utilisateur. Sert au cloisonnement du référentiel.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.code = 'ADMIN'
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  ) and public.is_active_user();
$$;

comment on function public.is_admin() is
  'Appartenance au rôle ADMIN. ⚠️ N''ouvre AUCUN accès au contenu métier : ADMIN ne '
  'détient ni occurrence.read ni document.read. Cette fonction sert à l''administration '
  'des comptes et du référentiel, jamais à contourner un cloisonnement de domaine. '
  'Volontairement calculée sur auth.uid() seul : une délégation ne délègue pas ADMIN.';

-- -----------------------------------------------------------------------------
-- Domaine d'une obligation, lu hors RLS.
-- Sans cette fonction, la politique de obligation_occurrences interrogerait
-- obligation_types en appliquant SA propre RLS : le cloisonnement dépendrait
-- alors de l'ordre d'évaluation de deux politiques.
-- -----------------------------------------------------------------------------

create or replace function public.obligation_domain_of_type(type_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ot.domain_id from public.obligation_types ot where ot.id = type_id;
$$;

create or replace function public.obligation_domain_of_occurrence(occurrence_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ot.domain_id
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.id = occurrence_id;
$$;

-- -----------------------------------------------------------------------------
-- Jours ouvrés côté base, pour le filet de sécurité de validation.
-- -----------------------------------------------------------------------------

create or replace function public.add_business_days(from_date date, day_count int)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cursor_date date := from_date;
  remaining int := day_count;
  weekend int[];
begin
  select s.weekend_days into weekend from public.app_settings s limit 1;

  while remaining > 0 loop
    cursor_date := cursor_date + 1;
    if not (extract(dow from cursor_date)::int = any (weekend))
       and not exists (
         select 1
         from public.holidays h
         where h.holiday_date = cursor_date
            or (h.is_recurring
                and to_char(h.holiday_date, 'MM-DD') = to_char(cursor_date, 'MM-DD'))
       )
    then
      remaining := remaining - 1;
    end if;
  end loop;

  return cursor_date;
end;
$$;

comment on function public.add_business_days(date, int) is
  'Ajoute des jours ouvrés en tenant compte du week-end (app_settings.weekend_days) et '
  'des jours fériés, récurrents compris. Aucun jour n''est codé en dur.';

create or replace function public.can_validate_occurrence(occurrence_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  occ public.obligation_occurrences%rowtype;
  occ_domain uuid;
  fallback_days int;
begin
  select * into occ from public.obligation_occurrences where id = occurrence_id;
  if not found then
    return false;
  end if;

  occ_domain := public.obligation_domain_of_type(occ.obligation_type_id);

  -- Chaîne nominale : permission de validation sur le domaine concerné.
  if public.has_permission_in_domain('occurrence.validate', occ_domain) then
    return true;
  end if;

  -- Filet de sécurité : passé le délai, la DIRECTION débloque, quelle que soit la
  -- chaîne prévue. Un dossier ne doit jamais rester bloqué parce que la seule
  -- personne habilitée est absente. Implémenté ici, et non dans l'interface :
  -- une règle d'autorisation qui vit dans le client n'est pas une règle.
  if occ.status = 'PENDING_VALIDATION' and occ.submitted_for_validation_at is not null then
    select s.validation_fallback_business_days into fallback_days
    from public.app_settings s limit 1;

    if current_date > public.add_business_days(
         occ.submitted_for_validation_at::date, fallback_days)
       and exists (
         select 1
         from public.user_roles ur
         join public.roles r on r.id = ur.role_id
         where ur.user_id = auth.uid()
           and r.code = 'DIRECTION'
           and ur.revoked_at is null
           and (ur.expires_at is null or ur.expires_at > now())
       )
       and public.is_active_user()
    then
      return true;
    end if;
  end if;

  return false;
end;
$$;

comment on function public.can_validate_occurrence(uuid) is
  'Droit de valider UNE occurrence précise : chaîne nominale, ou filet de sécurité '
  'DIRECTION passé le délai d''attente configuré.';

-- =============================================================================
-- 6. CONTRAINTES STRUCTURELLES
-- =============================================================================

create or replace function public.enforce_separation_of_duties()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allow_global boolean;
  allow_for_type boolean;
  actor uuid;
begin
  if new.status <> 'VALIDATED' or old.status = 'VALIDATED' then
    return new;
  end if;

  actor := public.current_profile_id();
  if actor is null or new.owner_id is null or actor <> new.owner_id then
    return new;
  end if;

  select s.allow_self_validation into allow_global from public.app_settings s limit 1;
  select ot.allow_self_validation into allow_for_type
  from public.obligation_types ot
  where ot.id = new.obligation_type_id;

  if coalesce(allow_global, false) or coalesce(allow_for_type, false) then
    return new;
  end if;

  raise exception
    'Séparation des tâches : le préparateur d''une occurrence ne peut pas la valider.'
    using errcode = '42501',
          hint = 'Faire valider par un tiers, ou lever l''interdiction sur cette obligation.';
end;
$$;

comment on function public.enforce_separation_of_duties() is
  'Interdit à un préparateur de valider son propre dossier. Levée possible globalement '
  '(app_settings) ou obligation par obligation — jamais au cas par cas dans le code.';

create trigger trg_occurrences_25_separation_of_duties
  before update on public.obligation_occurrences
  for each row execute function public.enforce_separation_of_duties();

-- -----------------------------------------------------------------------------

create or replace function public.prevent_self_role_modification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  actor uuid;
begin
  target := coalesce(new.user_id, old.user_id);
  actor := auth.uid();

  -- actor NULL = exécution hors session (migration, job) : la règle ne vise que
  -- l'auto-attribution par un utilisateur connecté.
  if actor is null or target is null or actor <> target then
    return coalesce(new, old);
  end if;

  raise exception 'Un utilisateur ne peut pas modifier ses propres habilitations.'
    using errcode = '42501',
          hint = 'Faire intervenir un autre porteur de role.manage.';
end;
$$;

comment on function public.prevent_self_role_modification() is
  'Empêche l''auto-attribution de droits, y compris par un administrateur. Sans cette '
  'règle, role.manage vaudrait toutes les permissions.';

create trigger trg_user_roles_no_self_modification
  before insert or update or delete on public.user_roles
  for each row execute function public.prevent_self_role_modification();

-- -----------------------------------------------------------------------------

create or replace function public.enforce_role_max_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_days int;
  role_code text;
begin
  select r.max_duration_days, r.code into max_days, role_code
  from public.roles r where r.id = new.role_id;

  if max_days is null then
    return new;
  end if;

  if new.expires_at is null then
    raise exception 'Le rôle % exige une date d''expiration (maximum % jours).',
      role_code, max_days
      using errcode = '23514';
  end if;

  if new.expires_at > new.granted_at + make_interval(days => max_days) then
    raise exception 'Le rôle % est limité à % jours ; expiration demandée : %.',
      role_code, max_days, new.expires_at
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_role_max_duration() is
  'Impose une expiration bornée aux rôles temporaires (AUDITOR 90 j, EXTERNAL 365 j). '
  'La borne est une donnée de roles.max_duration_days, pas une constante du code.';

create trigger trg_user_roles_max_duration
  before insert or update on public.user_roles
  for each row execute function public.enforce_role_max_duration();

-- Horodatage
create trigger trg_app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 7. RLS — ACTIVATION SUR 100 % DES TABLES
--    Aucune exception, y compris les tables de référence et de nomenclature.
--    Activer la RLS sans politique = tout est refusé. C'est la position de repli
--    voulue : on ouvre ensuite, explicitement, opération par opération.
-- =============================================================================

alter table public.entities                     enable row level security;
alter table public.departments                  enable row level security;
alter table public.profiles                     enable row level security;
alter table public.domains                      enable row level security;
alter table public.authorities                  enable row level security;
alter table public.holidays                     enable row level security;
alter table public.obligation_types             enable row level security;
alter table public.obligation_required_documents enable row level security;
alter table public.obligation_occurrences       enable row level security;
alter table public.occurrence_checklist_items   enable row level security;
alter table public.occurrence_transitions       enable row level security;
alter table public.occurrence_comments          enable row level security;
alter table public.status_transition_rules      enable row level security;
alter table public.app_settings                 enable row level security;
alter table public.roles                        enable row level security;
alter table public.permissions                  enable row level security;
alter table public.role_permissions             enable row level security;
alter table public.user_roles                   enable row level security;
alter table public.validation_delegations       enable row level security;

-- -----------------------------------------------------------------------------
-- 7.1 Nomenclatures : lisibles par tout utilisateur actif, écrites par le
--     référentiel seul.
-- -----------------------------------------------------------------------------

create policy entities_select on public.entities
  for select to authenticated using (public.is_active_user());
comment on policy entities_select on public.entities is
  'Le périmètre des entités est une information de structure, lisible par tout compte actif.';

create policy entities_insert on public.entities
  for insert to authenticated with check (public.has_permission('settings.manage'));
comment on policy entities_insert on public.entities is
  'Créer une entité relève du paramétrage de l''installation.';

create policy entities_update on public.entities
  for update to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));
comment on policy entities_update on public.entities is
  'Idem création. Aucune politique DELETE : une entité ne se supprime pas.';

create policy departments_select on public.departments
  for select to authenticated using (public.is_active_user());
comment on policy departments_select on public.departments is
  'Organigramme des services, nécessaire à l''affectation.';

create policy departments_insert on public.departments
  for insert to authenticated with check (public.has_permission('referential.manage'));
comment on policy departments_insert on public.departments is
  'Structure des services : referential.manage.';

create policy departments_update on public.departments
  for update to authenticated
  using (public.has_permission('referential.manage'))
  with check (public.has_permission('referential.manage'));
comment on policy departments_update on public.departments is
  'Structure des services : referential.manage. Pas de DELETE.';

create policy domains_select on public.domains
  for select to authenticated using (public.is_active_user());
comment on policy domains_select on public.domains is
  'Nomenclature des domaines. Connaître les domaines n''équivaut pas à voir leur contenu.';

create policy domains_insert on public.domains
  for insert to authenticated with check (public.has_permission('referential.manage'));
comment on policy domains_insert on public.domains is 'Nomenclature : referential.manage.';

create policy domains_update on public.domains
  for update to authenticated
  using (public.has_permission('referential.manage'))
  with check (public.has_permission('referential.manage'));
comment on policy domains_update on public.domains is 'Nomenclature : referential.manage.';

create policy authorities_select on public.authorities
  for select to authenticated using (public.is_active_user());
comment on policy authorities_select on public.authorities is
  'Coordonnées des administrations, utiles à tout agent traitant un dossier.';

create policy authorities_insert on public.authorities
  for insert to authenticated with check (public.has_permission('referential.manage'));
comment on policy authorities_insert on public.authorities is 'Référentiel : referential.manage.';

create policy authorities_update on public.authorities
  for update to authenticated
  using (public.has_permission('referential.manage'))
  with check (public.has_permission('referential.manage'));
comment on policy authorities_update on public.authorities is 'Référentiel : referential.manage.';

create policy holidays_select on public.holidays
  for select to authenticated using (public.is_active_user());
comment on policy holidays_select on public.holidays is
  'Calendrier des jours fériés : il conditionne l''affichage des échéances de chacun.';

create policy holidays_insert on public.holidays
  for insert to authenticated with check (public.has_permission('referential.manage'));
comment on policy holidays_insert on public.holidays is 'Calendrier : referential.manage.';

create policy holidays_update on public.holidays
  for update to authenticated
  using (public.has_permission('referential.manage'))
  with check (public.has_permission('referential.manage'));
comment on policy holidays_update on public.holidays is 'Calendrier : referential.manage.';

create policy status_transition_rules_select on public.status_transition_rules
  for select to authenticated using (public.is_active_user());
comment on policy status_transition_rules_select on public.status_transition_rules is
  'La machine à états doit être lisible pour que l''interface propose les bonnes actions.';

create policy status_transition_rules_insert on public.status_transition_rules
  for insert to authenticated with check (public.has_permission('settings.manage'));
comment on policy status_transition_rules_insert on public.status_transition_rules is
  'Modifier le workflow est un acte de paramétrage lourd : settings.manage.';

create policy status_transition_rules_update on public.status_transition_rules
  for update to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));
comment on policy status_transition_rules_update on public.status_transition_rules is
  'Idem insertion. Aucune politique DELETE : un chemin de workflow se désactive, ne se supprime pas.';

create policy app_settings_select on public.app_settings
  for select to authenticated using (public.is_active_user());
comment on policy app_settings_select on public.app_settings is
  'Les réglages conditionnent l''interface ; ils ne contiennent aucun secret.';

create policy app_settings_update on public.app_settings
  for update to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));
comment on policy app_settings_update on public.app_settings is
  'Réglages : settings.manage. Ni INSERT ni DELETE — la table est un singleton.';

-- -----------------------------------------------------------------------------
-- 7.2 Habilitations
-- -----------------------------------------------------------------------------

create policy roles_select on public.roles
  for select to authenticated using (public.is_active_user());
comment on policy roles_select on public.roles is
  'Le catalogue des rôles est lisible : savoir qu''un rôle existe n''accorde rien.';

create policy roles_insert on public.roles
  for insert to authenticated with check (public.has_permission('role.manage'));
comment on policy roles_insert on public.roles is 'Création de rôle : role.manage.';

create policy roles_update on public.roles
  for update to authenticated
  using (public.has_permission('role.manage') and not is_system)
  with check (public.has_permission('role.manage') and not is_system);
comment on policy roles_update on public.roles is
  'Les rôles système sont immuables : leur matrice est une décision de sécurité arrêtée, '
  'pas un paramètre d''exploitation.';

create policy permissions_select on public.permissions
  for select to authenticated using (public.is_active_user());
comment on policy permissions_select on public.permissions is
  'Vocabulaire des permissions, nécessaire à l''affichage des écrans d''administration.';

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (public.is_active_user());
comment on policy role_permissions_select on public.role_permissions is
  'La matrice est lisible : l''utilisateur doit pouvoir comprendre ses propres droits. '
  'Aucune politique d''écriture — la matrice des rôles système ne se modifie pas à chaud.';

create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    public.is_active_user()
    and (public.has_permission('user.manage') or user_id = public.current_profile_id())
  );
comment on policy user_roles_select on public.user_roles is
  'Chacun voit ses propres habilitations ; les gestionnaires de comptes voient toutes '
  'les attributions.';

create policy user_roles_insert on public.user_roles
  for insert to authenticated with check (public.has_permission('role.manage'));
comment on policy user_roles_insert on public.user_roles is
  'Attribuer un rôle : role.manage. Le trigger prevent_self_role_modification interdit '
  'en outre l''auto-attribution.';

create policy user_roles_update on public.user_roles
  for update to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));
comment on policy user_roles_update on public.user_roles is
  'La révocation est un UPDATE de revoked_at. Aucune politique DELETE : une habilitation '
  'passée doit rester reconstituable.';

create policy validation_delegations_select on public.validation_delegations
  for select to authenticated
  using (
    public.is_active_user()
    and (
      delegator_id = public.current_profile_id()
      or delegate_id = public.current_profile_id()
      or public.has_permission('user.manage')
    )
  );
comment on policy validation_delegations_select on public.validation_delegations is
  'Une délégation est visible de ses deux parties et des gestionnaires de comptes.';

create policy validation_delegations_insert on public.validation_delegations
  for insert to authenticated
  with check (
    public.is_active_user()
    and delegator_id = public.current_profile_id()
    and delegate_id <> public.current_profile_id()
  );
comment on policy validation_delegations_insert on public.validation_delegations is
  'On ne délègue que ses propres droits, et jamais à soi-même. Déléguer à sa place '
  'quelqu''un d''autre serait une attribution déguisée.';

create policy validation_delegations_update on public.validation_delegations
  for update to authenticated
  using (
    public.is_active_user()
    and (delegator_id = public.current_profile_id() or public.has_permission('user.manage'))
  )
  with check (
    public.is_active_user()
    and (delegator_id = public.current_profile_id() or public.has_permission('user.manage'))
  );
comment on policy validation_delegations_update on public.validation_delegations is
  'Révocation par le délégant ou l''administration. Pas de DELETE : la délégation '
  'passée reste une pièce d''audit.';

-- -----------------------------------------------------------------------------
-- 7.3 Profils
-- -----------------------------------------------------------------------------

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.is_active_user()
    and (
      id = public.current_profile_id()
      or public.has_permission('user.manage')
      or exists (
        select 1
        from public.obligation_occurrences oc
        where (oc.owner_id = public.profiles.id or oc.validator_id = public.profiles.id)
          and (
            public.has_permission_in_domain(
              'occurrence.read',
              public.obligation_domain_of_type(oc.obligation_type_id)
            )
            or oc.owner_id = public.current_profile_id()
            or oc.validator_id = public.current_profile_id()
          )
      )
    )
  );
comment on policy profiles_select on public.profiles is
  'Son propre profil ; tous les profils pour user.manage ; sinon uniquement les personnes '
  'intervenant sur une occurrence déjà visible — savoir QUI traite un dossier suppose de '
  'pouvoir voir ce dossier. ⚠️ La restriction « nom seulement » ne peut pas être exprimée '
  'par une politique de ligne : la RLS filtre des lignes, pas des colonnes. Elle est '
  'portée par la vue public.profile_directory, à préférer pour tout affichage de tiers.';

create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_active_user() and id = public.current_profile_id())
  with check (public.is_active_user() and id = public.current_profile_id());
comment on policy profiles_update on public.profiles is
  'Chacun modifie son propre profil. Les colonnes sensibles (is_active, deactivated_at, '
  'entity_id, department_id) sont verrouillées par le trigger protect_profile_columns : '
  'une politique de ligne ne sait pas distinguer les colonnes écrites.';

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Hors session (migration, job d'offboarding, script de src/server/jobs/) :
  -- la règle ne vise que ce qu'un utilisateur connecté écrit sur son propre profil.
  if auth.uid() is null then
    return new;
  end if;

  -- L'administration des comptes conserve la main.
  if public.has_permission('user.manage') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.is_active is distinct from old.is_active
     or new.deactivated_at is distinct from old.deactivated_at
     or new.deactivated_by is distinct from old.deactivated_by
     or new.entity_id is distinct from old.entity_id
     or new.department_id is distinct from old.department_id
     or new.email is distinct from old.email
     or new.deleted_at is distinct from old.deleted_at
     or new.mfa_enrolled is distinct from old.mfa_enrolled
  then
    raise exception 'Champ de profil réservé à l''administration des comptes.'
      using errcode = '42501',
            hint = 'Seuls le nom, le téléphone et l''intitulé de poste sont modifiables par l''intéressé.';
  end if;

  return new;
end;
$$;

comment on function public.protect_profile_columns() is
  'Restriction colonne par colonne du profil. La RLS filtre des lignes ; interdire '
  'l''écriture de is_active ou des rattachements demande un trigger.';

create trigger trg_profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

create view public.profile_directory
  with (security_invoker = true)
  as select p.id, p.full_name, p.job_title, p.department_id
     from public.profiles p
     where p.deleted_at is null;

comment on view public.profile_directory is
  'Annuaire réduit — identité d''affichage sans coordonnées. security_invoker : la '
  'politique de public.profiles s''applique à travers la vue, elle n''est pas contournée.';

-- -----------------------------------------------------------------------------
-- 7.4 Référentiel des obligations
-- -----------------------------------------------------------------------------

create policy obligation_types_select on public.obligation_types
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or (
        public.has_permission('obligation.read')
        and (domain_id is null or domain_id in (select public.accessible_domains()))
      )
    )
  );
comment on policy obligation_types_select on public.obligation_types is
  'Le référentiel est cloisonné par domaine, comme les occurrences. ADMIN y accède au '
  'titre de referential.manage — et n''y trouve aucune donnée de dossier.';

create policy obligation_types_insert on public.obligation_types
  for insert to authenticated with check (public.has_permission('referential.manage'));
comment on policy obligation_types_insert on public.obligation_types is
  'Ajouter une obligation est une écriture de référentiel : referential.manage.';

create policy obligation_types_update on public.obligation_types
  for update to authenticated
  using (public.has_permission('referential.manage'))
  with check (public.has_permission('referential.manage'));
comment on policy obligation_types_update on public.obligation_types is
  'Idem insertion. Aucune politique DELETE : une obligation s''abroge par effective_to '
  'ou deleted_at, elle ne disparaît pas — ses occurrences passées doivent rester lisibles.';

create policy obligation_required_documents_select on public.obligation_required_documents
  for select to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1 from public.obligation_types ot
      where ot.id = obligation_type_id
        and (
          public.is_admin()
          or (
            public.has_permission('obligation.read')
            and (ot.domain_id is null or ot.domain_id in (select public.accessible_domains()))
          )
        )
    )
  );
comment on policy obligation_required_documents_select on public.obligation_required_documents is
  'Visible avec l''obligation qu''elle décrit : même cloisonnement de domaine.';

create policy obligation_required_documents_insert on public.obligation_required_documents
  for insert to authenticated with check (public.has_permission('referential.manage'));
comment on policy obligation_required_documents_insert on public.obligation_required_documents is
  'Description du référentiel : referential.manage.';

create policy obligation_required_documents_update on public.obligation_required_documents
  for update to authenticated
  using (public.has_permission('referential.manage'))
  with check (public.has_permission('referential.manage'));
comment on policy obligation_required_documents_update on public.obligation_required_documents is
  'Idem insertion.';

create policy obligation_required_documents_delete on public.obligation_required_documents
  for delete to authenticated using (public.has_permission('referential.manage'));
comment on policy obligation_required_documents_delete on public.obligation_required_documents is
  'Seule table du référentiel réellement supprimable : elle ne décrit qu''une attente, '
  'et ne porte ni dossier ni trace d''audit.';

-- -----------------------------------------------------------------------------
-- 7.5 Occurrences — CLOISONNEMENT COMPLET ENTRE DOMAINES
-- -----------------------------------------------------------------------------

create policy obligation_occurrences_select on public.obligation_occurrences
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission_in_domain(
        'occurrence.read',
        public.obligation_domain_of_type(obligation_type_id)
      )
      or owner_id = public.current_profile_id()
      or validator_id = public.current_profile_id()
    )
  );
comment on policy obligation_occurrences_select on public.obligation_occurrences is
  '⚠️ CLOISONNEMENT COMPLET ENTRE DOMAINES. Un utilisateur RH ne voit PAS l''existence '
  'des occurrences fiscales : ni en liste, ni en compteur, ni en recherche. Le filtre '
  'étant porté par la RLS, un COUNT(*) ne peut pas davantage révéler leur nombre qu''un '
  'SELECT ne peut révéler leur contenu. Décision arrêtée. '
  'ADMIN n''apparaît nulle part ici : il ne détient pas occurrence.read.';

create policy obligation_occurrences_insert on public.obligation_occurrences
  for insert to authenticated
  with check (
    public.has_permission_in_domain(
      'occurrence.write',
      public.obligation_domain_of_type(obligation_type_id)
    )
  );
comment on policy obligation_occurrences_insert on public.obligation_occurrences is
  'Création manuelle réservée au domaine concerné. Le flux nominal passe par le job de '
  'génération, qui s''exécute en service_role.';

create policy obligation_occurrences_update on public.obligation_occurrences
  for update to authenticated
  using (
    public.has_permission_in_domain(
      'occurrence.write',
      public.obligation_domain_of_type(obligation_type_id)
    )
    and is_locked = false
  )
  with check (
    public.has_permission_in_domain(
      'occurrence.write',
      public.obligation_domain_of_type(obligation_type_id)
    )
  );
comment on policy obligation_occurrences_update on public.obligation_occurrences is
  'Écriture dans son domaine, sur un dossier non verrouillé. Le verrou est doublé par le '
  'trigger enforce_occurrence_lock : la politique protège du client, le trigger protège '
  'aussi des jobs. Aucune politique DELETE : une occurrence ne se supprime pas.';

create policy occurrence_checklist_items_select on public.occurrence_checklist_items
  for select to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1 from public.obligation_occurrences oc where oc.id = occurrence_id
    )
  );
comment on policy occurrence_checklist_items_select on public.occurrence_checklist_items is
  'Visible si l''occurrence parente l''est : le EXISTS traverse la politique de '
  'obligation_occurrences, qui applique le cloisonnement de domaine.';

create policy occurrence_checklist_items_insert on public.occurrence_checklist_items
  for insert to authenticated
  with check (
    public.has_permission_in_domain(
      'occurrence.write',
      public.obligation_domain_of_occurrence(occurrence_id)
    )
  );
comment on policy occurrence_checklist_items_insert on public.occurrence_checklist_items is
  'Écriture dans le domaine de l''occurrence parente.';

create policy occurrence_checklist_items_update on public.occurrence_checklist_items
  for update to authenticated
  using (
    public.has_permission_in_domain(
      'occurrence.write',
      public.obligation_domain_of_occurrence(occurrence_id)
    )
  )
  with check (
    public.has_permission_in_domain(
      'occurrence.write',
      public.obligation_domain_of_occurrence(occurrence_id)
    )
  );
comment on policy occurrence_checklist_items_update on public.occurrence_checklist_items is
  'Cocher une pièce est une écriture métier : même permission que le dossier.';

create policy occurrence_comments_select on public.occurrence_comments
  for select to authenticated
  using (
    public.is_active_user()
    and deleted_at is null
    and exists (
      select 1 from public.obligation_occurrences oc where oc.id = occurrence_id
    )
  );
comment on policy occurrence_comments_select on public.occurrence_comments is
  'Visible avec l''occurrence parente. Un commentaire peut citer un montant ou une '
  'difficulté : il suit exactement le cloisonnement du dossier.';

create policy occurrence_comments_insert on public.occurrence_comments
  for insert to authenticated
  with check (
    public.is_active_user()
    and author_id = public.current_profile_id()
    and exists (select 1 from public.obligation_occurrences oc where oc.id = occurrence_id)
  );
comment on policy occurrence_comments_insert on public.occurrence_comments is
  'On commente sous son propre nom, sur un dossier qu''on voit.';

create policy occurrence_comments_update on public.occurrence_comments
  for update to authenticated
  using (public.is_active_user() and author_id = public.current_profile_id())
  with check (public.is_active_user() and author_id = public.current_profile_id());
comment on policy occurrence_comments_update on public.occurrence_comments is
  'Chacun corrige ses propres commentaires — la suppression est logique (deleted_at). '
  'Aucune politique DELETE.';

-- -----------------------------------------------------------------------------
-- 7.6 Journal des transitions — LECTURE SEULE, DÉFINITIVEMENT
-- -----------------------------------------------------------------------------

create policy occurrence_transitions_select on public.occurrence_transitions
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('audit.read')
      or exists (select 1 from public.obligation_occurrences oc where oc.id = occurrence_id)
    )
  );
comment on policy occurrence_transitions_select on public.occurrence_transitions is
  'Journal lisible par les auditeurs, et par quiconque voit déjà l''occurrence concernée.';

-- Pas de politique INSERT : les lignes ne naissent que du trigger
-- record_status_transition(), qui s'exécute en SECURITY DEFINER.
-- Pas de politique UPDATE ni DELETE, et les privilèges sont retirés en plus :
-- la RLS ne s'applique pas à service_role, le REVOKE si.
revoke update, delete on public.occurrence_transitions from public;
revoke update, delete on public.occurrence_transitions from anon;
revoke update, delete on public.occurrence_transitions from authenticated;
revoke update, delete on public.occurrence_transitions from service_role;

comment on table public.occurrence_transitions is
  'Historique des changements d''état. APPEND-ONLY, garanti par trois mécanismes '
  'indépendants : absence de politique RLS, REVOKE UPDATE/DELETE y compris pour '
  'service_role, et trigger reject_mutation() qui lève même pour un superutilisateur. '
  'Aucun ON DELETE CASCADE ne pointe vers cette table.';

-- =============================================================================
-- 8. PRIVILÈGES DE BASE
--    La RLS ne remplace pas les privilèges : une table sans GRANT est
--    inaccessible quelles que soient ses politiques, et inversement.
-- =============================================================================

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on
  public.profiles,
  public.obligation_types,
  public.obligation_required_documents,
  public.obligation_occurrences,
  public.occurrence_checklist_items,
  public.occurrence_comments,
  public.user_roles,
  public.validation_delegations,
  public.roles,
  public.entities,
  public.departments,
  public.domains,
  public.authorities,
  public.holidays,
  public.status_transition_rules,
  public.app_settings
to authenticated;
grant delete on public.obligation_required_documents to authenticated;

-- Le journal reste en lecture seule pour tout le monde.
revoke insert on public.occurrence_transitions from authenticated;

grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_permission_in_domain(text, uuid) to authenticated;
grant execute on function public.accessible_domains() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.effective_principals() to authenticated;
grant execute on function public.can_validate_occurrence(uuid) to authenticated;
grant execute on function public.obligation_domain_of_type(uuid) to authenticated;
grant execute on function public.obligation_domain_of_occurrence(uuid) to authenticated;
grant execute on function public.add_business_days(date, int) to authenticated;

-- =============================================================================
-- 9. REPRISE DES TRIGGERS DE 0001 SOUS RLS
--
--    Deux corrections indispensables, impossibles à anticiper en 0001 puisque
--    la RLS n'existait pas encore :
--
--    a) `record_status_transition()` écrit dans occurrence_transitions, table qui
--       n'a désormais AUCUNE politique INSERT et dont le privilège INSERT est
--       retiré. Sans SECURITY DEFINER, le journal d'audit cesserait d'être écrit
--       — silencieusement, puisque l'échec surviendrait sur chaque transition.
--
--    b) `validate_status_transition()` ne vérifiait que l'existence de la
--       transition et la présence d'un motif. Elle ignorait
--       `status_transition_rules.required_permission`, qui n'était donc appliquée
--       nulle part : un COMPTA_AGENT, porteur de occurrence.write, pouvait passer
--       un dossier à VALIDATED sans détenir occurrence.validate.
-- =============================================================================

create or replace function public.record_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_status public.occurrence_status;
begin
  if tg_op = 'INSERT' then
    previous_status := null;
  else
    if new.status is not distinct from old.status then
      return null;
    end if;
    previous_status := old.status;
  end if;

  insert into public.occurrence_transitions
    (occurrence_id, from_status, to_status, actor_id, on_behalf_of_id, reason, metadata)
  values (
    new.id,
    previous_status,
    new.status,
    public.app_actor_id(),
    -- Action sous délégation : on conserve le délégant, sans effacer l'auteur réel.
    (
      select d.delegator_id
      from public.validation_delegations d
      where d.delegate_id = auth.uid()
        and d.revoked_at is null
        and current_date between d.starts_at and d.ends_at
      limit 1
    ),
    coalesce(
      public.app_transition_reason(),
      case new.status
        when 'NOT_APPLICABLE' then new.na_reason
        when 'REJECTED' then new.rejection_reason
        else null
      end
    ),
    jsonb_build_object('origin', case when tg_op = 'INSERT' then 'CREATION' else 'TRANSITION' end)
  );

  return null;
end;
$$;

comment on function public.record_status_transition() is
  'Écrit le journal d''état, en SECURITY DEFINER : la table n''accepte aucune écriture '
  'directe, pas même de service_role. Renseigne on_behalf_of_id quand l''auteur agit '
  'sous délégation active.';

create or replace function public.validate_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.status_transition_rules%rowtype;
  resolved_reason text;
  occ_domain uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into rule
    from public.status_transition_rules
   where from_status = old.status
     and to_status = new.status;

  if not found then
    raise exception 'Transition interdite : % → %.', old.status, new.status
      using errcode = '23514',
            hint = 'Les transitions autorisées sont des données : voir public.status_transition_rules.';
  end if;

  -- Contrôle d'habilitation. Ignoré hors session (auth.uid() NULL) : les jobs de
  -- src/server/jobs/ et les migrations n'ont pas d'utilisateur, et sont déjà
  -- contraints par ailleurs. Un appel authentifié, lui, est toujours vérifié.
  if auth.uid() is not null then
    occ_domain := public.obligation_domain_of_type(new.obligation_type_id);

    if rule.required_permission = 'occurrence.validate' then
      -- Passe par can_validate_occurrence : elle intègre le filet DIRECTION.
      if not public.can_validate_occurrence(new.id) then
        raise exception 'Permission % requise pour la transition % → %.',
          rule.required_permission, old.status, new.status
          using errcode = '42501';
      end if;
    elsif not public.has_permission_in_domain(rule.required_permission, occ_domain) then
      raise exception 'Permission % requise pour la transition % → %.',
        rule.required_permission, old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  resolved_reason := coalesce(
    public.app_transition_reason(),
    case new.status
      when 'NOT_APPLICABLE' then new.na_reason
      when 'REJECTED' then new.rejection_reason
      else null
    end
  );

  if rule.requires_reason and (resolved_reason is null or btrim(resolved_reason) = '') then
    raise exception 'Motif obligatoire pour la transition % → %.', old.status, new.status
      using errcode = '23514',
            hint = 'Renseigner la colonne de motif, ou poser SET LOCAL conformia.transition_reason.';
  end if;

  if rule.locks_occurrence then
    new.is_locked := true;
    new.locked_at := now();
    new.locked_by := public.app_actor_id();
  end if;

  if old.status = 'ARCHIVED' and new.status = 'SUBMITTED' then
    new.is_locked := false;
    new.locked_at := null;
    new.locked_by := null;
  end if;

  return new;
end;
$$;

comment on function public.validate_status_transition() is
  'Autorise ou refuse un changement d''état : existence de la transition dans '
  'status_transition_rules, permission requise, motif obligatoire. AUCUNE transition '
  'et AUCUNE permission ne sont écrites en dur — les deux sont des données.';
