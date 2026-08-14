-- =============================================================================
-- CONFORMIA — 0001 : référentiel des obligations et moteur d'occurrences
--
-- Les migrations SQL sont la source de vérité unique du schéma. Aucune
-- modification via l'interface Supabase, jamais : une modification non versionnée
-- est invisible en revue, absente des environnements suivants, et irrécupérable.
--
-- Périmètre de cette migration : structures, contraintes, machine à états.
-- HORS périmètre, traités en 2.2 et 2.3 : politiques RLS, tables documentaires.
--
-- ⚠️ AUCUNE COLONNE DE MONTANT, dans aucune table. Décision arrêtée : la
-- plateforme suit la DÉMARCHE administrative, pas les chiffres déclarés. Une
-- colonne de montant ferait entrer des données fiscales chiffrées dans un
-- système qui n'est ni conçu ni audité pour les porter.
-- =============================================================================

-- =============================================================================
-- 1. TYPES ÉNUMÉRÉS
--    Ordre de déclaration = ordre de tri SQL. Il reflète exactement
--    src/config/constants.ts ; toute divergence casse le typecheck applicatif
--    via src/types/domain.ts.
-- =============================================================================

create type public.periodicity as enum (
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'BIENNIAL',
  'ON_EVENT',
  'CUSTOM'
);

comment on type public.periodicity is
  'Rythme de génération des occurrences. ON_EVENT ne génère rien automatiquement : '
  'l''occurrence naît d''un fait déclencheur. CUSTOM lit les dates fixes de due_rule.occurrences[].';

create type public.occurrence_status as enum (
  'TODO',
  'IN_PROGRESS',
  'PENDING_VALIDATION',
  'REJECTED',
  'VALIDATED',
  'SUBMITTED',
  'ARCHIVED',
  'NOT_APPLICABLE'
);

create type public.criticality as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- =============================================================================
-- 2. FONCTIONS DE CONTEXTE
--    L'acteur d'une écriture provient soit de la session Supabase (interface),
--    soit d'un paramètre de session posé par un job (service_role, sans auth.uid()).
-- =============================================================================

create or replace function public.app_actor_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('conformia.actor_id', true), '')::uuid,
    auth.uid()
  );
$$;

comment on function public.app_actor_id() is
  'Identité de l''auteur de l''écriture courante. auth.uid() en session utilisateur ; '
  'à défaut, le GUC conformia.actor_id que les jobs de src/server/jobs/ doivent poser '
  '(SET LOCAL) avant toute écriture — un job reste responsable de ses traces.';

create or replace function public.app_transition_reason()
returns text
language sql
stable
as $$
  select nullif(btrim(coalesce(current_setting('conformia.transition_reason', true), '')), '');
$$;

comment on function public.app_transition_reason() is
  'Motif de la transition en cours, posé par l''appelant via SET LOCAL '
  'conformia.transition_reason. Utilisé quand le motif n''a pas de colonne dédiée.';

-- =============================================================================
-- 3. ENTITÉS
-- =============================================================================

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.entities is
  'Sites / sociétés du groupe. Une seule ligne en v1.';

-- Identifiant figé : il sert de DEFAULT à toutes les colonnes entity_id. Un
-- gen_random_uuid() rendrait ce défaut impossible à écrire.
insert into public.entities (id, code, name)
values ('00000000-0000-0000-0000-000000000001', 'AGROESPACE', 'AGROESPACE');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.entities (id) on delete restrict,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  constraint departments_entity_code_key unique (entity_id, code)
);

comment on table public.departments is
  'Services responsables : comptabilité, ressources humaines, réglementaire, juridique.';
comment on column public.departments.entity_id is
  'Colonne prévue pour un futur cloisonnement multi-sites. Les politiques RLS restent '
  'mono-entité en v1 ; leur extension ne nécessitera aucune migration de schéma.';

-- =============================================================================
-- 4. PROFILS
--    Non demandé explicitement, mais indispensable : toutes les colonnes
--    owner_id / validator_id / actor_id de ce prompt référencent `profiles`.
--    Table volontairement minimale — rôles, permissions et RLS relèvent de 2.2.
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.entities (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  full_name text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.profiles is
  'Projection applicative d''un compte auth.users. Étendue en 2.2 (rôles, permissions).';
comment on column public.profiles.id is
  'Même identifiant que auth.users. ON DELETE RESTRICT : supprimer un compte qui porte '
  'des traces d''audit doit échouer, pas effacer l''histoire.';
comment on column public.profiles.deleted_at is
  'Suppression logique uniquement. Aucune donnée métier n''est supprimée physiquement.';
comment on column public.profiles.entity_id is
  'Colonne prévue pour un futur cloisonnement multi-sites. Les politiques RLS restent '
  'mono-entité en v1 ; leur extension ne nécessitera aucune migration de schéma.';

-- =============================================================================
-- 5. RÉFÉRENTIELS PARTAGÉS
--    Sans entity_id : ces nomenclatures sont communes à tout le groupe.
-- =============================================================================

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null
);

comment on table public.domains is 'Domaines réglementaires. Nomenclature partagée.';

insert into public.domains (code, label) values
  ('FISCAL', 'Fiscal'),
  ('SOCIAL', 'Social'),
  ('REGLEMENTAIRE', 'Réglementaire'),
  ('JURIDIQUE', 'Juridique');

create table public.authorities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  portal_url text,
  contact_info jsonb not null default '{}'::jsonb,
  notes text
);

comment on table public.authorities is
  'Administrations destinataires. Aucune n''est codée en dur dans l''application : '
  'ajouter une administration est une insertion, pas un déploiement.';
comment on column public.authorities.contact_info is
  'Coordonnées libres (guichet, téléphone, courriel, référent). Structure volontairement '
  'non contrainte : elle varie d''une administration à l''autre.';

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  label text not null,
  is_recurring boolean not null default false,
  source text,
  created_at timestamptz not null default now()
);

comment on table public.holidays is
  'Jours fériés servant au report des échéances. Aucun n''est codé en dur : les fêtes '
  'religieuses se décalent chaque année et sont fixées par décret.';
comment on column public.holidays.is_recurring is
  'true = même jour chaque année (fêtes civiles à date fixe). Seuls le mois et le jour '
  'de holiday_date font alors foi ; l''année n''est que celle de la première saisie.';
comment on column public.holidays.source is
  'Origine de l''information : décret, journal officiel, saisie manuelle.';

-- =============================================================================
-- 6. VALIDATION DÉCLARATIVE DE due_rule
--    Écrite en PL/pgSQL et non en SQL : l''évaluation des AND n''est pas ordonnée
--    en SQL, un cast sur une valeur du mauvais type y lèverait avant son garde-fou.
-- =============================================================================

create or replace function public.is_valid_due_rule(rule jsonb, p public.periodicity)
returns boolean
language plpgsql
immutable
as $$
declare
  anchor_value text;
  shift_values constant text[] := array['NEXT_BUSINESS_DAY', 'PREVIOUS_BUSINESS_DAY', 'NONE'];
  element jsonb;
begin
  if rule is null or jsonb_typeof(rule) <> 'object' then
    return false;
  end if;

  anchor_value := rule ->> 'anchor';
  if anchor_value is null
     or anchor_value not in ('PERIOD_END', 'PERIOD_START', 'FIXED_DATE', 'EXPIRY_DATE', 'EVENT_DATE')
  then
    return false;
  end if;

  -- Les reports sont facultatifs mais, s'ils sont présents, doivent être connus.
  if rule ? 'weekend_shift' and not (rule ->> 'weekend_shift' = any (shift_values)) then
    return false;
  end if;
  if rule ? 'holiday_shift' and not (rule ->> 'holiday_shift' = any (shift_values)) then
    return false;
  end if;

  -- Les décalages, quand ils existent, sont des nombres. offset_days peut être
  -- négatif : un renouvellement se prépare avant l'expiration du titre.
  if rule ? 'offset_days' and jsonb_typeof(rule -> 'offset_days') <> 'number' then
    return false;
  end if;
  if rule ? 'offset_months' and jsonb_typeof(rule -> 'offset_months') <> 'number' then
    return false;
  end if;
  if rule ? 'year_offset' and jsonb_typeof(rule -> 'year_offset') <> 'number' then
    return false;
  end if;

  -- Exigences propres à chaque ancre.
  --
  -- ⚠️ `jsonb_typeof(x -> 'absent')` rend NULL, et `NULL <> 'number'` vaut NULL,
  -- pas TRUE : un test écrit naïvement laisserait donc passer une clé manquante.
  -- D'où le coalesce systématique, et un IF par condition — l'ordre d'évaluation
  -- des AND/OR n'est pas garanti, celui de deux IF successifs l'est.
  if anchor_value = 'FIXED_DATE' then
    if coalesce(jsonb_typeof(rule -> 'fixed_month'), '') <> 'number' then
      return false;
    end if;
    if coalesce(jsonb_typeof(rule -> 'fixed_day'), '') <> 'number' then
      return false;
    end if;
    if (rule ->> 'fixed_month')::int not between 1 and 12 then
      return false;
    end if;
    if (rule ->> 'fixed_day')::int not between 1 and 31 then
      return false;
    end if;
  elsif not (rule ? 'offset_days') then
    -- PERIOD_END, PERIOD_START, EXPIRY_DATE et EVENT_DATE se calculent tous par
    -- décalage : sans offset_days, la règle serait ambiguë.
    return false;
  end if;

  -- occurrences[] appartient exclusivement à CUSTOM.
  if p = 'CUSTOM' then
    if coalesce(jsonb_typeof(rule -> 'occurrences'), '') <> 'array' then
      return false;
    end if;
    if jsonb_array_length(rule -> 'occurrences') = 0 then
      return false;
    end if;

    for element in select value from jsonb_array_elements(rule -> 'occurrences') loop
      if coalesce(jsonb_typeof(element), '') <> 'object' then
        return false;
      end if;
      if coalesce(jsonb_typeof(element -> 'month'), '') <> 'number' then
        return false;
      end if;
      if coalesce(jsonb_typeof(element -> 'day'), '') <> 'number' then
        return false;
      end if;
      if (element ->> 'month')::int not between 1 and 12 then
        return false;
      end if;
      if (element ->> 'day')::int not between 1 and 31 then
        return false;
      end if;
    end loop;
  elsif rule ? 'occurrences' then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.is_valid_due_rule(jsonb, public.periodicity) is
  'Valide la forme déclarative de due_rule et sa cohérence avec la périodicité. '
  'Le calcul d''échéance lui-même reste applicatif (src/lib/dates.ts) ; ici on '
  'garantit seulement qu''une règle stockée est interprétable.';

-- =============================================================================
-- 7. RÉFÉRENTIEL DES OBLIGATIONS
-- =============================================================================

create table public.obligation_types (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.entities (id) on delete restrict,
  code text not null,
  name text not null,
  domain_id uuid references public.domains (id) on delete restrict,
  authority_id uuid references public.authorities (id) on delete restrict,

  periodicity public.periodicity not null,
  due_rule jsonb not null,
  internal_lead_days int not null default 0 check (internal_lead_days >= 0),

  procedure_md text,
  legal_basis text,
  portal_url text,

  default_owner_id uuid references public.profiles (id) on delete restrict,
  default_validator_id uuid references public.profiles (id) on delete restrict,

  criticality public.criticality not null default 'MEDIUM',
  requires_validation boolean not null default true,
  validation_levels int not null default 1 check (validation_levels between 1 and 2),
  requires_proof boolean not null default true,
  allow_self_validation boolean not null default false,

  depends_on_obligation_type_id uuid references public.obligation_types (id) on delete restrict,

  generation_horizon_months int not null default 18 check (generation_horizon_months > 0),
  retention_years int not null default 10 check (retention_years > 0),

  effective_from date not null,
  effective_to date,

  is_active boolean not null default true,

  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint obligation_types_entity_code_key unique (entity_id, code),
  constraint obligation_types_no_self_dependency check (depends_on_obligation_type_id <> id),
  constraint obligation_types_effective_range check (effective_to is null or effective_to >= effective_from),
  constraint obligation_types_due_rule_valid check (public.is_valid_due_rule(due_rule, periodicity))
);

comment on table public.obligation_types is
  'Référentiel : une obligation décrite une seule fois. Ajouter une obligation ne doit '
  'demander aucun déploiement de code — seulement une ligne ici (cf. CLAUDE.md §3.5).';
comment on column public.obligation_types.entity_id is
  'Colonne prévue pour un futur cloisonnement multi-sites. Les politiques RLS restent '
  'mono-entité en v1 ; leur extension ne nécessitera aucune migration de schéma.';
comment on column public.obligation_types.due_rule is
  'Règle de calcul d''échéance, strictement déclarative. Forme attendue : '
  '{"anchor":"PERIOD_END|PERIOD_START|FIXED_DATE|EXPIRY_DATE|EVENT_DATE", '
  '"offset_days":int, "offset_months":int, "fixed_month":1-12, "fixed_day":1-31, '
  '"year_offset":int, "occurrences":[{"month":int,"day":int}], '
  '"weekend_shift":..., "holiday_shift":...}. '
  'year_offset décale l''année d''échéance par rapport à la période (bilan de l''exercice '
  '2026 déposé en 2027). offset_days négatif recule l''échéance (renouvellement 90 jours '
  'avant expiration). occurrences[] n''est lu que si periodicity = CUSTOM.';
comment on column public.obligation_types.internal_lead_days is
  'Marge interne, en jours, entre l''échéance affichée à l''équipe et l''échéance légale.';
comment on column public.obligation_types.procedure_md is
  'Mode opératoire rédigé en Markdown, affiché à l''agent qui traite l''occurrence.';
comment on column public.obligation_types.legal_basis is
  'Référence du texte fondant l''obligation. Champ libre : aucune règle réglementaire '
  'n''est interprétée par le code.';
comment on column public.obligation_types.validation_levels is
  '1 = validation simple, 2 = double validation. Borné à 2 : au-delà, le circuit '
  'devient plus coûteux que le risque couvert.';
comment on column public.obligation_types.allow_self_validation is
  'Autorise le responsable à valider sa propre occurrence. false par défaut : '
  'la séparation des tâches est la règle, l''exception se déclare.';
comment on column public.obligation_types.depends_on_obligation_type_id is
  'Obligation qui doit être traitée avant celle-ci (ex. bilan avant liasse fiscale).';
comment on column public.obligation_types.effective_to is
  'Date de fin d''applicabilité. Une obligation abrogée conserve ses occurrences '
  'passées : on borne, on ne supprime pas.';
comment on column public.obligation_types.deleted_at is
  'Suppression logique uniquement (cf. CLAUDE.md §6).';

create table public.obligation_required_documents (
  id uuid primary key default gen_random_uuid(),
  obligation_type_id uuid not null
    references public.obligation_types (id) on delete cascade,
  label text not null,
  description text,
  is_mandatory boolean not null default true,
  document_kind text,
  accepted_mime_types text[],
  max_size_mb int not null default 25 check (max_size_mb > 0),
  order_index int not null,
  created_at timestamptz not null default now(),
  constraint obligation_required_documents_order_key unique (obligation_type_id, order_index)
);

comment on table public.obligation_required_documents is
  'Pièces attendues pour une obligation. CASCADE assumé : cette table décrit le '
  'référentiel, elle ne porte aucune trace d''audit ni aucun document déposé.';
comment on column public.obligation_required_documents.accepted_mime_types is
  'Restriction supplémentaire à la liste blanche applicative (ALLOWED_MIME_TYPES). '
  'NULL = liste blanche applicative seule.';
comment on column public.obligation_required_documents.order_index is
  'Ordre d''affichage. Unique par obligation : deux pièces ne peuvent pas se disputer '
  'la même position.';

-- =============================================================================
-- 8. MOTEUR D'OCCURRENCES
-- =============================================================================

create table public.obligation_occurrences (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.entities (id) on delete restrict,
  obligation_type_id uuid not null
    references public.obligation_types (id) on delete restrict,

  period_key text not null,
  period_start date not null,
  period_end date not null,
  event_date date,
  expiry_date date,

  legal_due_date date not null,
  internal_due_date date not null,

  status public.occurrence_status not null default 'TODO',

  owner_id uuid references public.profiles (id) on delete restrict,
  validator_id uuid references public.profiles (id) on delete restrict,

  rectifies_occurrence_id uuid references public.obligation_occurrences (id) on delete restrict,
  rectification_index int not null default 0 check (rectification_index >= 0),

  started_at timestamptz,
  submitted_for_validation_at timestamptz,
  validated_at timestamptz,
  validated_by uuid references public.profiles (id) on delete restrict,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete restrict,
  reference_number text,

  na_reason text,
  rejection_reason text,
  late_reason text,

  penalty_incurred boolean not null default false,
  penalty_note text,

  is_locked boolean not null default false,
  locked_at timestamptz,
  locked_by uuid references public.profiles (id) on delete restrict,

  version int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint obligation_occurrences_period_key
    unique (entity_id, obligation_type_id, period_key),
  constraint obligation_occurrences_period_order check (period_end >= period_start),
  constraint obligation_occurrences_due_order check (internal_due_date <= legal_due_date),
  constraint obligation_occurrences_na_reason
    check (status <> 'NOT_APPLICABLE' or na_reason is not null),
  constraint obligation_occurrences_rejection_reason
    check (status <> 'REJECTED' or rejection_reason is not null),
  constraint obligation_occurrences_rectification_link
    check (rectification_index = 0 or rectifies_occurrence_id is not null),
  constraint obligation_occurrences_no_self_rectification
    check (rectifies_occurrence_id <> id)
);

comment on table public.obligation_occurrences is
  'Instance datée d''une obligation — l''objet de travail quotidien. Générée '
  'automatiquement ; jamais saisie à la main dans le flux nominal. '
  'AUCUNE colonne de montant, par décision arrêtée : la plateforme suit la démarche, '
  'pas les chiffres.';
comment on column public.obligation_occurrences.entity_id is
  'Colonne prévue pour un futur cloisonnement multi-sites. Les politiques RLS restent '
  'mono-entité en v1 ; leur extension ne nécessitera aucune migration de schéma.';
comment on column public.obligation_occurrences.period_key is
  'Clé lisible et triable de la période : 2026-01, 2026-Q1, 2026-S1, 2026, 2026-2027, '
  '2026-D0331 (date fixe), 2026-E0315 (événement). Une rectificative suffixe la clé de '
  'base : 2026-01-R1. Elle coexiste donc avec 2026-01 sans violer l''unicité.';
comment on column public.obligation_occurrences.event_date is
  'Date du fait déclencheur. Renseignée pour les obligations ON_EVENT.';
comment on column public.obligation_occurrences.expiry_date is
  'Date d''expiration du titre concerné. Renseignée quand due_rule.anchor = EXPIRY_DATE.';
comment on column public.obligation_occurrences.legal_due_date is
  'Échéance opposable, après application des reports week-end et jours fériés.';
comment on column public.obligation_occurrences.internal_due_date is
  'Échéance interne, toujours antérieure ou égale à l''échéance légale.';
comment on column public.obligation_occurrences.rectifies_occurrence_id is
  'Occurrence d''origine, pour une déclaration rectificative. ON DELETE RESTRICT : '
  'une rectificative sans son originale n''aurait aucun sens.';
comment on column public.obligation_occurrences.rectification_index is
  '0 pour le dépôt initial, n pour la n-ième rectificative. Cohérent avec le suffixe -Rn '
  'de period_key.';
comment on column public.obligation_occurrences.reference_number is
  'Numéro d''accusé de réception délivré par l''administration au dépôt.';
comment on column public.obligation_occurrences.late_reason is
  'Explication d''un dépôt hors délai. Renseigné a posteriori, à des fins d''analyse.';
comment on column public.obligation_occurrences.penalty_incurred is
  'Une pénalité a été notifiée. Le fait est tracé ; son MONTANT ne l''est pas, et ne '
  'doit pas l''être.';
comment on column public.obligation_occurrences.is_locked is
  'Occurrence archivée : toute modification est refusée par trigger. Seule la transition '
  'ARCHIVED → SUBMITTED, soumise à occurrence.unlock, rouvre le dossier.';
comment on column public.obligation_occurrences.version is
  'Verrouillage optimiste. Incrémenté par trigger à chaque UPDATE : l''appelant qui a lu '
  'la version N doit écrire avec WHERE version = N, sinon il écrase une modification '
  'concurrente sans le savoir.';

create table public.occurrence_checklist_items (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null
    references public.obligation_occurrences (id) on delete cascade,
  required_document_id uuid
    references public.obligation_required_documents (id) on delete set null,
  label text not null,
  is_mandatory boolean not null default true,
  document_kind text,
  is_checked boolean not null default false,
  checked_by uuid references public.profiles (id) on delete restrict,
  checked_at timestamptz,
  order_index int not null,
  created_at timestamptz not null default now()
);

comment on table public.occurrence_checklist_items is
  'Copie figée des pièces attendues, prise à la génération de l''occurrence. Figée '
  'volontairement : modifier le référentiel ne doit pas réécrire l''historique des '
  'dossiers déjà traités.';
comment on column public.occurrence_checklist_items.required_document_id is
  'Lien vers la pièce du référentiel. ON DELETE SET NULL : le libellé reste lisible '
  'même si la pièce disparaît du référentiel.';

-- -----------------------------------------------------------------------------
-- Journal des transitions — APPEND-ONLY (cf. CLAUDE.md §3.6)
-- -----------------------------------------------------------------------------

create table public.occurrence_transitions (
  id bigserial primary key,
  occurrence_id uuid not null
    references public.obligation_occurrences (id) on delete restrict,
  from_status public.occurrence_status,
  to_status public.occurrence_status not null,
  actor_id uuid references public.profiles (id) on delete restrict,
  on_behalf_of_id uuid references public.profiles (id) on delete restrict,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.occurrence_transitions is
  'Historique des changements d''état. APPEND-ONLY : UPDATE et DELETE sont rejetés par '
  'trigger. Aucun ON DELETE CASCADE ne pointe vers cette table — supprimer une occurrence '
  'ne doit pas pouvoir effacer son histoire.';
comment on column public.occurrence_transitions.from_status is
  'NULL pour la ligne de création de l''occurrence.';
comment on column public.occurrence_transitions.on_behalf_of_id is
  'Délégant, lorsque l''action est faite au nom d''un autre. actor_id reste la personne '
  'qui a réellement agi : une délégation n''efface pas l''auteur.';

create table public.occurrence_comments (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null
    references public.obligation_occurrences (id) on delete restrict,
  author_id uuid references public.profiles (id) on delete restrict,
  body text not null check (length(body) between 1 and 5000),
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.occurrence_comments is
  'Échanges attachés à une occurrence. ON DELETE RESTRICT : un commentaire peut porter '
  'une justification de retard, il ne disparaît pas silencieusement.';
comment on column public.occurrence_comments.mentioned_user_ids is
  'Personnes mentionnées, à notifier. Tableau et non table de liaison : la donnée est '
  'lue avec le commentaire, jamais seule.';

-- =============================================================================
-- 9. MACHINE À ÉTATS — EN DONNÉES
--    Aucune transition n'est codée en dur, ni ici ni dans l'application.
--    Ajouter un chemin de workflow est une insertion, pas un déploiement.
-- =============================================================================

create table public.status_transition_rules (
  id uuid primary key default gen_random_uuid(),
  from_status public.occurrence_status not null,
  to_status public.occurrence_status not null,
  required_permission text not null,
  requires_reason boolean not null default false,
  locks_occurrence boolean not null default false,
  label text not null,
  constraint status_transition_rules_pair_key unique (from_status, to_status),
  constraint status_transition_rules_no_self check (from_status <> to_status)
);

comment on table public.status_transition_rules is
  'Transitions autorisées du cycle de vie d''une occurrence. Le trigger de validation '
  'lit CETTE table : une transition absente d''ici est refusée, sans exception.';
comment on column public.status_transition_rules.required_permission is
  'Permission applicative attendue. Vérifiée en 2.2 par la RLS ; conservée ici pour que '
  'l''interface sache quelles actions proposer.';
comment on column public.status_transition_rules.locks_occurrence is
  'La transition verrouille le dossier : plus aucune modification n''est acceptée.';

insert into public.status_transition_rules
  (from_status, to_status, required_permission, requires_reason, locks_occurrence, label)
values
  ('TODO',               'IN_PROGRESS',        'occurrence.write',    false, false, 'Démarrer le traitement'),
  ('TODO',               'NOT_APPLICABLE',     'occurrence.mark_na',  true,  false, 'Déclarer sans objet'),
  ('IN_PROGRESS',        'PENDING_VALIDATION', 'occurrence.submit',   false, false, 'Envoyer en validation'),
  ('IN_PROGRESS',        'TODO',               'occurrence.write',    false, false, 'Remettre à faire'),
  ('PENDING_VALIDATION', 'VALIDATED',          'occurrence.validate', false, false, 'Valider'),
  ('PENDING_VALIDATION', 'REJECTED',           'occurrence.validate', true,  false, 'Rejeter'),
  ('REJECTED',           'IN_PROGRESS',        'occurrence.write',    false, false, 'Reprendre après rejet'),
  ('VALIDATED',          'SUBMITTED',          'occurrence.submit',   false, false, 'Déclarer déposé'),
  ('SUBMITTED',          'ARCHIVED',           'occurrence.write',    false, true,  'Archiver'),
  ('ARCHIVED',           'SUBMITTED',          'occurrence.unlock',   true,  false, 'Rouvrir un dossier archivé'),
  ('NOT_APPLICABLE',     'TODO',               'occurrence.write',    true,  false, 'Rendre applicable');

-- =============================================================================
-- 10. INDEX
--     Chacun couvre une requête réelle de l'application. Un index sans requête
--     est un coût d'écriture permanent pour un gain nul.
-- =============================================================================

-- Écran de travail principal : occurrences d'une entité, filtrées par état,
-- triées par échéance. Requête la plus fréquente de l'application.
create index obligation_occurrences_entity_status_due_idx
  on public.obligation_occurrences (entity_id, status, legal_due_date)
  where deleted_at is null;

-- « Mes dossiers » : ce que l'agent connecté doit traiter.
create index obligation_occurrences_owner_status_idx
  on public.obligation_occurrences (owner_id, status)
  where deleted_at is null;

-- Historique d'une obligation, de la période la plus récente à la plus ancienne.
create index obligation_occurrences_type_period_idx
  on public.obligation_occurrences (obligation_type_id, period_start desc);

-- Balayage des échéances par le job de notification et d'escalade : ne considère
-- que les dossiers encore vivants, ce qui exclut l'essentiel de la table à terme.
create index obligation_occurrences_open_due_idx
  on public.obligation_occurrences (legal_due_date)
  where status not in ('ARCHIVED', 'NOT_APPLICABLE', 'SUBMITTED');

-- Remontée des rectificatives d'une occurrence. Index partiel : la colonne est
-- nulle sur l'immense majorité des lignes.
create index obligation_occurrences_rectifies_idx
  on public.obligation_occurrences (rectifies_occurrence_id)
  where rectifies_occurrence_id is not null;

-- Navigation du référentiel par domaine, limitée aux obligations en vigueur.
create index obligation_types_entity_domain_idx
  on public.obligation_types (entity_id, domain_id)
  where is_active and deleted_at is null;

-- Chargement du journal d'une occurrence, du plus récent au plus ancien.
create index occurrence_transitions_occurrence_idx
  on public.occurrence_transitions (occurrence_id, created_at desc);

-- Fil de discussion d'une occurrence.
create index occurrence_comments_occurrence_idx
  on public.occurrence_comments (occurrence_id, created_at desc)
  where deleted_at is null;

-- Cases à cocher d'une occurrence, dans l'ordre d'affichage.
create index occurrence_checklist_items_occurrence_idx
  on public.occurrence_checklist_items (occurrence_id, order_index);

-- =============================================================================
-- 11. TRIGGERS
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Horodate la modification côté base. L''appelant ne peut donc pas mentir sur updated_at.';

create or replace function public.bump_version()
returns trigger
language plpgsql
as $$
begin
  -- Toujours OLD + 1, jamais la valeur fournie : sinon un client pourrait figer
  -- son numéro de version et neutraliser le verrouillage optimiste.
  new.version := old.version + 1;
  return new;
end;
$$;

comment on function public.bump_version() is
  'Verrouillage optimiste : incrémente version à chaque UPDATE, quoi que demande l''appelant.';

create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Table append-only : % interdit sur %.', tg_op, tg_table_name
    using errcode = '23514',
          hint = 'Cette table est un journal d''audit : elle ne se corrige pas, elle se complète.';
end;
$$;

create or replace function public.enforce_occurrence_lock()
returns trigger
language plpgsql
as $$
begin
  if not old.is_locked then
    return new;
  end if;

  -- Unique porte de sortie : la réouverture d'un dossier archivé, elle-même
  -- soumise à occurrence.unlock par status_transition_rules.
  if old.status = 'ARCHIVED' and new.status = 'SUBMITTED' then
    return new;
  end if;

  raise exception 'Occurrence verrouillée (id=%) : aucune modification acceptée.', old.id
    using errcode = '23514',
          hint = 'Rouvrir le dossier par la transition ARCHIVED → SUBMITTED (permission occurrence.unlock).';
end;
$$;

comment on function public.enforce_occurrence_lock() is
  'Refuse toute écriture sur une occurrence verrouillée, hormis sa réouverture.';

create or replace function public.validate_status_transition()
returns trigger
language plpgsql
as $$
declare
  rule public.status_transition_rules%rowtype;
  resolved_reason text;
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

  -- Le motif vient soit d'une colonne dédiée, soit du GUC posé par l'appelant.
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
  'Autorise ou refuse un changement d''état en lisant public.status_transition_rules. '
  'AUCUNE transition n''est écrite en dur ici : ajouter un chemin de workflow est une '
  'insertion de données.';

create or replace function public.record_status_transition()
returns trigger
language plpgsql
as $$
declare
  previous_status public.occurrence_status;
begin
  -- AFTER, et non BEFORE : en BEFORE INSERT la ligne n'existe pas encore et la
  -- clé étrangère du journal échouerait.
  if tg_op = 'INSERT' then
    previous_status := null;
  else
    if new.status is not distinct from old.status then
      return null;
    end if;
    previous_status := old.status;
  end if;

  insert into public.occurrence_transitions
    (occurrence_id, from_status, to_status, actor_id, reason, metadata)
  values (
    new.id,
    previous_status,
    new.status,
    public.app_actor_id(),
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
  'Écrit le journal d''état. Porté par un trigger et non par l''appelant : la traçabilité '
  'ne repose pas sur la discipline du code appelant (cf. CLAUDE.md §3.6).';

-- -----------------------------------------------------------------------------
-- Attachement. Les préfixes numériques fixent l'ordre : PostgreSQL déclenche les
-- triggers BEFORE par ordre alphabétique de nom.
-- -----------------------------------------------------------------------------

create trigger trg_occurrences_10_enforce_lock
  before update on public.obligation_occurrences
  for each row execute function public.enforce_occurrence_lock();

create trigger trg_occurrences_20_validate_transition
  before update on public.obligation_occurrences
  for each row execute function public.validate_status_transition();

create trigger trg_occurrences_30_bump_version
  before update on public.obligation_occurrences
  for each row execute function public.bump_version();

create trigger trg_occurrences_40_set_updated_at
  before update on public.obligation_occurrences
  for each row execute function public.set_updated_at();

create trigger trg_occurrences_90_record_transition
  after insert or update on public.obligation_occurrences
  for each row execute function public.record_status_transition();

create trigger trg_obligation_types_set_updated_at
  before update on public.obligation_types
  for each row execute function public.set_updated_at();

create trigger trg_profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_occurrence_comments_set_updated_at
  before update on public.occurrence_comments
  for each row execute function public.set_updated_at();

create trigger trg_occurrence_transitions_append_only
  before update or delete on public.occurrence_transitions
  for each row execute function public.reject_mutation();
