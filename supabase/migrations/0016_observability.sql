-- =============================================================================
-- 0016 — OBSERVABILITÉ
--
-- Trois choses, et rien d'autre :
--   1. l'identifiant de corrélation atteint enfin `audit_log.request_id` ;
--   2. un verdict de santé lisible en une requête, sans donnée métier ;
--   3. l'état des travaux planifiés, avec l'ABSENCE traitée comme un échec.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IDENTIFIANT DE CORRÉLATION
--
-- ⚠️ LA COLONNE EXISTAIT DEPUIS 0003 ET N'A JAMAIS ÉTÉ REMPLIE.
--
-- `audit_log.request_id` lisait `current_setting('conformia.request_id')`, un
-- réglage de SESSION. Or l'application n'atteint jamais la base par une session :
-- elle passe par PostgREST, en HTTP, sans état entre deux requêtes. Le réglage
-- restait donc vide sur CHAQUE écriture venue de l'interface — et le seul champ
-- capable de relier une ligne d'audit à la requête qui l'a produite était mort
-- depuis l'origine, sans que rien ne le signale.
--
-- PostgREST, lui, expose les en-têtes de la requête HTTP dans le réglage
-- `request.headers`. On y lit `x-request-id`, que le middleware pose désormais
-- sur toute requête sortante. Le réglage de session reste consulté EN SECOND :
-- c'est par lui que les travaux de `src/server/jobs/`, qui ouvrent une vraie
-- connexion PostgreSQL, transmettent le leur.
-- -----------------------------------------------------------------------------

create or replace function public.current_request_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  from_http text;
begin
  -- `request.headers` n'existe pas hors PostgREST : l'accès doit être protégé,
  -- et un JSON malformé ne doit jamais faire échouer une écriture métier.
  begin
    from_http := nullif(
      (pg_catalog.current_setting('request.headers', true)::json ->> 'x-request-id'), '');
  exception when others then
    from_http := null;
  end;

  return coalesce(
    from_http,
    nullif(pg_catalog.current_setting('conformia.request_id', true), '')
  );
end;
$$;

comment on function public.current_request_id() is
  'Identifiant de corrélation de la requête courante. Lit d''abord l''en-tête HTTP '
  'x-request-id transmis par PostgREST, puis le réglage de session conformia.request_id '
  'employé par les travaux planifiés. Rend NULL si aucun n''est posé — jamais une erreur.';

grant execute on function public.current_request_id() to authenticated, anon, service_role;

-- Le trigger d'audit consulte désormais les deux sources.
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_data jsonb;
  after_data jsonb;
  changed text[] := array[]::text[];
  redacted text[] := array['password', 'password_hash', 'secret', 'token', 'ics_token'];
  column_name text;
  row_identifier text;
  audited_entity uuid;
begin
  before_data := case when tg_op = 'INSERT' then null else pg_catalog.to_jsonb(old) end;
  after_data := case when tg_op = 'DELETE' then null else pg_catalog.to_jsonb(new) end;

  if tg_op = 'UPDATE' then
    select coalesce(pg_catalog.array_agg(key), array[]::text[]) into changed
    from pg_catalog.jsonb_object_keys(before_data || after_data) as key
    where before_data -> key is distinct from after_data -> key;
  end if;

  foreach column_name in array redacted loop
    if before_data ? column_name then
      before_data := pg_catalog.jsonb_set(before_data, array[column_name], '"[redacted]"'::jsonb);
    end if;
    if after_data ? column_name then
      after_data := pg_catalog.jsonb_set(after_data, array[column_name], '"[redacted]"'::jsonb);
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
    public.current_request_id()
  );

  return coalesce(new, old);
end;
$$;

comment on function public.audit_trigger() is
  'Trigger d''audit unique, générique. S''appuie sur TG_TABLE_NAME, TG_OP et to_jsonb : '
  'aucune branche conditionnelle par nom de table, aucune duplication à maintenir. '
  'Depuis 0016, request_id est réellement renseigné — voir public.current_request_id(). '
  '⚠️ Aucune capture d''exception : si l''écriture du journal échoue, la transaction '
  'métier est annulée. C''est délibéré — mieux vaut refuser une écriture que de la '
  'réaliser sans trace.';

-- -----------------------------------------------------------------------------
-- 2. VERDICT DE SANTÉ
--
-- ⚠️ AUCUNE DONNÉE MÉTIER NE SORT D'ICI. Une sonde de santé est interrogée sans
-- session par la supervision de l'hébergeur : elle rend des booléens, des dates
-- et des compteurs, jamais un dossier, jamais un nom.
--
-- ⚠️ ELLE RÉPOND SUR CE QUI N'A PAS EU LIEU. Une génération qui ne tourne plus
-- ne produit aucune erreur : elle produit du silence, et le silence ne réveille
-- personne. D'où `hours_since_*` : c'est l'ancienneté qui alerte, pas l'échec.
-- -----------------------------------------------------------------------------

create or replace function public.health_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'database', true,
    'checked_at', now(),
    'last_generation_at', (
      select max(finished_at) from public.job_runs
      where job_name = 'generate-occurrences' and status in ('SUCCEEDED', 'PARTIAL')),
    'hours_since_generation', (
      select round(extract(epoch from now() - max(finished_at)) / 3600.0, 1)
      from public.job_runs
      where job_name = 'generate-occurrences' and status in ('SUCCEEDED', 'PARTIAL')),
    'last_backup_at', (
      select max(finished_at) from public.backup_runs where status = 'SUCCEEDED'),
    'hours_since_backup', (
      select round(extract(epoch from now() - max(finished_at)) / 3600.0, 1)
      from public.backup_runs where status = 'SUCCEEDED'),
    'failed_jobs_24h', (
      select count(*) from public.job_runs
      where status = 'FAILED' and started_at > now() - interval '24 hours'),
    'pending_notifications', (
      select count(*) from public.notifications
      where sent_at is null and scheduled_for <= now()),
    'documents_total', (select count(*) from public.documents where deleted_at is null)
  );
$$;

comment on function public.health_snapshot() is
  'Verdict de santé, sans aucune donnée métier : booléens, horodatages et compteurs. '
  'Destiné à /api/health, interrogé par la supervision. Les champs hours_since_* sont '
  'les plus importants : une tâche qui ne tourne plus ne produit pas d''erreur, elle '
  'produit du silence.';

revoke execute on function public.health_snapshot() from public;
grant execute on function public.health_snapshot() to service_role;

-- -----------------------------------------------------------------------------
-- 3. TABLEAU DES TRAVAUX PLANIFIÉS
--
-- ⚠️ L'ABSENCE VAUT ÉCHEC. Un travail qui n'a jamais démarré n'a produit aucune
-- ligne `FAILED` : il n'existe simplement pas dans la table. Une vue qui se
-- contenterait de lister les exécutions passées serait donc muette exactement
-- dans le cas le plus grave — le planificateur arrêté.
--
-- La vue part donc de la liste des travaux ATTENDUS, et rapporte pour chacun sa
-- dernière exécution, ou son absence.
-- -----------------------------------------------------------------------------

create or replace view public.job_health with (security_invoker = true) as
with expected(job_name, max_age_hours) as (
  -- ⚠️ Les noms sont ceux que les travaux passent RÉELLEMENT à start_job_run().
  -- Une entrée mal orthographiée rendrait NEVER_RAN pour toujours : l'alerte
  -- crierait sur un travail qui tourne, et on finirait par la couper.
  values
    ('generate-occurrences', 26),
    ('process-notifications', 3),
    ('backup', 36)
),
latest as (
  select distinct on (job_name)
    job_name, status, started_at, finished_at, error_count, details
  from public.job_runs
  order by job_name, started_at desc
)
select
  expected.job_name,
  expected.max_age_hours,
  latest.status,
  latest.started_at,
  latest.finished_at,
  latest.error_count,
  latest.details,
  round(extract(epoch from now() - coalesce(latest.finished_at, latest.started_at)) / 3600.0, 1)
    as hours_since,
  case
    when latest.job_name is null then 'NEVER_RAN'
    when latest.status = 'FAILED' then 'FAILED'
    when latest.status = 'PARTIAL' then 'PARTIAL'
    when coalesce(latest.finished_at, latest.started_at)
         < now() - (expected.max_age_hours || ' hours')::interval then 'STALE'
    else 'OK'
  end as verdict
from expected
left join latest on latest.job_name = expected.job_name;

comment on view public.job_health is
  'État des travaux planifiés, ABSENCE COMPRISE. Part de la liste des travaux attendus '
  'et non des exécutions observées : un planificateur arrêté rend NEVER_RAN ou STALE, '
  'là où une simple lecture de job_runs ne rendrait rien du tout.';

grant select on public.job_health to authenticated;
