-- =============================================================================
-- CONFORMIA — 0003 : audit inaltérable, documents, stockage
--
-- Exigence numéro un : le journal doit résister à l'administrateur lui-même.
-- Quatre verrous cumulés, indépendants les uns des autres :
--   1. REVOKE UPDATE/DELETE, y compris pour service_role ;
--   2. trigger BEFORE UPDATE OR DELETE qui lève systématiquement — il s'applique
--      même à un superutilisateur, que les privilèges n'arrêtent pas ;
--   3. RLS sans aucune politique UPDATE ni DELETE ;
--   4. absence totale de ON DELETE CASCADE pointant vers ces tables.
--
-- Aucun de ces verrous n'est suffisant seul. C'est leur cumul qui fait la garantie.
-- =============================================================================

-- =============================================================================
-- 1. RÉGLAGES APPLICATIFS — passage au format clé/valeur
--
--    0002 avait créé `app_settings` en table à ligne unique, à colonnes typées.
--    Le format retenu est clé/valeur : ajouter un réglage ne doit plus demander
--    de migration. La table est donc reconstruite, et les trois fonctions qui la
--    lisaient sont réécrites plus bas.
-- =============================================================================

drop policy if exists app_settings_select on public.app_settings;
drop policy if exists app_settings_update on public.app_settings;
drop table if exists public.app_settings;

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  value_type text not null check (value_type in ('boolean', 'integer', 'array', 'object', 'string')),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is
  'Paramètres modifiables sans redéploiement. Format clé/valeur : un nouveau réglage '
  'est une ligne, pas une migration. Les valeurs sont typées par value_type pour que '
  'l''interface d''administration sache quel contrôle afficher.';

insert into public.app_settings (key, value, description, value_type) values
  ('allow_self_validation', 'false'::jsonb,
   'Autorise globalement un préparateur à valider son propre dossier. La séparation des tâches est la règle.',
   'boolean'),
  ('require_mfa_all_users', 'false'::jsonb,
   'Impose le second facteur à tous les comptes.', 'boolean'),
  ('session_timeout_minutes', '30'::jsonb,
   'Durée d''inactivité avant déconnexion, en minutes.', 'integer'),
  ('notification_offsets_days', '[-30,-15,-7,-1,1,3,7]'::jsonb,
   'Jalons de notification en jours par rapport à l''échéance. Négatif = rappel avant, positif = relance après.',
   'array'),
  ('escalation_standard_days', '{"owner":1,"department_head":3,"direction":7}'::jsonb,
   'Jours de retard déclenchant chaque palier d''escalade, cas courant.', 'object'),
  ('escalation_critical_days', '{"owner":0,"department_head":0,"direction":2}'::jsonb,
   'Idem pour une obligation CRITICAL : la direction est alertée sans délai.', 'object'),
  ('validation_fallback_days', '5'::jsonb,
   'Jours ouvrés au-delà desquels la DIRECTION peut valider, quelle que soit la chaîne prévue.',
   'integer'),
  ('max_upload_mb', '25'::jsonb, 'Taille maximale d''une pièce, en Mo.', 'integer'),
  ('max_occurrence_total_mb', '200'::jsonb,
   'Volume cumulé des pièces d''une même occurrence, en Mo.', 'integer'),
  ('retention_default_years', '10'::jsonb,
   'Durée de conservation par défaut des pièces, en années.', 'integer'),
  ('signed_url_ttl_seconds', '300'::jsonb,
   'Durée de vie d''une URL signée de téléchargement, en secondes.', 'integer'),
  ('generation_horizon_months', '18'::jsonb,
   'Profondeur de génération d''occurrences à l''avance, en mois.', 'integer'),
  ('weekly_digest_day', '1'::jsonb,
   'Jour d''envoi du récapitulatif hebdomadaire (1 = lundi).', 'integer'),
  ('weekly_digest_hour', '7'::jsonb,
   'Heure d''envoi du récapitulatif, fuseau Africa/Algiers.', 'integer'),
  ('email_provider', '"resend"'::jsonb, 'Fournisseur d''envoi de courriel.', 'string'),
  ('admin_ip_allowlist', '[]'::jsonb,
   'Adresses IP autorisées pour l''administration. Vide = aucune restriction.', 'array'),
  -- Ajout hors liste initiale, assumé : `add_business_days()` lit ce réglage.
  -- Sans lui, le week-end algérien redeviendrait une constante figée dans le SQL,
  -- ce que le projet s'interdit partout ailleurs.
  ('weekend_days', '[5,6]'::jsonb,
   'Jours chômés hebdomadaires, indices extract(dow) : 0=dimanche … 6=samedi. [5,6] = vendredi et samedi.',
   'array');

create or replace function public.setting_int(setting_key text, fallback int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::int from public.app_settings s where s.key = setting_key), fallback);
$$;

create or replace function public.setting_bool(setting_key text, fallback boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = setting_key), fallback);
$$;

comment on function public.setting_int(text, int) is
  'Lecture typée d''un réglage entier, avec repli. Le repli évite qu''une clé effacée '
  'par erreur ne bloque une transition ou un calcul d''échéance.';

-- Réécriture des trois fonctions qui lisaient l'ancienne forme.
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
  select coalesce(
           (select array_agg(value::int) from public.app_settings s,
                   lateral jsonb_array_elements_text(s.value) as value
             where s.key = 'weekend_days'),
           array[5, 6])
    into weekend;

  while remaining > 0 loop
    cursor_date := cursor_date + 1;
    if not (extract(dow from cursor_date)::int = any (weekend))
       and not exists (
         select 1 from public.holidays h
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

create or replace function public.enforce_separation_of_duties()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
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

  select ot.allow_self_validation into allow_for_type
  from public.obligation_types ot where ot.id = new.obligation_type_id;

  if public.setting_bool('allow_self_validation', false) or coalesce(allow_for_type, false) then
    return new;
  end if;

  raise exception
    'Séparation des tâches : le préparateur d''une occurrence ne peut pas la valider.'
    using errcode = '42501',
          hint = 'Faire valider par un tiers, ou lever l''interdiction sur cette obligation.';
end;
$$;

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
begin
  select * into occ from public.obligation_occurrences where id = occurrence_id;
  if not found then
    return false;
  end if;

  occ_domain := public.obligation_domain_of_type(occ.obligation_type_id);

  if public.has_permission_in_domain('occurrence.validate', occ_domain) then
    return true;
  end if;

  if occ.status = 'PENDING_VALIDATION' and occ.submitted_for_validation_at is not null then
    if current_date > public.add_business_days(
         occ.submitted_for_validation_at::date,
         public.setting_int('validation_fallback_days', 5))
       and exists (
         select 1 from public.user_roles ur
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

alter table public.app_settings enable row level security;

create policy app_settings_select on public.app_settings
  for select to authenticated using (public.is_active_user());
comment on policy app_settings_select on public.app_settings is
  'Les réglages pilotent l''interface et ne contiennent aucun secret : lisibles par tout compte actif.';

create policy app_settings_update on public.app_settings
  for update to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));
comment on policy app_settings_update on public.app_settings is
  'Écriture réservée à settings.manage. Ni INSERT ni DELETE : le jeu de clés est '
  'défini par migration, sa valeur seule est modifiable à chaud.';

grant select, update on public.app_settings to authenticated;

-- =============================================================================
-- 2. JOURNAL D'AUDIT — partitionné par mois
-- =============================================================================

create table public.audit_log (
  id bigint generated by default as identity,
  occurred_at timestamptz not null default now(),
  entity_id uuid,
  actor_id uuid,
  -- Dénormalisé volontairement : l'adresse doit rester lisible même si le compte
  -- est supprimé. Un journal qui perd l'identité de l'auteur ne prouve plus rien.
  actor_email text,
  on_behalf_of_id uuid,
  action text not null check (action in (
    'INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT',
    'VIEW', 'DOWNLOAD', 'EXPORT', 'PERMISSION_CHANGE', 'UNLOCK', 'MFA_RESET'
  )),
  entity_table text not null,
  entity_id_ref text,
  before jsonb,
  after jsonb,
  changed_fields text[],
  ip_address inet,
  user_agent text,
  request_id text,
  primary key (id, occurred_at)
) partition by range (occurred_at);

comment on table public.audit_log is
  'Journal d''audit. APPEND-ONLY, sans exception et sans échappatoire administrative. '
  'Partitionné par mois : la rétention de 10 ans se gère en détachant des partitions, '
  'jamais en supprimant des lignes. Aucune clé étrangère vers profiles — un journal ne '
  'doit pas pouvoir être bloqué, ni cascadé, par le cycle de vie des comptes.';
comment on column public.audit_log.actor_email is
  'Copie de l''adresse au moment de l''action. Survit à la suppression du compte.';
comment on column public.audit_log.entity_id_ref is
  'Identifiant de la ligne auditée, en texte : les clés primaires ne sont pas toutes uuid '
  '(occurrence_transitions est en bigint).';
comment on column public.audit_log.changed_fields is
  'Colonnes réellement modifiées. Permet de filtrer « qui a touché au statut » sans '
  'comparer deux jsonb à la lecture.';
comment on column public.audit_log.before is
  'État avant modification, colonnes sensibles occultées (voir audit_redacted_columns).';

create index audit_log_entity_idx on public.audit_log (entity_table, entity_id_ref, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);
create index audit_log_occurred_idx on public.audit_log (occurred_at desc);

-- -----------------------------------------------------------------------------

create table public.document_access_log (
  id bigint generated by default as identity,
  document_id uuid not null,
  actor_id uuid,
  action text not null check (action in ('SIGNED_URL_ISSUED', 'VIEW', 'DOWNLOAD')),
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

comment on table public.document_access_log is
  'Traçabilité des accès aux pièces. Décision arrêtée : TOUT est journalisé, y compris '
  'la simple prévisualisation. Volumétrie attendue ~5 000 événements/an — négligeable '
  'au regard de la question « qui a consulté cette déclaration, et quand ». '
  'Pas de clé étrangère vers documents : la trace d''un accès survit à la pièce.';

create index document_access_log_document_idx
  on public.document_access_log (document_id, created_at desc);
create index document_access_log_actor_idx
  on public.document_access_log (actor_id, created_at desc);

-- =============================================================================
-- 3. PARTITIONS MENSUELLES
-- =============================================================================

create or replace function public.ensure_month_partition(base_table text, month_start date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  partition_name text;
  range_start date := date_trunc('month', month_start)::date;
  range_end date := (date_trunc('month', month_start) + interval '1 month')::date;
begin
  partition_name := format('%s_%s', base_table, to_char(range_start, 'YYYY"m"MM'));

  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = partition_name
  ) then
    return;
  end if;

  execute format(
    'create table public.%I partition of public.%I for values from (%L) to (%L)',
    partition_name, base_table, range_start, range_end
  );

  -- Chaque partition porte sa propre RLS : interrogée directement, elle n'hérite
  -- pas des politiques du parent. Aucun GRANT n'est posé dessus — l'accès légitime
  -- passe par la table parente.
  execute format('alter table public.%I enable row level security', partition_name);
end;
$$;

comment on function public.ensure_month_partition(text, date) is
  'Crée si besoin la partition mensuelle d''une table partitionnée. Idempotente.';

create or replace function public.create_upcoming_partitions(months_ahead int default 3)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  offset_month int;
begin
  for offset_month in 0..months_ahead loop
    perform public.ensure_month_partition(
      'audit_log', (date_trunc('month', current_date) + make_interval(months => offset_month))::date);
    perform public.ensure_month_partition(
      'document_access_log', (date_trunc('month', current_date) + make_interval(months => offset_month))::date);
  end loop;
end;
$$;

comment on function public.create_upcoming_partitions(int) is
  'Crée les partitions du mois courant et des mois suivants. Appelée par pg_cron le 25 '
  'de chaque mois — le 25 et non le 31, pour que février ne soit pas un cas particulier.';

-- Amorçage large : 26 mois d'avance. Même si le planificateur venait à ne pas
-- s'exécuter, aucune écriture d'audit ne serait refusée avant deux ans.
do $$
declare
  offset_month int;
begin
  for offset_month in -1..25 loop
    perform public.ensure_month_partition(
      'audit_log', (date_trunc('month', current_date) + make_interval(months => offset_month))::date);
    perform public.ensure_month_partition(
      'document_access_log', (date_trunc('month', current_date) + make_interval(months => offset_month))::date);
  end loop;
end;
$$;

-- Planification. Enveloppée : une installation sans pg_cron doit rester
-- fonctionnelle, les partitions étant déjà créées pour deux ans.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('conformia-monthly-partitions')
  where exists (select 1 from cron.job where jobname = 'conformia-monthly-partitions');
  perform cron.schedule(
    'conformia-monthly-partitions',
    '0 3 25 * *',
    $job$select public.create_upcoming_partitions(3)$job$
  );
exception when others then
  raise notice 'pg_cron indisponible (%). Partitions pré-créées jusqu''à 25 mois ; '
               'planifier public.create_upcoming_partitions() par un autre moyen.', sqlerrm;
end;
$$;

-- =============================================================================
-- 4. INALTÉRABILITÉ
-- =============================================================================

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Journal d''audit inaltérable : % refusé sur %.', tg_op, tg_table_name
    using errcode = '42501',
          hint = 'Un journal se complète, il ne se corrige pas. Aucune exception, y compris pour l''administrateur.';
end;
$$;

create trigger trg_audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_mutation();

create trigger trg_document_access_log_immutable
  before update or delete on public.document_access_log
  for each row execute function public.reject_audit_mutation();

revoke update, delete on public.audit_log from public, anon, authenticated, service_role;
revoke update, delete on public.document_access_log from public, anon, authenticated, service_role;
revoke insert on public.audit_log from public, anon, authenticated, service_role;

alter table public.audit_log enable row level security;
alter table public.document_access_log enable row level security;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_active_user() and public.has_permission('audit.read'));
comment on policy audit_log_select on public.audit_log is
  'Lecture réservée à audit.read. Aucune politique INSERT : les lignes ne naissent que '
  'des triggers SECURITY DEFINER. Aucune politique UPDATE ni DELETE : leur absence est '
  'le troisième verrou, après le REVOKE et le trigger.';

-- La politique de document_access_log dépend de public.documents : elle est posée
-- en section 6, une fois la table créée.

grant select on public.audit_log to authenticated;
grant select on public.document_access_log to authenticated;

-- Pas de GRANT INSERT : la journalisation d'accès passe exclusivement par
-- public.log_document_access(), définie en section 6. Autoriser l'insertion
-- directe permettrait de forger un actor_id, donc d'attribuer une consultation
-- à quelqu'un d'autre — exactement ce que ce journal est censé empêcher.
revoke insert on public.document_access_log from public, anon, authenticated, service_role;

-- =============================================================================
-- 5. TRIGGER D'AUDIT GÉNÉRIQUE
-- =============================================================================

create table public.audit_redacted_columns (
  table_name text not null,
  column_name text not null,
  reason text not null,
  primary key (table_name, column_name)
);

comment on table public.audit_redacted_columns is
  'Colonnes dont la VALEUR est occultée dans le journal. Le fait qu''elles aient changé '
  'reste tracé — c''est la valeur, et elle seule, qui est remplacée. Sans cela, journaliser '
  'une rotation de jeton reviendrait à recopier le secret en clair dans une table conservée '
  'dix ans.';

insert into public.audit_redacted_columns (table_name, column_name, reason) values
  ('profiles', 'ics_token', 'Jeton porteur du flux calendrier : le journaliser équivaudrait à le publier.'),
  ('profiles', 'phone', 'Donnée personnelle sans valeur probante pour l''audit.'),
  ('app_settings', 'value', 'Peut contenir une liste d''adresses IP d''administration.');

alter table public.audit_redacted_columns enable row level security;

create policy audit_redacted_columns_select on public.audit_redacted_columns
  for select to authenticated
  using (public.is_active_user() and public.has_permission('audit.read'));
comment on policy audit_redacted_columns_select on public.audit_redacted_columns is
  'Savoir CE QUI est occulté relève de l''audit : un auditeur doit pouvoir vérifier que '
  'l''occultation ne sert pas à dissimuler.';

grant select on public.audit_redacted_columns to authenticated;

-- -----------------------------------------------------------------------------

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_data jsonb;
  after_data jsonb;
  changed text[];
  redacted text[];
  column_name text;
  row_identifier text;
  audited_entity uuid;
begin
  -- Colonnes à occulter pour CETTE table. Aucune branche par nom de table :
  -- la liste est une donnée, la fonction reste générique.
  select coalesce(array_agg(r.column_name), array[]::text[]) into redacted
  from public.audit_redacted_columns r
  where r.table_name = tg_table_name;

  if tg_op = 'DELETE' then
    before_data := to_jsonb(old);
    after_data := null;
  elsif tg_op = 'INSERT' then
    before_data := null;
    after_data := to_jsonb(new);
  else
    before_data := to_jsonb(old);
    after_data := to_jsonb(new);
  end if;

  -- Champs modifiés : calculés AVANT occultation, pour que le fait qu'une colonne
  -- sensible ait changé reste visible même si sa valeur ne l'est pas.
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key), array[]::text[]) into changed
    from jsonb_object_keys(before_data || after_data) as key
    where before_data -> key is distinct from after_data -> key;
  end if;

  foreach column_name in array redacted loop
    if before_data ? column_name then
      before_data := jsonb_set(before_data, array[column_name], '"[redacted]"'::jsonb);
    end if;
    if after_data ? column_name then
      after_data := jsonb_set(after_data, array[column_name], '"[redacted]"'::jsonb);
    end if;
  end loop;

  row_identifier := coalesce(after_data ->> 'id', before_data ->> 'id');
  audited_entity := nullif(coalesce(after_data ->> 'entity_id', before_data ->> 'entity_id'), '')::uuid;

  insert into public.audit_log (
    entity_id, actor_id, actor_email, on_behalf_of_id, action,
    entity_table, entity_id_ref, before, after, changed_fields, request_id
  )
  values (
    audited_entity,
    auth.uid(),
    (select p.email::text from public.profiles p where p.id = auth.uid()),
    (
      select d.delegator_id from public.validation_delegations d
      where d.delegate_id = auth.uid()
        and d.revoked_at is null
        and current_date between d.starts_at and d.ends_at
      limit 1
    ),
    tg_op,
    tg_table_name,
    row_identifier,
    before_data,
    after_data,
    changed,
    nullif(current_setting('conformia.request_id', true), '')
  );

  return coalesce(new, old);
end;
$$;

comment on function public.audit_trigger() is
  'Trigger d''audit unique, générique. S''appuie sur TG_TABLE_NAME, TG_OP et to_jsonb : '
  'aucune branche conditionnelle par nom de table, aucune duplication à maintenir. '
  '⚠️ Aucune capture d''exception : si l''écriture du journal échoue, la transaction '
  'métier est annulée. C''est délibéré — mieux vaut refuser une écriture que de la '
  'réaliser sans trace. Un système de conformité qui perd sa traçabilité en silence '
  'vaut moins que pas de système du tout.';

-- Attachement. AFTER : la ligne métier doit exister avant d'être journalisée.
create trigger trg_audit
  after insert or update or delete on public.obligation_types
  for each row execute function public.audit_trigger();
create trigger trg_audit
  after insert or update or delete on public.obligation_occurrences
  for each row execute function public.audit_trigger();
create trigger trg_audit
  after insert or update or delete on public.user_roles
  for each row execute function public.audit_trigger();
create trigger trg_audit
  after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();
create trigger trg_audit
  after insert or update or delete on public.obligation_required_documents
  for each row execute function public.audit_trigger();
create trigger trg_audit
  after insert or update or delete on public.role_permissions
  for each row execute function public.audit_trigger();
create trigger trg_audit
  after insert or update or delete on public.app_settings
  for each row execute function public.audit_trigger();
create trigger trg_audit
  after insert or update or delete on public.validation_delegations
  for each row execute function public.audit_trigger();

-- =============================================================================
-- 6. DOCUMENTS
-- =============================================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.entities (id) on delete restrict,
  occurrence_id uuid not null
    references public.obligation_occurrences (id) on delete restrict,
  checklist_item_id uuid
    references public.occurrence_checklist_items (id) on delete set null,

  bucket text not null default 'compliance-documents',
  storage_path text not null unique,

  original_filename text not null,
  normalized_filename text not null,

  mime_type text not null,
  detected_mime_type text,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  integrity_checked_at timestamptz,

  version int not null default 1 check (version > 0),
  supersedes_id uuid references public.documents (id) on delete restrict,
  document_kind text check (document_kind in
    ('JUSTIFICATIF', 'PREUVE_DEPOT', 'ANNEXE', 'CORRESPONDANCE')),

  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),

  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete restrict,
  deletion_reason text,

  constraint documents_version_key unique (occurrence_id, normalized_filename, version),
  constraint documents_no_self_supersede check (supersedes_id <> id),
  constraint documents_deletion_traced
    check (deleted_at is null or (deleted_by is not null and deletion_reason is not null))
);

comment on table public.documents is
  'Pièces justificatives. Le fichier vit dans Storage, la ligne porte son empreinte et '
  'sa traçabilité. Suppression logique uniquement, et jamais sans motif ni auteur.';
comment on column public.documents.storage_path is
  'Chemin dans le bucket, GÉNÉRÉ CÔTÉ SERVEUR EXCLUSIVEMENT, jamais reçu du client. '
  'Convention : {entity_code}/{domain_code}/{obligation_code}/{period_key}/{document_id}_{slug}.{ext}. '
  'Le nom d''origine n''entre dans le chemin qu''après assainissement complet en slug — '
  'un « ../ » ou un caractère de contrôle venu du navigateur ne doit jamais atteindre le stockage.';
comment on column public.documents.original_filename is
  'Nom du fichier tel que déposé. Conservé et affiché : l''utilisateur doit retrouver sa pièce.';
comment on column public.documents.normalized_filename is
  'Nom normalisé : {CODE_OBLIGATION}_{PERIODE}_{DOCUMENT_KIND}_v{N}.{ext}. C''est ce nom '
  'qui est proposé au téléchargement, pour que les pièces redéposées soient identifiables.';
comment on column public.documents.mime_type is
  'Type MIME annoncé par le client. N''est PAS une preuve.';
comment on column public.documents.detected_mime_type is
  'Type déduit de la signature réelle du fichier, côté serveur. C''est celui qui fait foi ; '
  'un écart avec mime_type est un signal à traiter.';
comment on column public.documents.sha256 is
  'Empreinte calculée au dépôt. Le contrôle d''intégrité recalcule et compare : un écart '
  'signifie que le fichier a été altéré dans le stockage.';
comment on column public.documents.supersedes_id is
  'Version précédente. On ne remplace jamais un fichier en place : on en dépose un nouveau '
  'qui pointe vers l''ancien, lequel reste consultable.';

create index documents_occurrence_idx
  on public.documents (occurrence_id, uploaded_at desc) where deleted_at is null;
create index documents_sha256_idx on public.documents (sha256);
create index documents_supersedes_idx
  on public.documents (supersedes_id) where supersedes_id is not null;
-- Balaie la file de purge : uploaded_at seul suffit, la rétention est jointe ensuite.
create index documents_uploaded_at_idx on public.documents (uploaded_at) where deleted_at is null;

create trigger trg_audit
  after insert or update or delete on public.documents
  for each row execute function public.audit_trigger();

alter table public.documents enable row level security;

create policy documents_select on public.documents
  for select to authenticated
  using (
    public.is_active_user()
    and deleted_at is null
    and public.has_permission_in_domain(
          'document.read', public.obligation_domain_of_occurrence(occurrence_id))
    and exists (select 1 from public.obligation_occurrences oc where oc.id = occurrence_id)
  );
comment on policy documents_select on public.documents is
  'Double condition : détenir document.read sur le domaine, ET voir déjà l''occurrence '
  'parente. Le EXISTS traverse la politique des occurrences, donc le cloisonnement par '
  'domaine s''applique aussi aux pièces. ADMIN n''a pas document.read : il ne lit aucune pièce.';

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    public.is_active_user()
    and uploaded_by = public.current_profile_id()
    and public.has_permission_in_domain(
          'document.upload', public.obligation_domain_of_occurrence(occurrence_id))
    and exists (select 1 from public.obligation_occurrences oc where oc.id = occurrence_id)
  );
comment on policy documents_insert on public.documents is
  'On dépose sous son propre nom, sur un dossier de son domaine. uploaded_by ne peut pas '
  'être usurpé : la politique le compare à l''utilisateur courant.';

create policy documents_update on public.documents
  for update to authenticated
  using (
    public.is_active_user()
    and public.has_permission_in_domain(
          'document.delete', public.obligation_domain_of_occurrence(occurrence_id))
  )
  with check (
    public.has_permission_in_domain(
      'document.delete', public.obligation_domain_of_occurrence(occurrence_id))
  );
comment on policy documents_update on public.documents is
  'La suppression est logique : elle passe par UPDATE de deleted_at, et exige donc '
  'document.delete. Aucune politique DELETE — une pièce justificative ne quitte jamais '
  'la base par une requête applicative.';

grant select, insert, update on public.documents to authenticated;

create policy document_access_log_select on public.document_access_log
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('audit.read')
      or exists (select 1 from public.documents d where d.id = document_id)
    )
  );
comment on policy document_access_log_select on public.document_access_log is
  'Visible des auditeurs, et de quiconque voit déjà la pièce concernée : savoir qui a '
  'consulté un document suppose d''avoir accès à ce document.';

-- -----------------------------------------------------------------------------
-- Journalisation d'accès : unique porte d'écriture.
-- -----------------------------------------------------------------------------

create or replace function public.log_document_access(
  p_document_id uuid,
  p_action text,
  p_ip inet default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_occurrence uuid;
begin
  if p_action not in ('SIGNED_URL_ISSUED', 'VIEW', 'DOWNLOAD') then
    raise exception 'Action d''accès inconnue : %.', p_action using errcode = '22023';
  end if;

  select d.occurrence_id into target_occurrence
  from public.documents d
  where d.id = p_document_id and d.deleted_at is null;

  if target_occurrence is null then
    raise exception 'Document introuvable.' using errcode = '42501';
  end if;

  -- SECURITY DEFINER contourne la RLS : le droit doit donc être revérifié ici,
  -- explicitement. Sans ce contrôle, la fonction deviendrait un oracle permettant
  -- de tester l'existence de n'importe quelle pièce.
  if not public.has_permission_in_domain(
       'document.read', public.obligation_domain_of_occurrence(target_occurrence))
  then
    raise exception 'Accès refusé à ce document.' using errcode = '42501';
  end if;

  insert into public.document_access_log (document_id, actor_id, action, ip_address, user_agent)
  values (p_document_id, auth.uid(), p_action, p_ip, p_user_agent);
end;
$$;

comment on function public.log_document_access(uuid, text, inet, text) is
  'Seule écriture possible dans document_access_log. `actor_id` est pris de la session, '
  'jamais d''un paramètre : une consultation ne peut pas être attribuée à autrui. '
  'Le droit de lecture est revérifié ici parce que SECURITY DEFINER neutralise la RLS.';

grant execute on function public.log_document_access(uuid, text, inet, text) to authenticated;

-- =============================================================================
-- 7. RÉTENTION — file d'attente, jamais de suppression automatique
-- =============================================================================

create view public.documents_pending_purge
  with (security_invoker = true)
  as
  select d.id,
         d.occurrence_id,
         d.original_filename,
         d.normalized_filename,
         d.uploaded_at,
         ot.retention_years,
         (d.uploaded_at + make_interval(years => ot.retention_years))::date as purge_eligible_on,
         ot.code as obligation_code,
         oc.period_key
  from public.documents d
  join public.obligation_occurrences oc on oc.id = d.occurrence_id
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where d.deleted_at is null
    and d.uploaded_at + make_interval(years => ot.retention_years) < now();

comment on view public.documents_pending_purge is
  'File « Purge à examiner » : documents ayant dépassé leur durée de conservation. '
  '⚠️ DÉCISION ARRÊTÉE — aucune tâche planifiée ne supprime jamais un document de sa '
  'propre initiative. Cette vue ne fait que PROPOSER ; la suppression reste une décision '
  'humaine explicite, tracée par deleted_by et deletion_reason. Conséquence voulue : un '
  'paramètre de rétention mal réglé ne peut détruire aucune donnée, il ne peut qu''allonger '
  'une liste. security_invoker : la vue n''expose que ce que la politique documents autorise.';

grant select on public.documents_pending_purge to authenticated;

-- =============================================================================
-- 8. STOCKAGE
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'compliance-documents',
  'compliance-documents',
  false,                    -- JAMAIS public. Aucune exception.
  26214400,                 -- 25 Mo
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/csv',
    'text/plain',
    'application/xml',
    'text/xml',
    'application/zip'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Les politiques de stockage dérivent de l'accès à la ligne `documents`, qui dérive
-- elle-même de l'accès à l'occurrence parente. Une seule règle métier, appliquée
-- à deux étages, sans possibilité de divergence.
-- ⚠️ Les politiques de storage.objects ne portent PAS de COMMENT ON POLICY,
-- contrairement à toutes les autres de ce projet. La table appartient à
-- `supabase_storage_admin` : le rôle qui applique les migrations peut y créer une
-- politique, mais pas la commenter — COMMENT exige la propriété stricte
-- (« must be owner of relation objects »). Le raisonnement est donc porté ici,
-- en commentaire SQL, et non dans le catalogue.

-- Lire un objet suppose de voir la ligne `documents` qui le décrit. Le EXISTS est
-- évalué avec les droits de l'appelant : la politique de public.documents, donc le
-- cloisonnement par domaine, s'applique intégralement au fichier.
create policy compliance_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'compliance-documents'
    and exists (select 1 from public.documents d where d.storage_path = name)
  );

-- Le dépôt est ouvert aux comptes actifs ; c'est l'insertion de la ligne documents,
-- soumise à document.upload sur le domaine, qui fait foi. Le chemin est imposé par
-- le serveur, jamais par le client.
create policy compliance_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'compliance-documents'
    and public.is_active_user()
  );

-- Aucune politique UPDATE ni DELETE sur les objets de ce bucket : un fichier
-- déposé n'est jamais écrasé en place ni effacé. Une nouvelle version est un
-- nouvel objet, relié par documents.supersedes_id.

comment on column public.documents.bucket is
  'Bucket PRIVÉ. Aucune URL publique n''existe : toute lecture passe par une URL signée '
  'de courte durée (app_settings.signed_url_ttl_seconds = 300), émise par un Route Handler '
  'qui vérifie les droits ET journalise l''émission dans document_access_log. '
  'PAS DE FILIGRANE — décision arrêtée : ces pièces sont officielles et destinées à être '
  'redéposées auprès des administrations ; un exemplaire filigrané serait inutilisable et '
  'pousserait les utilisateurs à contourner l''outil. La traçabilité repose sur la '
  'journalisation exhaustive des accès, pas sur la dégradation des fichiers.';
