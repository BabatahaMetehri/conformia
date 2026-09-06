-- =============================================================================
-- 0024 — COUVERTURE DU CALENDRIER DES JOURS FÉRIÉS
--
-- ⚠️ CETTE MIGRATION EXISTE POUR ROMPRE UN SILENCE, PAS POUR AJOUTER UNE DONNÉE.
--
-- Le défaut corrigé côté applicatif était le suivant : `is_recurring` était lue,
-- affichée, cochée par les administrateurs — et sans aucun effet. Le moteur
-- d'échéance recevait des dates EXACTES, si bien qu'une fête marquée récurrente
-- en 2026 ne protégeait rien en 2027. Comme le calendrier ne contenait que 2026,
-- TOUTE échéance calculée en 2027 ignorait les jours chômés.
--
-- Le plus grave n'est pas qu'il manquait des dates. C'est que rien ne le
-- signalait : aucune erreur, aucun message, aucun test rouge. Seulement une date
-- fausse qui a l'air juste.
--
-- On ajoute donc DEUX choses, et aucune n'est un calcul de fête :
--   • une vue qui MESURE la couverture, année par année ;
--   • une alerte de tableau de bord tant que l'année suivante ne porte aucune
--     fête religieuse.
--
-- ⚠️ AUCUNE FÊTE RELIGIEUSE N'EST CALCULÉE ICI, ET IL NE FAUT JAMAIS EN
-- CALCULER. Aïd el-Fitr, Aïd el-Adha, Awal Moharem, Achoura et Mawlid Ennabaoui
-- suivent le calendrier hégirien et sont fixées chaque année PAR DÉCRET. Toute
-- formule serait fausse une année sur deux — et fausse en silence, ce qui est
-- précisément le défaut qu'on répare.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — LA MESURE
--
-- ⚠️ LA DISTINCTION CIVIL / RELIGIEUX EST PORTÉE PAR `is_recurring`, ET C'EST
-- EXACT PLUTÔT QUE COMMODE. Les cinq fêtes civiles algériennes — 1er janvier,
-- Yennayer, 1er mai, 5 juillet, 1er novembre — reviennent au même jour du même
-- mois : elles sont saisies une fois, récurrentes, et valent pour toute année.
-- Les religieuses ne reviennent jamais à la même date grégorienne : elles sont
-- forcément saisies à l'année, donc non récurrentes.
--
-- Une année dont le compte de dates EXACTES est nul n'a donc reçu aucune fête
-- religieuse. Ce n'est jamais un état normal : c'est toujours un oubli.
-- =============================================================================

create or replace view public.holiday_calendar_coverage
with (security_invoker = true) as
with horizon as (
  /*
   * L'année courante et les deux suivantes. L'horizon de génération est de douze
   * mois (`DEFAULT_HORIZON_MONTHS`), et l'on ajoute une année de plus : une
   * période de décembre échoit en janvier, et c'est le calendrier de janvier qui
   * décide de son report.
   */
  select generate_series(
    extract(year from (now() at time zone 'Africa/Algiers'))::int,
    extract(year from (now() at time zone 'Africa/Algiers'))::int + 2
  ) as year
)
select
  h.year,
  -- Les récurrentes valent pour toute année : leur compte ne dépend pas de `h.year`.
  (select count(*)::int from public.holidays where is_recurring) as civil_count,
  -- Les exactes, elles, appartiennent à une année et à une seule.
  (select count(*)::int
     from public.holidays
    where not is_recurring
      and extract(year from holiday_date)::int = h.year) as religious_count,
  (select count(*)::int
     from public.holidays
    where not is_recurring
      and extract(year from holiday_date)::int = h.year) > 0 as is_complete
from horizon h
order by h.year;

comment on view public.holiday_calendar_coverage is
  'Couverture du calendrier, année par année, sur l''horizon de génération. '
  '⚠️ `civil_count` compte les récurrentes, qui valent pour toute année ; '
  '`religious_count` ne compte que les dates EXACTES, seule mesure honnête de ce '
  'qui a réellement été saisi pour cette année-là. Une année à zéro n''est jamais '
  'un état normal : les fêtes religieuses sont fixées par décret et ne se '
  'calculent pas, donc leur absence est toujours un oubli.';

grant select on public.holiday_calendar_coverage to authenticated;

-- =============================================================================
-- SECTION 2 — L'ALERTE
--
-- ⚠️ ELLE VISE L'ANNÉE SUIVANTE, PAS L'ANNÉE COURANTE. Signaler l'année en cours
-- serait signaler trop tard : les échéances de janvier se calculent en décembre.
-- L'alerte doit apparaître pendant qu'il reste le temps de saisir.
--
-- Elle est réservée à qui peut y remédier — `referential.manage` ouvre l'écran
-- Administration → Référentiels, où le calendrier se saisit. L'afficher à tous
-- la banaliserait sans donner à personne le moyen d'agir.
-- =============================================================================

create or replace function public.dashboard_alerts()
returns table (code text, severity text, total int, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  me uuid := public.current_profile_id();
  allowed uuid[];
  null_domain_allowed boolean;
  today date := (now() at time zone 'Africa/Algiers')::date;
  next_year int := extract(year from (now() at time zone 'Africa/Algiers'))::int + 1;
  n int;
begin
  if not public.is_active_user() then
    return;
  end if;

  select coalesce(array_agg(d.id), array[]::uuid[]) into allowed
  from public.domains d
  where public.has_permission_in_domain('occurrence.read', d.id);

  -- Une obligation sans domaine reste possible : son accès se décide à part.
  null_domain_allowed := public.has_permission_in_domain('occurrence.read', null);

  -- Dossiers CRITICAL en retard.
  select count(*)::int into n
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.deleted_at is null
    and ot.criticality = 'CRITICAL'
    and oc.legal_due_date < today
    and not (oc.status = any (public.overdue_exempt_statuses()))
    and (ot.domain_id = any (allowed)
         or (ot.domain_id is null and null_domain_allowed)
         or oc.owner_id = me or oc.validator_id = me);
  if n > 0 then
    code := 'CRITICAL_OVERDUE'; severity := 'CRITICAL'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  -- Échéance sous 48 h, dossier non démarré.
  select count(*)::int into n
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.deleted_at is null
    and oc.status = 'TODO'
    and oc.legal_due_date between today and today + 2
    and (ot.domain_id = any (allowed)
         or (ot.domain_id is null and null_domain_allowed)
         or oc.owner_id = me or oc.validator_id = me);
  if n > 0 then
    code := 'IMMINENT_NOT_STARTED'; severity := 'HIGH'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  -- Validation en attente depuis plus de cinq jours.
  select count(*)::int into n
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.deleted_at is null
    and oc.status = 'PENDING_VALIDATION'
    and oc.submitted_for_validation_at < now() - interval '5 days'
    and (ot.domain_id = any (allowed)
         or (ot.domain_id is null and null_domain_allowed)
         or oc.owner_id = me or oc.validator_id = me);
  if n > 0 then
    code := 'VALIDATION_STALE'; severity := 'HIGH'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  -- Aucune sauvegarde réussie depuis 36 h — « aucune, jamais » comprise.
  if public.has_permission('settings.manage')
     and not exists (
       select 1 from public.backup_runs b
       where b.status = 'SUCCEEDED' and b.finished_at > now() - interval '36 hours')
  then
    code := 'BACKUP_STALE'; severity := 'CRITICAL'; total := 1; detail := '{}'::jsonb;
    return next;
  end if;

  /*
   * ⚠️ CALENDRIER DE L'ANNÉE SUIVANTE SANS AUCUNE FÊTE RELIGIEUSE.
   *
   * Les fêtes religieuses sont fixées par décret : leur absence n'est jamais un
   * état normal, toujours un oubli. Et un oubli qui ne coûte rien tant que
   * l'année n'a pas commencé, puis qui décale silencieusement chaque échéance
   * tombant un jour chômé.
   *
   * `detail` porte l'année : le libellé doit pouvoir dire LAQUELLE, sans quoi
   * l'alerte oblige à aller chercher ce qu'elle voulait dire.
   */
  if public.has_permission('referential.manage')
     and not exists (
       select 1 from public.holidays
       where not is_recurring
         and extract(year from holiday_date)::int = next_year)
  then
    code := 'HOLIDAYS_INCOMPLETE';
    severity := 'HIGH';
    total := next_year;
    detail := jsonb_build_object('year', next_year);
    return next;
  end if;

  -- Divergence d'intégrité documentaire non acquittée.
  select count(*)::int into n from public.document_integrity_alerts;
  if n > 0 then
    code := 'INTEGRITY_MISMATCH'; severity := 'CRITICAL'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  return;
end;
$fn$;

comment on function public.dashboard_alerts() is
  'Bandeau d''alertes, calculé sur les tables VIVES — une alerte différée de '
  'quinze minutes ne vaut rien. Chaque branche applique le cloisonnement de '
  '`can_see_occurrence`, mais reformulé pour être évalué une fois par domaine et '
  'non une fois par dossier : la forme naïve coûtait 2 479 ms sur 50 000 lignes. '
  '⚠️ `HOLIDAYS_INCOMPLETE` signale l''année SUIVANTE : les échéances de janvier '
  'se calculent en décembre, et signaler l''année courante serait signaler trop tard.';

grant execute on function public.dashboard_alerts() to authenticated;

-- =============================================================================
-- SECTION 3 — VÉRIFICATION
--
-- ⚠️ La migration ÉCHOUE si la vue ne rend pas les trois années attendues. Une
-- vue de mesure qui ne mesure rien est pire qu'une absence de mesure : elle
-- rassure.
-- =============================================================================

do $$
declare
  annees int;
  courante int := extract(year from (now() at time zone 'Africa/Algiers'))::int;
begin
  select count(*)::int into annees from public.holiday_calendar_coverage;
  if annees <> 3 then
    raise exception 'holiday_calendar_coverage rend % année(s), 3 attendues.', annees;
  end if;

  if not exists (select 1 from public.holiday_calendar_coverage where year = courante + 1) then
    raise exception 'holiday_calendar_coverage ne couvre pas l''année suivante (%).', courante + 1;
  end if;
end;
$$;
