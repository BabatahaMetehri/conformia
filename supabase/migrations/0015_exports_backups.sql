-- =============================================================================
-- 0015 — EXPORTS ET SAUVEGARDES
--
-- Deux besoins qui n'ont en commun que leur finalité : produire un dossier
-- opposable à un contrôleur, et garantir qu'aucune donnée ne devient
-- irrécupérable.
--
-- Le fil conducteur de ce fichier est une seule idée : un dispositif qui échoue
-- en silence est pire que pas de dispositif du tout. Un export qu'on croit
-- complet, une sauvegarde qu'on croit faite — les deux se découvrent au pire
-- moment. D'où le journal des exports, et surtout l'alerte de sauvegarde
-- périmée, qui est la raison d'être de la seconde moitié de ce fichier.
-- =============================================================================

-- =============================================================================
-- 1. JOURNAL DES EXPORTS
--
--    ⚠️ Un export fait SORTIR de la donnée. C'est le seul geste de
--    l'application dont l'effet survit à l'application elle-même : le fichier
--    part sur un poste, dans une boîte, sur une clé. Il se trace donc comme une
--    écriture, avec son auteur, son périmètre et son volume.
-- =============================================================================

create type public.export_kind as enum (
  'DOSSIER',        -- une occurrence, en archive ZIP
  'PERIOD',         -- une plage, consolidée
  'OCCURRENCES',    -- tableau de suivi
  'COMPLIANCE',     -- tableau de conformité
  'WORKLOAD',       -- charge par personne
  'LATE_REASONS',   -- analyse des motifs de retard
  'REPORT'          -- rapport PDF de conformité
);

create type public.export_format as enum ('ZIP', 'XLSX', 'CSV', 'PDF');

create type public.export_status as enum ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

create table public.export_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  kind public.export_kind not null,
  format public.export_format not null,
  /*
   * Le PÉRIMÈTRE demandé, tel que l'utilisateur l'a exprimé : domaine, organisme,
   * bornes de dates, statuts. C'est ce qui permet de répondre, six mois plus
   * tard, à « qu'est-ce qui est sorti exactement ». Le nombre de lignes seul ne
   * répond pas à cette question.
   */
  scope jsonb not null default '{}'::jsonb,
  status public.export_status not null default 'RUNNING',
  /** Occurrences réellement incluses — APRÈS filtrage par la RLS de l'auteur. */
  occurrence_count int not null default 0,
  document_count int not null default 0,
  size_bytes bigint,
  file_name text,
  /** Asynchrone au-delà du seuil : l'utilisateur est prévenu à l'achèvement. */
  is_async boolean not null default false,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.export_runs is
  'Historique des exports produits, avec leur auteur et leur périmètre. '
  '⚠️ `occurrence_count` compte ce qui est SORTI, pas ce qui a été demandé : un '
  'RH qui exporte « tout » obtient le domaine social, et le journal doit le dire.';

create index export_runs_recent_idx on public.export_runs (started_at desc);
create index export_runs_author_idx on public.export_runs (requested_by, started_at desc);
create index export_runs_pending_idx on public.export_runs (status)
  where status = 'RUNNING';

alter table public.export_runs enable row level security;

revoke insert, update, delete on public.export_runs from public, anon, authenticated;
grant select on public.export_runs to authenticated;

create policy export_runs_select on public.export_runs
  for select to authenticated
  using (
    public.is_active_user()
    and (
      requested_by = public.current_profile_id()
      -- Qui lit le journal d'audit voit aussi qui a fait sortir quoi : c'est la
      -- même question, et la séparer donnerait une traçabilité à trous.
      or public.has_permission('audit.read')
    )
  );
comment on policy export_runs_select on public.export_runs is
  'Ses propres exports, plus tous les exports pour qui détient audit.read.';

create trigger trg_audit
  after insert or update or delete on public.export_runs
  for each row execute function public.audit_trigger();

-- ─── Ouverture et clôture ────────────────────────────────────────────────────

create or replace function public.start_export_run(
  p_kind public.export_kind,
  p_format public.export_format,
  p_scope jsonb,
  p_is_async boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id uuid;
begin
  -- La permission est vérifiée ICI, au plus près de l'écriture : une action
  -- serveur peut être appelée directement, sans passer par l'écran qui la cache.
  if not public.has_permission('export.generate') then
    raise exception 'Export refusé : export.generate requis.' using errcode = '42501';
  end if;

  insert into public.export_runs (requested_by, kind, format, scope, is_async)
  values (public.current_profile_id(), p_kind, p_format, p_scope, p_is_async)
  returning id into run_id;

  return run_id;
end;
$$;

grant execute on function public.start_export_run(
  public.export_kind, public.export_format, jsonb, boolean) to authenticated;

create or replace function public.finish_export_run(
  p_run uuid,
  p_status public.export_status,
  p_occurrences int,
  p_documents int,
  p_size_bytes bigint,
  p_file_name text,
  p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.export_runs
  set status = p_status,
      occurrence_count = p_occurrences,
      document_count = p_documents,
      size_bytes = p_size_bytes,
      file_name = p_file_name,
      error_message = p_error,
      finished_at = now()
  where id = p_run;
$$;

grant execute on function public.finish_export_run(
  uuid, public.export_status, int, int, bigint, text, text) to authenticated;

/**
 * Trace un export dans le JOURNAL D'AUDIT, en plus de `export_runs`.
 *
 * ⚠️ Les deux, et pas l'un ou l'autre. `export_runs` est un écran d'exploitation
 * — on y filtre, on y trie, on peut y purger. Le journal d'audit est en ajout
 * seul et le restera : c'est lui qu'un contrôleur lit. Le premier sert à
 * travailler, le second à prouver.
 */
create or replace function public.log_export(
  p_kind public.export_kind,
  p_entity_table text,
  p_detail jsonb,
  -- Facultatif : un export de plage ne se rattache à AUCUNE entité précise, et
  -- lui en inventer une rendrait le journal moins lisible, pas plus.
  p_entity_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (
    actor_id, actor_email, action, entity_table, entity_id_ref, after)
  values (
    auth.uid(),
    (select p.email::text from public.profiles p where p.id = auth.uid()),
    'EXPORT', p_entity_table, p_entity_id,
    jsonb_build_object('kind', p_kind) || coalesce(p_detail, '{}'::jsonb));
end;
$$;

grant execute on function public.log_export(public.export_kind, text, jsonb, text)
  to authenticated;

-- =============================================================================
-- 2. PÉRIMÈTRE D'UN EXPORT, POUR UN PROFIL DONNÉ
--
--    ⚠️ « Aucun export ne contourne la RLS. » Tenu simplement pour un export
--    synchrone : il s'exécute dans la session de l'appelant. Un export
--    ASYNCHRONE, lui, n'a plus de session — et c'est exactement le piège, parce
--    que la tâche de fond dispose de la clé de service.
--
--    D'où cette fonction : le périmètre est calculé POUR LE DEMANDEUR, avec le
--    même prédicat que la politique RLS (via can_see_occurrence_for, éprouvé
--    ligne à ligne par le test de parité de 0014). La tâche de fond n'a donc
--    aucune latitude : elle ne sait produire que ce que son demandeur voit.
-- =============================================================================

create or replace function public.exportable_occurrences(
  p_user uuid,
  p_from date default null,
  p_to date default null,
  p_domain uuid default null,
  p_authority uuid default null)
returns table (
  occurrence_id uuid,
  obligation_code text,
  obligation_name text,
  domain_code text,
  authority_name text,
  period_key text,
  period_start date,
  period_end date,
  legal_due_date date,
  internal_due_date date,
  status public.occurrence_status,
  criticality public.criticality,
  owner_name text,
  validator_name text,
  submitted_at timestamptz,
  -- Les DEUX : le code sert à agréger les causes dans le rapport, le texte libre
  -- sert à la fiche récapitulative. L'un sans l'autre donne soit des statistiques
  -- sans explication, soit des explications sans statistiques.
  late_reason_code public.late_reason_code,
  late_reason text,
  late_days int,
  document_count int)
language sql
stable
security definer
set search_path = ''
as $$
  with domaines as (
    select d.id
    from public.domains d
    where public.has_permission_in_domain_for(p_user, 'occurrence.read', d.id)
  )
  select oc.id, ot.code, ot.name, dom.code, a.name,
         oc.period_key, oc.period_start, oc.period_end,
         oc.legal_due_date, oc.internal_due_date, oc.status, ot.criticality,
         owner.full_name, val.full_name, oc.submitted_at,
         oc.late_reason_code, oc.late_reason,
         /*
          * Retard mesuré sur l'échéance LÉGALE, et seulement pour un dossier
          * effectivement déposé. Le compter sur l'échéance interne gonflerait le
          * chiffre d'un délai que l'entreprise s'impose elle-même, et qu'aucun
          * organisme ne sanctionne.
          */
         case
           when oc.submitted_at is null then null
           when (oc.submitted_at at time zone 'Africa/Algiers')::date <= oc.legal_due_date then 0
           else ((oc.submitted_at at time zone 'Africa/Algiers')::date - oc.legal_due_date)
         end,
         (select count(*)::int from public.documents doc
          where doc.occurrence_id = oc.id and doc.deleted_at is null)
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  join public.domains dom on dom.id = ot.domain_id
  left join public.authorities a on a.id = ot.authority_id
  left join public.profiles owner on owner.id = oc.owner_id
  left join public.profiles val on val.id = oc.validator_id
  where oc.deleted_at is null
    and (dom.id in (select id from domaines)
         or oc.owner_id = p_user
         or oc.validator_id = p_user)
    and (p_from is null or oc.internal_due_date >= p_from)
    and (p_to is null or oc.internal_due_date <= p_to)
    and (p_domain is null or dom.id = p_domain)
    and (p_authority is null or a.id = p_authority)
  order by oc.internal_due_date, ot.code;
$$;

comment on function public.exportable_occurrences(uuid, date, date, uuid, uuid) is
  'Occurrences exportables PAR UN PROFIL DONNÉ. Le prédicat de cloisonnement est '
  'celui de can_see_occurrence_for, en version ensembliste — un RH qui demande '
  '« tout » obtient le domaine social, et rien d''autre.';

/*
 * ⚠️ RÉVOQUÉE POUR LES SESSIONS, et c'est le point qui compte.
 *
 * La fonction prend le profil en ARGUMENT. Ouverte à `authenticated`, n'importe
 * quel utilisateur connecté aurait pu passer l'identifiant d'un collègue et lire
 * son périmètre — un cloisonnement par domaine annulé par un paramètre. Elle est
 * donc réservée aux tâches de fond, qui seules ont une raison d'exporter au nom
 * de quelqu'un d'autre.
 *
 * Les sessions passent par la façade sans argument ci-dessous, qui impose le
 * profil courant et ne se laisse pas persuader du contraire.
 */
revoke execute on function public.exportable_occurrences(uuid, date, date, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.my_exportable_occurrences(
  p_from date default null,
  p_to date default null,
  p_domain uuid default null,
  p_authority uuid default null)
/*
 * ⚠️ La signature de retour est RÉPÉTÉE, pas réutilisée. Une fonction
 * `returns table` ne crée aucun type composite nommé : `setof
 * public.exportable_occurrences` ne compile pas. La duplication est imposée par
 * PostgreSQL — le test d'intégration compare les deux surfaces colonne par
 * colonne pour qu'elle ne devienne pas une divergence.
 */
returns table (
  occurrence_id uuid,
  obligation_code text,
  obligation_name text,
  domain_code text,
  authority_name text,
  period_key text,
  period_start date,
  period_end date,
  legal_due_date date,
  internal_due_date date,
  status public.occurrence_status,
  criticality public.criticality,
  owner_name text,
  validator_name text,
  submitted_at timestamptz,
  late_reason_code public.late_reason_code,
  late_reason text,
  late_days int,
  document_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.exportable_occurrences(
    public.current_profile_id(), p_from, p_to, p_domain, p_authority);
$$;

comment on function public.my_exportable_occurrences(date, date, uuid, uuid) is
  'Périmètre exportable de l''appelant. Le profil n''est pas un argument : c''est '
  'la différence entre « exporter ce que je vois » et « exporter ce que je désigne ».';

grant execute on function public.my_exportable_occurrences(date, date, uuid, uuid)
  to authenticated;

-- =============================================================================
-- 3. SAUVEGARDES — LE JOURNAL S'ÉTOFFE
--
--    `backup_runs` existe depuis 0011, où elle n'était qu'un socle : personne
--    n'y écrivait, et son commentaire le disait. Le script de sauvegarde arrive ;
--    la table gagne ce qu'il faut pour qu'une ligne PROUVE quelque chose.
-- =============================================================================

create type public.backup_kind as enum ('DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL');

alter table public.backup_runs
  add column kind public.backup_kind not null default 'DAILY',
  add column database_bytes bigint,
  add column storage_bytes bigint,
  add column artifact_count int,
  /** Empreinte de l'archive CHIFFRÉE, telle qu'elle quitte l'infrastructure. */
  add column sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  /** Où elle a atterri. Jamais un secret : un chemin, un hôte rclone. */
  add column destination text,
  /** Relecture APRÈS transfert : taille et empreinte revérifiées à destination. */
  add column verified_at timestamptz,
  add column encrypted boolean not null default true;

comment on column public.backup_runs.verified_at is
  '⚠️ Renseigné seulement après RELECTURE de l''archive à destination. Un transfert '
  'qui rend « OK » sans que personne ne relise le fichier écrit produit exactement '
  'la sauvegarde illisible qu''on découvre le jour de la restauration.';
comment on column public.backup_runs.encrypted is
  'Toujours vrai en exploitation. La colonne existe pour que le contraire soit '
  'VISIBLE si quelqu''un désactive le chiffrement, plutôt que silencieux.';

/**
 * Ouvre une ligne de sauvegarde.
 *
 * ⚠️ Appelée AVANT le travail, pas après. Une ligne ouverte puis jamais close est
 * le seul signal qui distingue une sauvegarde interrompue d'une sauvegarde
 * jamais lancée — et c'est la seconde, la silencieuse, qui fait perdre les
 * données.
 */
create or replace function public.start_backup_run(p_kind public.backup_kind)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.backup_runs (status, kind) values ('RUNNING', p_kind) returning id;
$$;

create or replace function public.finish_backup_run(
  p_id bigint,
  p_status text,
  p_size_bytes bigint,
  p_database_bytes bigint,
  p_storage_bytes bigint,
  p_artifact_count int,
  p_sha256 text,
  p_destination text,
  p_detail text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.backup_runs
  set status = p_status,
      finished_at = now(),
      size_bytes = p_size_bytes,
      database_bytes = p_database_bytes,
      storage_bytes = p_storage_bytes,
      artifact_count = p_artifact_count,
      sha256 = p_sha256,
      destination = p_destination,
      detail = p_detail
  where id = p_id;
$$;

create or replace function public.mark_backup_verified(p_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.backup_runs set verified_at = now() where id = p_id;
$$;

revoke execute on function public.start_backup_run(public.backup_kind)
  from public, anon, authenticated;
revoke execute on function public.finish_backup_run(
  bigint, text, bigint, bigint, bigint, int, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.mark_backup_verified(bigint)
  from public, anon, authenticated;

-- =============================================================================
-- 4. ⚠️ L'ALERTE DE SAUVEGARDE PÉRIMÉE
--
--    LE POINT LE PLUS IMPORTANT DE CE FICHIER.
--
--    La panne classique n'est pas la sauvegarde qui échoue : celle-là se voit.
--    C'est celle qui échoue SILENCIEUSEMENT pendant huit mois, et qu'on découvre
--    le jour où il faut restaurer. Le bandeau du tableau de bord (0011) ne suffit
--    pas : il faut regarder l'écran pour le voir, et personne ne regarde un écran
--    d'administration tous les jours.
--
--    Cette fonction POUSSE l'alerte vers les administrateurs — notification
--    interne ET courriel — et elle est appelée par le cycle horaire de
--    notification, celui qui tourne déjà. Aucune tâche de plus à surveiller :
--    l'alerte qui surveille les sauvegardes ne doit pas dépendre d'un dispositif
--    dont personne ne surveille la santé.
-- =============================================================================

create or replace function public.notify_admins_of_stale_backup(p_hours int default 36)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  derniere timestamptz;
  heures numeric;
  ajoutees int := 0;
begin
  select max(b.finished_at) into derniere
  from public.backup_runs b
  where b.status = 'SUCCEEDED';

  -- Sauvegarde récente : rien à signaler.
  if derniere is not null and derniere > now() - make_interval(hours => p_hours) then
    return 0;
  end if;

  /*
   * ⚠️ `derniere IS NULL` — aucune sauvegarde réussie, JAMAIS — déclenche
   * l'alerte au même titre qu'une sauvegarde périmée. C'est le cas d'une
   * installation neuve, et c'est précisément celui qu'il ne faut pas taire :
   * une table vide traitée comme « tout va bien » est la forme la plus pure du
   * dispositif décoratif.
   */
  heures := case
    when derniere is null then -1
    else round(extract(epoch from (now() - derniere)) / 3600)
  end;

  with administrateurs as (
    select distinct ur.user_id, p.email
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.code in ('ADMIN', 'DIRECTION')
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
      and p.is_active and p.deleted_at is null and p.deactivated_at is null
  ),
  canaux as (
    select a.user_id, a.email, c.channel::public.notification_channel
    from administrateurs a
    cross join (values ('IN_APP'), ('EMAIL')) as c(channel)
    where c.channel <> 'EMAIL' or a.email is not null
  ),
  inserees as (
    insert into public.notifications (
      recipient_id, kind, channel, subject, body_text, reason, scheduled_for)
    select ch.user_id, 'BACKUP_FAILURE', ch.channel,
           'notifications.backupStale.subject',
           'notifications.backupStale.body',
           case when heures < 0 then 'JAMAIS' else heures::text end,
           now()
    from canaux ch
    /*
     * ⚠️ UNE alerte par administrateur et par canal toutes les 24 h. Sans cette
     * garde, le cycle horaire produirait vingt-quatre alertes par jour et par
     * personne — et une alerte répétée toutes les heures n'est plus lue au bout
     * de deux jours. On perdrait précisément le message qu'on cherche à faire
     * passer.
     */
    where not exists (
      select 1 from public.notifications n
      where n.recipient_id = ch.user_id
        and n.channel = ch.channel
        and n.kind = 'BACKUP_FAILURE'
        and n.created_at > now() - interval '24 hours')
    returning id)
  select count(*)::int into ajoutees from inserees;

  return ajoutees;
end;
$$;

comment on function public.notify_admins_of_stale_backup(int) is
  '⚠️ Pousse l''alerte « aucune sauvegarde réussie depuis N heures » vers les '
  'administrateurs et la Direction, en interne ET par courriel. Appelée par le '
  'cycle horaire de notification. L''absence TOTALE de sauvegarde déclenche '
  'l''alerte au même titre qu''une sauvegarde périmée.';

revoke execute on function public.notify_admins_of_stale_backup(int)
  from public, anon, authenticated;

-- =============================================================================
-- 5. TESTS DE RESTAURATION
--
--    Une sauvegarde jamais restaurée n'est pas une sauvegarde : c'est un fichier
--    dont on espère qu'il est lisible. Cette table est le seul endroit où cette
--    espérance devient un fait daté.
-- =============================================================================

create table public.restore_tests (
  id bigint generated by default as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('RUNNING', 'PASSED', 'FAILED')),
  backup_run_id bigint references public.backup_runs (id) on delete restrict,
  /** Comptages relevés dans l'environnement restauré, table par table. */
  table_counts jsonb not null default '{}'::jsonb,
  documents_sampled int not null default 0,
  documents_verified int not null default 0,
  /** Ce qui n'a pas concordé. Vide en cas de succès, jamais NULL. */
  failures jsonb not null default '[]'::jsonb,
  duration_seconds int,
  report text
);

comment on table public.restore_tests is
  'Journal des restaurations d''épreuve. ⚠️ `failures` est un tableau VIDE en cas '
  'de succès et jamais NULL : une colonne nulle se lit « pas de données », un '
  'tableau vide se lit « vérifié, rien à signaler ». La nuance décide de la '
  'confiance qu''on accorde à la ligne.';

create index restore_tests_recent_idx on public.restore_tests (started_at desc);

alter table public.restore_tests enable row level security;
revoke insert, update, delete on public.restore_tests from public, anon, authenticated;
grant select on public.restore_tests to authenticated;

create policy restore_tests_select on public.restore_tests
  for select to authenticated
  using (public.is_active_user() and public.has_permission('settings.manage'));

create or replace function public.start_restore_test(p_backup_run bigint)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.restore_tests (status, backup_run_id)
  values ('RUNNING', p_backup_run)
  returning id;
$$;

create or replace function public.finish_restore_test(
  p_id bigint,
  p_status text,
  p_table_counts jsonb,
  p_sampled int,
  p_verified int,
  p_failures jsonb,
  p_duration int,
  p_report text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.restore_tests
  set status = p_status,
      finished_at = now(),
      table_counts = coalesce(p_table_counts, '{}'::jsonb),
      documents_sampled = p_sampled,
      documents_verified = p_verified,
      failures = coalesce(p_failures, '[]'::jsonb),
      duration_seconds = p_duration,
      report = p_report
  where id = p_id;
$$;

revoke execute on function public.start_restore_test(bigint)
  from public, anon, authenticated;
revoke execute on function public.finish_restore_test(
  bigint, text, jsonb, int, int, jsonb, int, text)
  from public, anon, authenticated;

-- =============================================================================
-- 6. PLANIFICATION
-- =============================================================================

do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('conformia-backup')
  where exists (select 1 from cron.job where jobname = 'conformia-backup');
  perform cron.unschedule('conformia-restore-test')
  where exists (select 1 from cron.job where jobname = 'conformia-restore-test');

  /*
   * ⚠️ 02 h 00 UTC = 03 h 00 À ALGER. pg_cron planifie en UTC, et l'Algérie est à
   * UTC+1 toute l'année. Une heure après la génération des occurrences : la
   * sauvegarde doit contenir la journée qui vient d'être écrite.
   */
  perform cron.schedule(
    'conformia-backup',
    '0 2 * * *',
    $job$select net.http_post(
      url := current_setting('app.backup_url', true),
      headers := jsonb_build_object('Content-Type', 'application/json')
    )$job$);

  -- Épreuve de restauration : le 1er de chaque mois, 04 h 00 à Alger.
  perform cron.schedule(
    'conformia-restore-test',
    '0 3 1 * *',
    $job$select net.http_post(
      url := current_setting('app.restore_test_url', true),
      headers := jsonb_build_object('Content-Type', 'application/json')
    )$job$);
exception
  when others then
    raise notice 'pg_cron/pg_net indisponible (%). Déclencher la sauvegarde par un '
      'ordonnanceur externe : npm run backup, et npm run restore:test.', sqlerrm;
end
$$;

-- =============================================================================
-- 7. DÉPÔT DES EXPORTS ASYNCHRONES
--
--    Un export d'exercice complet ne se rend pas dans une réponse HTTP : il se
--    fabrique en tâche de fond, se dépose, et l'auteur est prévenu. D'où un
--    bucket dédié.
--
--    ⚠️ PRIVÉ, comme celui des documents, et pour une raison plus forte encore :
--    une archive d'exercice contient TOUTES les pièces d'une année. Un lien
--    public y donnerait un accès plus large que n'importe quel compte de
--    l'application.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports',
  'exports',
  false,                    -- JAMAIS public. Aucune exception.
  1073741824,               -- 1 Go : un exercice complet, pièces comprises.
  array['application/zip', 'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv']
)
on conflict (id) do nothing;

/*
 * ⚠️ LECTURE RÉSERVÉE À L'AUTEUR DE L'EXPORT.
 *
 * Le chemin d'un objet commence par l'identifiant de l'export ; la politique
 * remonte à `export_runs` pour vérifier qui l'a demandé. Un export est un
 * instantané du périmètre de SON auteur : le laisser lire par un collègue, même
 * détenteur d'`audit.read`, lui donnerait par la bande des dossiers que la RLS
 * lui refuse en direct.
 *
 * Aucune politique INSERT, UPDATE ni DELETE pour `authenticated` : seule la tâche
 * de fond écrit, et elle emprunte la clé de service.
 */
create policy exports_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and exists (
      select 1
      from public.export_runs r
      where r.id::text = split_part(name, '/', 1)
        and r.requested_by = public.current_profile_id()
    )
  );

-- =============================================================================
-- 8. AVIS D'EXPORT PRÊT
--
--    Un export d'exercice se fabrique en plusieurs minutes. L'auteur a fermé
--    l'onglet : il faut aller le chercher.
-- =============================================================================

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  -- 0010 — effets de transition
  'VALIDATION_REQUESTED', 'OCCURRENCE_REJECTED', 'OCCURRENCE_UNLOCKED',
  -- 0011 — administration
  'MFA_RESET', 'HOLIDAY_CALENDAR_CHANGED', 'ROLE_GRANTED', 'ROLE_REVOKED',
  -- 0014 — jalons, escalade, exploitation
  'UPCOMING_DEADLINE', 'OVERDUE_ALERT', 'ESCALATION', 'WEEKLY_DIGEST',
  'USER_INVITATION', 'PASSWORD_RESET', 'INTEGRITY_ALERT', 'BACKUP_FAILURE',
  'DELIVERY_FAILURE',
  -- 0015 — exports
  'EXPORT_READY'));

/**
 * Prévient l'auteur qu'un export asynchrone est disponible.
 *
 * ⚠️ Canal IN_APP uniquement. Le message porte un lien vers un fichier qui
 * contient potentiellement l'intégralité d'un exercice : l'annoncer par courriel
 * ferait sortir ce lien de l'application, vers des boîtes que nous ne maîtrisons
 * pas et qui se transfèrent.
 */
create or replace function public.notify_export_ready(
  p_run uuid,
  p_status public.export_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  auteur uuid;
begin
  select r.requested_by into auteur from public.export_runs r where r.id = p_run;
  if auteur is null then return; end if;

  insert into public.notifications (
    recipient_id, kind, channel, subject, body_text, reason, scheduled_for)
  values (
    auteur, 'EXPORT_READY', 'IN_APP',
    case when p_status = 'FAILED'
      then 'notifications.exportReady.failedSubject'
      else 'notifications.exportReady.subject' end,
    'notifications.exportReady.body',
    p_run::text,
    now());
end;
$$;

revoke execute on function public.notify_export_ready(uuid, public.export_status)
  from public, anon, authenticated;

/** Exports asynchrones en attente de construction, pour la tâche de fond. */
create or replace function public.pending_async_exports(p_limit int default 5)
returns table (
  id uuid,
  requested_by uuid,
  kind public.export_kind,
  format public.export_format,
  scope jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.requested_by, r.kind, r.format, r.scope
  from public.export_runs r
  where r.is_async
    and r.status = 'RUNNING'
    -- ⚠️ Les demandes de plus de six heures sont IGNORÉES, pas reprises. Une
    -- ligne restée ouverte si longtemps est le reste d'une tâche interrompue :
    -- la reprendre reconstruirait un export que plus personne n'attend, en
    -- consommant le temps du cycle suivant.
    and r.started_at > now() - interval '6 hours'
  order by r.started_at
  limit p_limit;
$$;

revoke execute on function public.pending_async_exports(int)
  from public, anon, authenticated;

/** Clôture d'un export asynchrone, faite par la tâche — sans session. */
create or replace function public.finish_async_export(
  p_run uuid,
  p_status public.export_status,
  p_occurrences int,
  p_documents int,
  p_size_bytes bigint,
  p_file_name text,
  p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.export_runs
  set status = p_status,
      occurrence_count = p_occurrences,
      document_count = p_documents,
      size_bytes = p_size_bytes,
      file_name = p_file_name,
      error_message = p_error,
      finished_at = now()
  where id = p_run;

  perform public.notify_export_ready(p_run, p_status);
end;
$$;

revoke execute on function public.finish_async_export(
  uuid, public.export_status, int, int, bigint, text, text)
  from public, anon, authenticated;
