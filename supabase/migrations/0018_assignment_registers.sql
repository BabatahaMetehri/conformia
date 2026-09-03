-- =============================================================================
-- 0018 — TRIADE D'AFFECTATION ET REGISTRES DE COMMERCE
--
-- ⚠️ NUMÉROTÉE 0018, ET NON 0010 COMME DEMANDÉ.
--
-- `0010_workflow.sql` existe et est appliquée depuis plusieurs phases. Un
-- second fichier 0010 se trierait AVANT sept migrations déjà en base : la CLI
-- l'appliquerait hors séquence sur une installation neuve — donc avant les
-- tables qu'il modifie — et le refuserait sur une base existante. Le contenu
-- est celui demandé ; seul le rang change, parce qu'une migration appliquée est
-- immuable (CLAUDE.md §6).
--
-- Deux évolutions, un seul lot, parce qu'elles se croisent : la génération par
-- registre a besoin des colonnes d'affectation, et l'affectation par défaut se
-- lit sur l'obligation qui porte la portée.
-- =============================================================================

-- =============================================================================
-- PARTIE A — TRIADE D'AFFECTATION
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A.1 — RÔLES : la triade remplace la répartition par service
--
-- ⚠️ LES RÔLES PAR SERVICE SONT DÉSACTIVÉS, JAMAIS SUPPRIMÉS.
--
-- Trois raisons, dont la dernière est la plus contraignante :
--   • l'entreprise peut revenir à une répartition par service ;
--   • `user_roles` et `audit_log` portent leurs identifiants — supprimer une
--     ligne de `roles` effacerait la lisibilité de l'historique ;
--   • `protect_system_roles()` refuse la suppression d'un rôle système, et ces
--     cinq le sont.
-- -----------------------------------------------------------------------------

alter table public.roles
  add column if not exists is_active boolean not null default true;

comment on column public.roles.is_active is
  'Un rôle inactif reste DÉFINI mais n''est plus attribuable : les habilitations '
  'déjà accordées continuent de fonctionner, seule une nouvelle attribution est '
  'refusée. C''est ce qui permet de changer d''organisation sans réécrire '
  'l''historique ni casser les rôles en cours.';

/*
 * ⚠️ LA TRIADE HÉRITE DES PERMISSIONS DES RÔLES QU'ELLE REMPLACE.
 *
 * Sans permissions, un rôle ne donne accès à rien : la triade serait décorative
 * et l'organisation entière se retrouverait sans droits au premier redéploiement
 * des habilitations. La correspondance est celle-ci, et elle est délibérée :
 *
 *   RESPONSABLE ← COMPTA_AGENT / RH_AGENT   (préparer, déposer, soumettre)
 *   SUPPLEANT   ← les mêmes exactement       (il agit EN PERMANENCE, cf. A.4)
 *   SUPERVISEUR ← COMPTA_MANAGER / RH_MANAGER (valider, affecter, exporter)
 *
 * ⚠️ SUPPLEANT ET RESPONSABLE ONT LES MÊMES DROITS, ET C'EST LE POINT CENTRAL
 * DE CETTE PHASE. Un suppléant dont les droits dépendraient d'une déclaration
 * d'absence serait bloqué le jour où l'absence n'a pas été déclarée — c'est-à-dire
 * le jour où l'on a le plus besoin de lui. Voir A.4.
 *
 * `is_system = false` : ces rôles ne sont comparés en dur dans AUCUNE fonction
 * d'autorisation. Les marquer système interdirait de les renommer sans qu'aucune
 * garantie ne l'exige.
 */
insert into public.roles (code, label, description, is_system, is_active)
values
  ('RESPONSABLE', 'Responsable',
   'Prépare le dossier, dépose les pièces et le soumet à validation.', false, true),
  ('SUPPLEANT', 'Suppléant',
   'Mêmes droits que le responsable, en permanence. Une déclaration d''absence '
   'ne lui donne aucun droit supplémentaire : elle réoriente seulement les '
   'notifications.', false, true),
  ('SUPERVISEUR', 'Superviseur',
   'Valide les dossiers, affecte les responsables et produit les exports.', false, true)
on conflict (code) do nothing;

-- Permissions de RESPONSABLE et SUPPLEANT : celles de l'agent.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code in ('RESPONSABLE', 'SUPPLEANT')
  and p.code in (
    'obligation.read', 'occurrence.read', 'occurrence.write', 'occurrence.submit',
    'document.read', 'document.upload'
  )
on conflict do nothing;

-- Permissions de SUPERVISEUR : celles du responsable de service.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'SUPERVISEUR'
  and p.code in (
    'obligation.read', 'occurrence.read', 'occurrence.write', 'occurrence.submit',
    'occurrence.validate', 'occurrence.assign', 'occurrence.mark_na',
    'document.read', 'document.upload', 'document.delete',
    'export.generate', 'dashboard.view_all'
  )
on conflict do nothing;

update public.roles
set is_active = false
where code in ('COMPTA_MANAGER', 'COMPTA_AGENT', 'RH_MANAGER', 'RH_AGENT', 'REGLEMENTAIRE');

/*
 * ⚠️ L'INACTIVITÉ EST APPLIQUÉE EN BASE, pas seulement dans l'écran d'attribution.
 *
 * Une colonne `is_active` que rien ne fait respecter n'est qu'un commentaire :
 * un script, un import ou un écran oublié rendrait le rôle attribuable comme
 * avant. Le refus vit donc dans un trigger, au point de passage obligé.
 *
 * ⚠️ Il ne porte QUE sur l'attribution NOUVELLE. Une habilitation déjà accordée
 * survit à la désactivation de son rôle — la révoquer d'office retirerait leurs
 * droits à toute l'équipe au moment même où l'on réorganise.
 */
create or replace function public.enforce_active_role_grant()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  role_code text;
  role_active boolean;
begin
  select r.code, r.is_active into role_code, role_active
  from public.roles r where r.id = new.role_id;

  if role_active is false then
    raise exception 'Le rôle % est désactivé et n''est plus attribuable.', role_code
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function public.enforce_active_role_grant() is
  'Refuse l''attribution d''un rôle désactivé. Ne touche PAS aux habilitations '
  'existantes : désactiver un rôle réorganise l''avenir, il ne retire rien à '
  'personne dans l''instant.';

drop trigger if exists trg_user_roles_active on public.user_roles;
create trigger trg_user_roles_active
  before insert on public.user_roles
  for each row execute function public.enforce_active_role_grant();

-- -----------------------------------------------------------------------------
-- A.2 — SUPPLÉANT : la colonne qui manquait
--
-- ⚠️ DÉCISION DE NOMMAGE — `owner_id` ET `validator_id` NE SONT PAS RENOMMÉS.
--
-- Ces deux colonnes traversent les politiques RLS, la machine à états, les vues
-- de liste, le moteur de génération, les exports et un millier de tests. Les
-- renommer serait du remaniement pur : aucun comportement n'en changerait, et
-- chaque ligne touchée serait une occasion de casser quelque chose de silencieux.
--
-- Le vocabulaire métier vit donc dans l'interface, via next-intl, et la stabilité
-- vit dans le schéma. Les commentaires ci-dessous font le pont — ils sont la
-- seule documentation qu'un lecteur du schéma rencontrera.
-- -----------------------------------------------------------------------------

alter table public.obligation_occurrences
  add column if not exists deputy_id uuid references public.profiles(id);

alter table public.obligation_types
  add column if not exists default_deputy_id uuid references public.profiles(id);

comment on column public.obligation_occurrences.owner_id is
  'RESPONSABLE du dossier — « Responsable » dans l''interface. Colonne NON '
  'renommée à dessein : elle traverse les politiques RLS, la machine à états et '
  'le moteur de génération. Le vocabulaire métier vit dans les catalogues i18n.';
comment on column public.obligation_occurrences.deputy_id is
  'SUPPLÉANT du dossier — « Suppléant » dans l''interface. Il peut agir EN '
  'PERMANENCE, indépendamment de toute déclaration d''absence (cf. user_absences).';
comment on column public.obligation_occurrences.validator_id is
  'SUPERVISEUR du dossier — « Superviseur » dans l''interface. Colonne NON '
  'renommée, même raison qu''owner_id.';

comment on column public.obligation_types.default_owner_id is
  'Responsable attribué d''office aux occurrences générées.';
comment on column public.obligation_types.default_deputy_id is
  'Suppléant attribué d''office aux occurrences générées.';
comment on column public.obligation_types.default_validator_id is
  'Superviseur attribué d''office aux occurrences générées.';

-- -----------------------------------------------------------------------------
-- A.3 — QUALITÉ D'INTERVENTION
--
-- ⚠️ CALCULÉE EN BASE, JAMAIS REÇUE DU CLIENT. Une qualité d'intervention
-- fournie par l'appelant serait déclarative : n'importe qui pourrait signer
-- « SUPERVISEUR » une action faite en tant que responsable, et le journal
-- d'audit perdrait précisément ce qu'on lui demande d'établir.
--
-- ⚠️ COEXISTE AVEC `on_behalf_of_id`, qui répond à une autre question.
--   `acted_as`        : à quel titre cette personne intervient sur CE dossier.
--   `on_behalf_of_id` : au nom de qui elle agit, par délégation datée.
-- Une même ligne peut porter les deux : un suppléant agissant sous délégation
-- d'un superviseur absent.
-- -----------------------------------------------------------------------------

alter table public.occurrence_transitions
  add column if not exists acted_as text
    check (acted_as in ('RESPONSABLE', 'SUPPLEANT', 'SUPERVISEUR', 'DIRECTION', 'ADMIN', 'SYSTEM'));

comment on column public.occurrence_transitions.acted_as is
  'Qualité de l''intervenant sur CE dossier, calculée en base à partir de la '
  'relation réelle entre l''acteur et l''occurrence. Jamais fournie par le client. '
  'Distincte d''on_behalf_of_id, qui porte la délégation datée : les deux '
  'coexistent et répondent à des questions différentes.';

/*
 * ⚠️ LA RELATION AU DOSSIER L'EMPORTE SUR LE RÔLE GLOBAL.
 *
 * Un membre de la Direction qui est aussi le responsable désigné d'un dossier
 * agit, sur ce dossier, EN TANT QUE RESPONSABLE. Consigner « DIRECTION »
 * laisserait croire à une intervention d'autorité là où il n'y a qu'un travail
 * ordinaire — et masquerait les vraies interventions d'autorité, qui sont
 * précisément celles qu'un auditeur cherche.
 *
 * L'ordre est donc : responsable, suppléant, superviseur, puis rôle global.
 */
create or replace function public.resolve_acted_as(
  p_occurrence public.obligation_occurrences,
  p_actor uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    -- Aucun acteur : la ligne vient d'une tâche planifiée.
    when p_actor is null then 'SYSTEM'
    when p_actor = p_occurrence.owner_id then 'RESPONSABLE'
    when p_actor = p_occurrence.deputy_id then 'SUPPLEANT'
    when p_actor = p_occurrence.validator_id then 'SUPERVISEUR'
    when exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p_actor and r.code = 'DIRECTION'
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > now())
    ) then 'DIRECTION'
    when exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p_actor and r.code = 'ADMIN'
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > now())
    ) then 'ADMIN'
    /*
     * Aucune relation, aucun rôle d'autorité : la RLS a pourtant laissé passer
     * l'écriture. On ne devine pas — NULL dit « qualité indéterminée », ce qui
     * est une information, là où un intitulé inventé n'en serait pas une.
     */
    else null
  end;
$$;

comment on function public.resolve_acted_as is
  'Qualité d''intervention, déduite de la relation entre l''acteur et le dossier. '
  'La RELATION prime sur le rôle global : un membre de la Direction responsable '
  'du dossier agit en tant que RESPONSABLE. Rend NULL plutôt que d''inventer un '
  'intitulé quand aucune relation ni aucun rôle d''autorité ne s''applique.';

-- Le point de passage obligé de toute transition consigne désormais la qualité.
create or replace function public.record_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  previous_status public.occurrence_status;
  resolved_reason text;
  actor uuid;
begin
  if tg_op = 'INSERT' then
    previous_status := null;
  else
    if new.status is not distinct from old.status then
      return null;
    end if;
    previous_status := old.status;
  end if;

  actor := public.app_actor_id();

  resolved_reason := coalesce(
    public.app_transition_reason(),
    case new.status
      when 'NOT_APPLICABLE' then new.na_reason
      when 'REJECTED' then new.rejection_reason
      else null
    end
  );

  insert into public.occurrence_transitions
    (occurrence_id, from_status, to_status, actor_id, on_behalf_of_id, reason, metadata, acted_as)
  values (
    new.id,
    previous_status,
    new.status,
    actor,
    -- Action sous délégation : on conserve le délégant, sans effacer l'auteur réel.
    (
      select d.delegator_id
      from public.validation_delegations d
      where d.delegate_id = auth.uid()
        and d.revoked_at is null
        and current_date between d.starts_at and d.ends_at
      limit 1
    ),
    resolved_reason,
    jsonb_build_object('origin', case when tg_op = 'INSERT' then 'CREATION' else 'TRANSITION' end),
    public.resolve_acted_as(new, actor)
  );

  -- ⚠️ MÊME TRANSACTION que la transition et que son journal. Si la notification
  -- ne peut pas s'écrire, la transition entière est annulée. C'est délibéré :
  -- un validateur qui n'est jamais prévenu ne valide jamais, et le dossier
  -- expire sans que personne n'ait rien vu passer.
  if tg_op <> 'INSERT' then
    perform public.dispatch_transition_notifications(new, previous_status, new.status, resolved_reason);
  end if;

  return null;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- A.4 — DÉCLARATION D'ABSENCE
--
-- ⚠️ PORTÉE STRICTEMENT LIMITÉE À L'ACHEMINEMENT ET À L'AFFICHAGE.
--
-- Une absence NE MODIFIE AUCUNE PERMISSION. Le suppléant peut agir en
-- permanence ; l'absence dit seulement à qui écrire, et signale à l'écran que le
-- responsable n'est pas joignable.
--
-- La raison est unique et elle suffit : une déclaration d'absence oubliée ne
-- doit JAMAIS bloquer le traitement d'une échéance légale. Si les droits du
-- suppléant en dépendaient, l'oubli d'une saisie administrative produirait une
-- pénalité fiscale — on aurait fait dépendre la conformité d'un formulaire
-- interne. Aucune policy RLS, aucune fonction d'autorisation ne lit cette table.
-- -----------------------------------------------------------------------------

create table if not exists public.user_absences (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
    references public.entities(id),
  user_id uuid not null references public.profiles(id),
  starts_at date not null,
  ends_at date not null,
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),

  constraint user_absences_range check (ends_at >= starts_at)
);

comment on table public.user_absences is
  'Déclarations d''absence. ⚠️ N''ACCORDE ET NE RETIRE AUCUNE PERMISSION : elle '
  'réoriente les notifications vers le suppléant et le signale à l''écran, rien '
  'de plus. Le suppléant peut agir en permanence — sinon une déclaration oubliée '
  'bloquerait une échéance légale.';
comment on column public.user_absences.reason is
  'Motif obligatoire. Une absence sans motif ne se distingue pas d''une saisie '
  'erronée au moment où quelqu''un cherche pourquoi ses alertes ont changé de '
  'destinataire.';
comment on column public.user_absences.revoked_at is
  'Une absence annulée est RÉVOQUÉE, jamais supprimée : la période pendant '
  'laquelle les notifications ont été réorientées doit rester lisible.';

create index if not exists user_absences_active_idx
  on public.user_absences (user_id, starts_at, ends_at)
  where revoked_at is null;

alter table public.user_absences enable row level security;

/*
 * Lecture : la sienne, celles que l'on gère, et celles des collègues dont on
 * partage les dossiers — savoir qu'un responsable est absent fait partie du
 * travail. Le motif, lui, n'est pas une donnée sensible : c'est « congés »,
 * « mission », « formation ».
 */
create policy user_absences_select on public.user_absences
  for select using (
    public.is_active_user()
    and (
      user_id = auth.uid()
      or public.has_permission('user.manage')
      or public.has_permission('occurrence.read')
    )
  );

-- Déclarer : pour soi, ou pour autrui si l'on gère les comptes.
create policy user_absences_insert on public.user_absences
  for insert with check (
    public.is_active_user()
    and (user_id = auth.uid() or public.has_permission('user.manage'))
  );

create policy user_absences_update on public.user_absences
  for update using (
    public.is_active_user()
    and (user_id = auth.uid() or public.has_permission('user.manage'))
  ) with check (
    public.is_active_user()
    and (user_id = auth.uid() or public.has_permission('user.manage'))
  );

/*
 * ⚠️ AUCUNE POLICY DE SUPPRESSION. Une absence se révoque (`revoked_at`), elle
 * ne s'efface pas : la période pendant laquelle les alertes ont été réorientées
 * doit rester explicable.
 */

grant select, insert, update on public.user_absences to authenticated;

create trigger trg_audit
  after insert or update or delete on public.user_absences
  for each row execute function public.audit_trigger();

/** Absent à cette date ? Sert à l'acheminement des notifications et à l'affichage. */
create or replace function public.is_absent_on(p_user_id uuid, p_on date default current_date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_absences a
    where a.user_id = p_user_id
      and a.revoked_at is null
      and p_on between a.starts_at and a.ends_at
  );
$$;

comment on function public.is_absent_on is
  '⚠️ À N''EMPLOYER QUE POUR L''ACHEMINEMENT ET L''AFFICHAGE. Aucune policy RLS '
  'ni fonction d''autorisation ne doit l''appeler : faire dépendre un droit d''une '
  'déclaration d''absence transformerait un oubli de saisie en échéance manquée.';

grant execute on function public.is_absent_on(uuid, date) to authenticated;

-- =============================================================================
-- PARTIE B — REGISTRES DE COMMERCE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B.1 — IDENTIFIANTS DE L'ENTREPRISE, STRUCTURÉS
--
-- NIF, NIS et article d'imposition sont réclamés sur presque chaque formulaire
-- administratif. Ils n'étaient consultables qu'en ouvrant un document scanné :
-- six colonnes suffisent à les afficher sur la fiche, à les reprendre dans les
-- exports, et à ne plus dépendre d'un fichier retrouvé au bon moment.
-- -----------------------------------------------------------------------------

alter table public.entities
  add column if not exists nif text,
  add column if not exists nis text,
  add column if not exists article_imposition text,
  add column if not exists legal_form text,
  add column if not exists capital_social numeric,
  add column if not exists head_office_address text,
  add column if not exists wilaya text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text;

comment on column public.entities.nif is
  'Numéro d''identification fiscale. Réclamé sur presque chaque formulaire : '
  'structuré ici plutôt que cherché dans un document scanné.';
comment on column public.entities.nis is 'Numéro d''identification statistique.';
comment on column public.entities.article_imposition is
  'Article d''imposition attribué par la DGI.';
comment on column public.entities.capital_social is
  'Capital social en dinars. `numeric` sans échelle imposée : un capital n''est '
  'pas un montant de dossier, et la plateforme n''en fait aucun calcul.';

-- -----------------------------------------------------------------------------
-- B.2 — REGISTRES DE COMMERCE
--
-- ⚠️ UNE SEULE ENTITÉ JURIDIQUE, PLUSIEURS REGISTRES. AGROESPACE a un seul NIF
-- et plusieurs extraits — principal et annexes — pour différentes activités ou
-- établissements. G50, IBS, CNAS et CASNOS se déclarent une seule fois pour
-- l'ensemble ; seules certaines obligations sont propres à chaque registre.
-- C'est toute la raison d'être de `obligation_types.scope`.
-- -----------------------------------------------------------------------------

create table if not exists public.commercial_registers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid
    references public.entities(id),
  rc_number text not null,
  register_type text not null check (register_type in ('PRINCIPAL', 'SECONDAIRE', 'ANNEXE')),
  label text not null,
  activity_label text,
  activity_codes text[],
  address text,
  wilaya text,
  commune text,
  issued_at date,
  expires_at date,
  status text not null default 'ACTIF' check (status in ('ACTIF', 'SUSPENDU', 'RADIE')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz,
  deleted_at timestamptz,

  constraint commercial_registers_number_key unique (entity_id, rc_number)
);

comment on table public.commercial_registers is
  'Extraits du registre du commerce d''une même entité juridique. Le principal '
  'et ses annexes portent des activités ou des établissements distincts : '
  'certaines obligations se déclarent une fois pour l''entreprise, d''autres une '
  'fois par registre (cf. obligation_types.scope).';
comment on column public.commercial_registers.status is
  'ACTIF génère des occurrences ; SUSPENDU et RADIE cessent d''en produire SANS '
  'toucher à celles déjà créées — un registre radié laisse des dossiers en cours '
  'qu''il faut encore clore.';
comment on column public.commercial_registers.expires_at is
  'Échéance de validité. C''est CETTE date que lit le calcul d''échéance des '
  'obligations ancrées sur une expiration, et non une valeur portée par '
  'l''occurrence — voir le moteur de génération.';

create index if not exists commercial_registers_entity_status_idx
  on public.commercial_registers (entity_id, status)
  where deleted_at is null;

/*
 * ⚠️ UN SEUL REGISTRE PRINCIPAL ACTIF PAR ENTITÉ. En index partiel plutôt qu'en
 * contrainte : une contrainte `unique` ne sait pas se restreindre aux lignes
 * actives, et interdirait de conserver l'historique d'un principal radié
 * remplacé par un autre.
 */
create unique index if not exists commercial_registers_single_principal_idx
  on public.commercial_registers (entity_id)
  where register_type = 'PRINCIPAL' and status = 'ACTIF' and deleted_at is null;

alter table public.commercial_registers enable row level security;

-- Lecture : tout utilisateur actif qui lit le référentiel. Un registre n'est pas
-- une donnée confidentielle — c'est une information publique au greffe.
create policy commercial_registers_select on public.commercial_registers
  for select using (public.is_active_user() and public.has_permission('obligation.read'));

create policy commercial_registers_insert on public.commercial_registers
  for insert with check (public.has_permission('referential.manage'));

create policy commercial_registers_update on public.commercial_registers
  for update using (public.has_permission('referential.manage'))
  with check (public.has_permission('referential.manage'));

/*
 * ⚠️ AUCUNE POLICY DE SUPPRESSION : `deleted_at` uniquement (CLAUDE.md §6). Un
 * registre supprimé physiquement emporterait le rattachement des occurrences
 * qu'il a produites.
 */

grant select, insert, update on public.commercial_registers to authenticated;

create trigger trg_audit
  after insert or update or delete on public.commercial_registers
  for each row execute function public.audit_trigger();

-- -----------------------------------------------------------------------------
-- B.3 — PORTÉE DES OBLIGATIONS
-- -----------------------------------------------------------------------------

alter table public.obligation_types
  add column if not exists scope text not null default 'ENTITY'
    check (scope in ('ENTITY', 'PER_REGISTER'));

comment on column public.obligation_types.scope is
  'ENTITY : une occurrence par période pour toute l''entreprise. PER_REGISTER : '
  'une occurrence par période ET par registre ACTIF. Le défaut est ENTITY parce '
  'que c''est le cas de la grande majorité — G50, IBS, CNAS, CASNOS se déclarent '
  'une seule fois, quel que soit le nombre d''établissements.';

/*
 * ⚠️ CETTE LISTE EXISTE AUSSI DANS LE JEU DE DONNÉES INITIAL, et ce n'est pas
 * une duplication de règle métier : ici on CORRIGE des lignes déjà en base,
 * là-bas on POSE la valeur à la création. Une migration est un fait historique,
 * elle ne peut pas déléguer à un fichier qui évoluera après elle.
 */
update public.obligation_types
set scope = 'PER_REGISTER'
where code in ('RC-MAJ', 'AGR-SANIT', 'ETAB-CLASSE', 'CTRL-TECH');

/*
 * ⚠️ ENGRAIS-AUT RESTE « ENTITY », ET C'EST UN CHOIX À RELIRE.
 *
 * L'homologation d'un engrais porte sur le PRODUIT, pas sur l'établissement qui
 * le fabrique : une autorisation obtenue vaut pour l'entreprise entière, quel
 * que soit le registre sous lequel le site est déclaré. Si la réalité
 * administrative diffère — homologation rattachée à un établissement — il
 * suffit de basculer la portée depuis l'écran du référentiel, sans migration.
 */

-- -----------------------------------------------------------------------------
-- B.4 — RATTACHEMENT DES OCCURRENCES
-- -----------------------------------------------------------------------------

alter table public.obligation_occurrences
  add column if not exists commercial_register_id uuid references public.commercial_registers(id);

comment on column public.obligation_occurrences.commercial_register_id is
  'Registre auquel ce dossier se rattache. NULL pour une obligation de portée '
  'ENTITY, obligatoire pour une PER_REGISTER — le trigger enforce_register_scope '
  'refuse les deux incohérences.';

/*
 * ⚠️ L'UNICITÉ DEVIENT DOUBLE, ET IL FAUT LES DEUX INDEX.
 *
 * Un seul index sur les quatre colonnes ne suffirait pas : en SQL, deux NULL ne
 * se heurtent jamais. Une obligation ENTITY pourrait alors être générée deux
 * fois pour la même période sans que rien ne s'y oppose — précisément ce que
 * l'idempotence du moteur repose sur cette contrainte pour éviter.
 *
 * D'où deux index partiels complémentaires, dont les prédicats couvrent
 * exactement l'ensemble des lignes, sans recouvrement.
 *
 * Les clés rectificatives ('2026-01-R1') continuent de fonctionner à
 * l'identique : ce sont des `period_key` distinctes, rien de plus.
 */
alter table public.obligation_occurrences
  drop constraint if exists obligation_occurrences_period_key;

create unique index if not exists obligation_occurrences_entity_period_idx
  on public.obligation_occurrences (entity_id, obligation_type_id, period_key)
  where commercial_register_id is null;

create unique index if not exists obligation_occurrences_register_period_idx
  on public.obligation_occurrences
    (entity_id, obligation_type_id, commercial_register_id, period_key)
  where commercial_register_id is not null;

create or replace function public.enforce_register_scope()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  obligation_scope text;
  obligation_code text;
begin
  select ot.scope, ot.code into obligation_scope, obligation_code
  from public.obligation_types ot
  where ot.id = new.obligation_type_id;

  if obligation_scope = 'PER_REGISTER' and new.commercial_register_id is null then
    raise exception
      'L''obligation % est de portée PER_REGISTER : un registre de commerce est obligatoire.',
      obligation_code using errcode = '23514';
  end if;

  if obligation_scope = 'ENTITY' and new.commercial_register_id is not null then
    raise exception
      'L''obligation % est de portée ENTITY : elle ne se rattache à aucun registre.',
      obligation_code using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function public.enforce_register_scope() is
  'Refuse les deux incohérences de portée, dans les DEUX sens. Un dossier '
  'PER_REGISTER sans registre serait invisible du bon établissement ; un dossier '
  'ENTITY rattaché à un registre serait compté autant de fois qu''il y a de '
  'registres. Les deux erreurs se ressemblent et ne se voient qu''au comptage.';

drop trigger if exists trg_occurrence_register_scope on public.obligation_occurrences;
create trigger trg_occurrence_register_scope
  before insert or update of obligation_type_id, commercial_register_id
  on public.obligation_occurrences
  for each row execute function public.enforce_register_scope();

-- -----------------------------------------------------------------------------
-- B.5 — CRÉATION D'OCCURRENCE : le registre entre dans la clé
--
-- ⚠️ LA RÉÉCRITURE EST OBLIGATOIRE, PAS COSMÉTIQUE. L'ancienne version portait
-- `on conflict (entity_id, obligation_type_id, period_key)`, qui désignait la
-- contrainte supprimée ci-dessus. PostgreSQL exige un index unique correspondant
-- pour inférer un conflit : la fonction aurait échoué à la première génération.
--
-- Un index PARTIEL ne peut être inféré que si la clause `where` de l'instruction
-- reprend son prédicat — d'où deux instructions distinctes plutôt qu'une
-- paramétrée.
-- -----------------------------------------------------------------------------

/*
 * ⚠️ L'ANCIENNE SIGNATURE EST SUPPRIMÉE, PAS SEULEMENT REMPLACÉE.
 *
 * Ajouter un paramètre — fût-il muni d'un défaut — crée une SURCHARGE : les deux
 * versions coexistent, et tout appelant passant sept arguments continue
 * d'atteindre l'ancienne, qui référence la contrainte supprimée plus haut. Le
 * moteur de génération aurait échoué à la première passe, sur une erreur
 * parlant d'un index disparu. Constaté à l'application de cette migration.
 */
drop function if exists public.create_occurrence_if_absent(
  uuid, text, date, date, date, date, public.occurrence_status
);

create or replace function public.create_occurrence_if_absent(
  p_obligation_type_id uuid,
  p_period_key text,
  p_period_start date,
  p_period_end date,
  p_legal_due_date date,
  p_internal_due_date date,
  p_status public.occurrence_status default 'TODO',
  p_commercial_register_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  new_id uuid;
  obligation record;
begin
  select ot.id, ot.entity_id, ot.default_owner_id, ot.default_deputy_id,
         ot.default_validator_id, ot.scope
    into obligation
  from public.obligation_types ot
  where ot.id = p_obligation_type_id and ot.deleted_at is null;

  if obligation.id is null then
    raise exception 'Obligation introuvable : %.', p_obligation_type_id using errcode = '22023';
  end if;

  if p_commercial_register_id is null then
    insert into public.obligation_occurrences (
      entity_id, obligation_type_id, period_key, period_start, period_end,
      legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id,
      commercial_register_id
    )
    values (
      obligation.entity_id, p_obligation_type_id, p_period_key, p_period_start, p_period_end,
      p_legal_due_date, p_internal_due_date, p_status,
      obligation.default_owner_id, obligation.default_deputy_id, obligation.default_validator_id,
      null
    )
    on conflict (entity_id, obligation_type_id, period_key)
      where commercial_register_id is null
      do nothing
    returning id into new_id;
  else
    insert into public.obligation_occurrences (
      entity_id, obligation_type_id, period_key, period_start, period_end,
      legal_due_date, internal_due_date, status, owner_id, deputy_id, validator_id,
      commercial_register_id
    )
    values (
      obligation.entity_id, p_obligation_type_id, p_period_key, p_period_start, p_period_end,
      p_legal_due_date, p_internal_due_date, p_status,
      obligation.default_owner_id, obligation.default_deputy_id, obligation.default_validator_id,
      p_commercial_register_id
    )
    on conflict (entity_id, obligation_type_id, commercial_register_id, period_key)
      where commercial_register_id is not null
      do nothing
    returning id into new_id;
  end if;

  -- `new_id` est NULL quand la période existait déjà : ce n'est pas une erreur,
  -- c'est le comportement recherché. L'appelant compte les créations réelles.
  if new_id is not null then
    insert into public.occurrence_checklist_items
      (occurrence_id, required_document_id, label, is_mandatory, document_kind, order_index)
    select new_id, rd.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
    from public.obligation_required_documents rd
    where rd.obligation_type_id = p_obligation_type_id;
  end if;

  return new_id;
end;
$fn$;

comment on function public.create_occurrence_if_absent(
  uuid, text, date, date, date, date, public.occurrence_status, uuid
) is
  'Crée une occurrence SI la période n''existe pas déjà — pour l''entité, ou pour '
  'le registre indiqué — avec sa liste de contrôle et ses affectations par '
  'défaut. Rend NULL quand la période existait : un silence délibéré, pas une '
  'erreur. C''est cette fonction qui rend le moteur de génération rejouable.';

revoke execute on function public.create_occurrence_if_absent(
  uuid, text, date, date, date, date, public.occurrence_status, uuid
) from public, anon, authenticated;

/** Registres ACTIFS d'une entité — la liste sur laquelle le moteur itère. */
create or replace function public.active_registers(p_entity_id uuid)
returns table (id uuid, rc_number text, label text, expires_at date)
language sql
stable
security definer
set search_path = ''
as $$
  select cr.id, cr.rc_number, cr.label, cr.expires_at
  from public.commercial_registers cr
  where cr.entity_id = p_entity_id
    and cr.status = 'ACTIF'
    and cr.deleted_at is null
  order by cr.register_type, cr.rc_number;
$$;

comment on function public.active_registers is
  'Registres au statut ACTIF, seuls à produire des occurrences. Un registre '
  'passé à SUSPENDU ou RADIE disparaît d''ici et cesse d''en générer, sans que '
  'les dossiers déjà créés ne bougent.';

grant execute on function public.active_registers(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- B.6 — MIGRATION DES DONNÉES EXISTANTES
-- -----------------------------------------------------------------------------

/*
 * Un registre PRINCIPAL par défaut, à compléter dans l'interface.
 *
 * ⚠️ Ses champs sont volontairement vides plutôt qu'inventés : un numéro de
 * registre plausible mais faux serait recopié dans un formulaire administratif
 * sans que personne ne le vérifie. Le libellé dit ce qu'il est.
 */
insert into public.commercial_registers (entity_id, rc_number, register_type, label, status, notes)
select e.id, 'À COMPLÉTER', 'PRINCIPAL', 'Registre principal (à compléter)', 'ACTIF',
       'Créé automatiquement par la migration 0018. Renseigner le numéro, '
       || 'l''activité et les dates depuis la fiche de l''entreprise.'
from public.entities e
where not exists (
  select 1 from public.commercial_registers cr
  where cr.entity_id = e.id and cr.deleted_at is null
)
on conflict (entity_id, rc_number) do nothing;

-- Les occurrences déjà créées pour une obligation devenue PER_REGISTER se
-- rattachent au principal : sans cela, le trigger de cohérence les refuserait à
-- la première mise à jour.
update public.obligation_occurrences oc
set commercial_register_id = (
  select cr.id from public.commercial_registers cr
  where cr.entity_id = oc.entity_id
    and cr.register_type = 'PRINCIPAL'
    and cr.status = 'ACTIF'
    and cr.deleted_at is null
  limit 1
)
where oc.commercial_register_id is null
  and exists (
    select 1 from public.obligation_types ot
    where ot.id = oc.obligation_type_id and ot.scope = 'PER_REGISTER'
  );

/*
 * ⚠️ `deputy_id` RESTE À NULL, DÉLIBÉRÉMENT.
 *
 * Recopier `owner_id` dedans donnerait à chaque dossier un suppléant qui est
 * aussi son responsable : l'écran afficherait une suppléance là où il n'y en a
 * aucune, et la réorientation des notifications écrirait à la personne même
 * qu'on cherche à suppléer. Le champ se renseigne à la configuration.
 */

-- Vérification finale : aucune ligne ne doit violer les nouvelles règles.
do $$
declare
  orphans int;
  strays int;
begin
  select count(*) into orphans
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.scope = 'PER_REGISTER' and oc.commercial_register_id is null;

  select count(*) into strays
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where ot.scope = 'ENTITY' and oc.commercial_register_id is not null;

  if orphans > 0 or strays > 0 then
    raise exception
      'Migration 0018 incohérente : % occurrence(s) PER_REGISTER sans registre, % ENTITY avec registre.',
      orphans, strays;
  end if;
end;
$$;
