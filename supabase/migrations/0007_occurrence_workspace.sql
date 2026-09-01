-- =============================================================================
-- CONFORMIA — 0007 : écran de travail des occurrences
--
-- L'écran le plus consulté de l'application. Trois apports :
--   1. le retard CALCULÉ, jamais stocké ;
--   2. une vue de liste qui rend en UNE requête tout ce que le tableau affiche ;
--   3. des agrégats précalculés, pour ne jamais compter la table entière.
--
-- ⚠️ Le cloisonnement par domaine reste la contrainte dominante. Une vue
-- matérialisée n'est PAS soumise à la RLS : c'est un instantané appartenant au
-- propriétaire. Elle n'est donc jamais exposée directement — la section 4
-- explique le dispositif.
-- =============================================================================

-- =============================================================================
-- 1. LE RETARD EST CALCULÉ, JAMAIS STOCKÉ
-- =============================================================================

/*
 * ⚠️ Aucun statut OVERDUE n'existe et n'existera. Un retard stocké est faux dès
 * le lendemain de son écriture : il faudrait un job pour le maintenir, et toute
 * panne de ce job produirait un écran qui ment. Le retard se déduit de la date
 * et du statut, à chaque lecture.
 *
 * Une colonne GÉNÉRÉE est impossible ici : elle exige une expression immuable,
 * or la date du jour ne l'est pas. D'où une VUE.
 */

create or replace function public.overdue_exempt_statuses()
returns public.occurrence_status[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE']::public.occurrence_status[]
$$;

comment on function public.overdue_exempt_statuses() is
  'Statuts qui ARRÊTENT le compteur de retard : le dossier est parti chez
   l''administration, archivé, ou sans objet. VALIDATED n''en fait volontairement PAS
   partie — un dossier validé en interne mais non déposé est bel et bien en retard,
   et c''est précisément le cas qu''il faut voir.
   ⚠️ Définition UNIQUE : la vue de liste, les compteurs de navigation et les
   agrégats s''y réfèrent tous. Deux définitions donneraient deux chiffres
   différents pour la même question à deux endroits de l''écran.';

/*
 * `closed_occurrence_statuses()` (0005) incluait VALIDATED et servait au seul
 * compteur « en retard » de la barre latérale. Elle aurait donc affiché un
 * nombre différent de celui de la liste. On la retire au profit de la définition
 * ci-dessus, et le compteur est réécrit en conséquence (section 5).
 */
drop function if exists public.closed_occurrence_statuses();

-- =============================================================================
-- 2. VUE DE LISTE — une seule requête pour tout ce que le tableau affiche
-- =============================================================================

/*
 * `security_invoker = true` : la vue s'exécute avec les droits de l'appelant,
 * les politiques de obligation_occurrences et obligation_types s'appliquent donc
 * intégralement à travers elle. Sans ce réglage, la vue appartiendrait au
 * propriétaire et court-circuiterait tout le cloisonnement par domaine.
 *
 * Les compteurs de pièces sont des sous-requêtes de la LISTE DE SÉLECTION, et
 * non des jointures agrégées. La différence est décisive à 10 000 lignes : une
 * jointure agrégée regrouperait toute la table avant d'appliquer le LIMIT,
 * tandis qu'une sous-requête de liste de sélection n'est évaluée que pour les
 * 50 lignes réellement rendues.
 */
create view public.occurrence_list with (security_invoker = true) as
select
  oc.id,
  oc.entity_id,
  oc.obligation_type_id,
  oc.period_key,
  oc.period_start,
  oc.period_end,
  oc.event_date,
  oc.expiry_date,
  oc.legal_due_date,
  oc.internal_due_date,
  oc.status,
  oc.owner_id,
  oc.validator_id,
  oc.rectifies_occurrence_id,
  oc.rectification_index,
  oc.reference_number,
  oc.is_locked,
  oc.penalty_incurred,
  oc.created_at,
  oc.updated_at,

  ot.code as obligation_code,
  ot.name as obligation_name,
  ot.periodicity,
  ot.criticality,
  ot.domain_id,
  ot.authority_id,
  ot.requires_proof,

  dom.code as domain_code,
  dom.label as domain_label,
  auth_org.name as authority_name,

  owner_profile.full_name as owner_name,
  validator_profile.full_name as validator_name,

  -- Pièces : cochées / obligatoires. La liste de contrôle suit l'occurrence,
  -- elle est donc visible exactement quand l'occurrence l'est.
  (
    select count(*)::int
    from public.occurrence_checklist_items ci
    where ci.occurrence_id = oc.id and ci.is_checked
  ) as documents_provided,
  (
    select count(*)::int
    from public.occurrence_checklist_items ci
    where ci.occurrence_id = oc.id and ci.is_mandatory
  ) as documents_required,

  -- ⚠️ Comparaison à la date d'AUJOURD'HUI À ALGER. En UTC, entre 23 h et
  -- minuit, la date algérienne a déjà changé : le retard apparaîtrait un jour
  -- trop tard (cf. CLAUDE.md §2).
  (
    oc.legal_due_date < (now() at time zone 'Africa/Algiers')::date
    and not (oc.status = any (public.overdue_exempt_statuses()))
  ) as is_overdue,

  -- Alerte PRÉCOCE : l'échéance interne est dépassée alors que la légale tient
  -- encore. C'est la fenêtre pendant laquelle un retard se rattrape sans
  -- conséquence — la rendre visible est tout l'intérêt de la marge interne.
  (
    oc.internal_due_date < (now() at time zone 'Africa/Algiers')::date
    and not (oc.status = any (public.overdue_exempt_statuses()))
  ) as is_internally_late,

  (oc.internal_due_date - (now() at time zone 'Africa/Algiers')::date) as days_to_internal,
  (oc.legal_due_date - (now() at time zone 'Africa/Algiers')::date) as days_to_legal

/*
 * ⚠️ JOINTURES LATÉRALES AVEC `limit 1`. Les deux éléments comptent, et le
 * `limit 1` n'est PAS décoratif — c'est lui qui fait tout le travail.
 *
 * Le problème mesuré : avec des jointures ordinaires, le planificateur prenait
 * `obligation_types` (40 lignes) comme relation externe et, pour chacune,
 * reconstruisait un bitmap de 6 665 entrées sur les occurrences. Résultat :
 * 4 998 lignes matérialisées puis triées, 1 036 ms pour en rendre 50. La même
 * requête sans la jointure répondait en 18 ms. La bascule vient d'une estimation
 * de cardinalité fausse — 139 lignes attendues, 4 998 obtenues — que les
 * prédicats RLS, opaques au planificateur, rendent inévitable.
 *
 * Une simple jointure LATÉRALE ne suffit pas : le planificateur l'aplatit en
 * jointure ordinaire et reprend sa liberté de réordonner. Le `limit 1` en fait
 * une CLÔTURE D'OPTIMISATION : la sous-requête ne peut plus être aplatie, et
 * `obligation_occurrences` devient nécessairement la relation externe.
 *
 * Il est aussi exact sémantiquement : chaque sous-requête filtre sur une clé
 * primaire et ne peut rendre qu'une ligne.
 *
 * Mesure après correction : 24 ms au lieu de 1 036, avec un parcours d'index sur
 * l'échéance interne, un tri incrémental et 59 lignes examinées au lieu de 4 998.
 *
 * `join lateral ... on true` conserve la sémantique d'une jointure INTERNE : une
 * occurrence dont l'obligation est invisible reste écartée. Le cloisonnement
 * n'est pas relâché, seul l'ordre d'exécution est contraint.
 */
from public.obligation_occurrences oc
join lateral (
  select ot.code, ot.name, ot.periodicity, ot.criticality,
         ot.domain_id, ot.authority_id, ot.requires_proof
  from public.obligation_types ot
  where ot.id = oc.obligation_type_id
  limit 1
) ot on true
left join lateral (
  select d.code, d.label from public.domains d where d.id = ot.domain_id limit 1
) dom on true
left join lateral (
  select a.name from public.authorities a where a.id = ot.authority_id limit 1
) auth_org on true
left join lateral (
  select p.full_name from public.profiles p where p.id = oc.owner_id limit 1
) owner_profile on true
left join lateral (
  select p.full_name from public.profiles p where p.id = oc.validator_id limit 1
) validator_profile on true
where oc.deleted_at is null;

comment on view public.occurrence_list is
  '⚠️ security_invoker : la RLS de obligation_occurrences s''applique À TRAVERS cette
   vue. Un utilisateur d''un domaine n''y voit pas davantage que dans la table.
   Elle porte is_overdue et is_internally_late, CALCULÉS à la lecture : aucun statut
   de retard n''est stocké nulle part, il serait faux dès le lendemain.';

grant select on public.occurrence_list to authenticated;

-- =============================================================================
-- 3. INDEX DE L'ÉCRAN DE TRAVAIL
-- =============================================================================

/*
 * Le tri par défaut est l'échéance INTERNE, pas la légale : c'est l'objectif que
 * l'équipe se donne, et c'est sur lui que la liste s'ordonne. L'index porte
 * aussi `id`, qui ferme le curseur de pagination — sans lui, deux occurrences de
 * même échéance pourraient être sautées ou répétées entre deux pages.
 */
create index obligation_occurrences_internal_due_cursor_idx
  on public.obligation_occurrences (internal_due_date, id)
  where deleted_at is null;

create index obligation_occurrences_legal_due_cursor_idx
  on public.obligation_occurrences (legal_due_date, id)
  where deleted_at is null;

-- « Mes tâches » : les dossiers d'une personne, triés par échéance interne.
create index obligation_occurrences_owner_internal_due_idx
  on public.obligation_occurrences (owner_id, internal_due_date)
  where deleted_at is null;

-- File de validation : ce qui attend un validateur donné.
create index obligation_occurrences_validator_idx
  on public.obligation_occurrences (validator_id, status)
  where deleted_at is null and validator_id is not null;

-- Fenêtre du calendrier : une seule requête par intervalle affiché.
create index obligation_occurrences_calendar_idx
  on public.obligation_occurrences (internal_due_date)
  where deleted_at is null and status <> 'ARCHIVED';

-- Filtre « rectificatives uniquement ». Index partiel : la colonne vaut 0 sur
-- l'immense majorité des lignes.
create index obligation_occurrences_rectification_idx
  on public.obligation_occurrences (rectification_index, internal_due_date)
  where deleted_at is null and rectification_index > 0;

-- =============================================================================
-- 4. AGRÉGATS PRÉCALCULÉS
-- =============================================================================

/*
 * ⚠️ POINT DE SÉCURITÉ LE PLUS DÉLICAT DE CE FICHIER.
 *
 * Une vue matérialisée n'est pas soumise à la RLS : PostgreSQL ne le permet pas.
 * L'exposer telle quelle à `authenticated` publierait le nombre de dossiers
 * fiscaux à tout utilisateur RH — exactement ce que la politique
 * obligation_occurrences_select interdit, et qu'elle qualifie de fuite au même
 * titre qu'un SELECT.
 *
 * Le dispositif est donc :
 *   — la matview est GROUPÉE PAR DOMAINE, pour qu'un filtrage soit possible ;
 *   — aucun GRANT n'est accordé dessus ;
 *   — un seul accès existe, `occurrence_stats_for_caller()`, SECURITY DEFINER,
 *     qui réapplique explicitement le contrôle de domaine ligne par ligne.
 */
create materialized view public.occurrence_stats as
select
  ot.domain_id,
  oc.status,
  count(*)::int as total,
  count(*) filter (
    where oc.legal_due_date < (now() at time zone 'Africa/Algiers')::date
      and not (oc.status = any (public.overdue_exempt_statuses()))
  )::int as overdue,
  count(*) filter (
    where oc.internal_due_date < (now() at time zone 'Africa/Algiers')::date
      and not (oc.status = any (public.overdue_exempt_statuses()))
  )::int as internally_late,
  count(*) filter (
    where oc.internal_due_date between (now() at time zone 'Africa/Algiers')::date
                                   and (now() at time zone 'Africa/Algiers')::date + 7
  )::int as due_within_week,
  count(*) filter (
    where oc.internal_due_date between (now() at time zone 'Africa/Algiers')::date
                                   and (now() at time zone 'Africa/Algiers')::date + 30
  )::int as due_within_month,
  max(oc.updated_at) as last_activity_at
from public.obligation_occurrences oc
join public.obligation_types ot on ot.id = oc.obligation_type_id
where oc.deleted_at is null
group by ot.domain_id, oc.status;

comment on materialized view public.occurrence_stats is
  '⚠️ NON soumise à la RLS — PostgreSQL ne l''applique pas aux vues matérialisées.
   Aucun GRANT n''est accordé dessus : le seul accès est occurrence_stats_for_caller(),
   qui réapplique le cloisonnement par domaine. Rafraîchie toutes les 15 minutes ;
   ses compteurs de retard sont donc datés d''au plus un quart d''heure, ce qui est
   sans conséquence sur une granularité journalière.';

/*
 * Index unique EXIGÉ par REFRESH ... CONCURRENTLY. `nulls not distinct` parce que
 * `domain_id` est nullable : sans cela, deux lignes de domaine NULL seraient
 * considérées distinctes et l'unicité ne tiendrait pas.
 */
create unique index occurrence_stats_key_idx
  on public.occurrence_stats (domain_id, status) nulls not distinct;

revoke all on public.occurrence_stats from public, anon, authenticated;

create or replace function public.occurrence_stats_for_caller()
returns table (
  domain_id uuid,
  status public.occurrence_status,
  total int,
  overdue int,
  internally_late int,
  due_within_week int,
  due_within_month int
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.domain_id, s.status, s.total, s.overdue, s.internally_late,
         s.due_within_week, s.due_within_month
  from public.occurrence_stats s
  where public.is_active_user()
    -- Même prédicat que la politique des occurrences : un agrégat ne doit pas
    -- révéler ce qu'une liste refuserait d'afficher.
    and public.has_permission_in_domain('occurrence.read', s.domain_id)
$$;

comment on function public.occurrence_stats_for_caller() is
  '⚠️ SECURITY DEFINER parce que la matview sous-jacente n''est accessible à personne
   d''autre. Le contrôle de domaine est réappliqué ICI, explicitement : c''est la
   seule barrière, il n''y en a pas d''autre en dessous. Toute modification de cette
   clause est une modification du cloisonnement.';

revoke execute on function public.occurrence_stats_for_caller() from public, anon;
grant execute on function public.occurrence_stats_for_caller() to authenticated;

create or replace function public.refresh_occurrence_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- CONCURRENTLY : l'écran de travail continue de lire pendant le rafraîchissement.
  refresh materialized view concurrently public.occurrence_stats;
exception
  when others then
    -- Premier rafraîchissement, ou index unique absent : on retombe sur la forme
    -- bloquante plutôt que de laisser les agrégats se figer indéfiniment.
    refresh materialized view public.occurrence_stats;
end;
$$;

comment on function public.refresh_occurrence_stats() is
  'Rafraîchit les agrégats. Planifiée toutes les 15 minutes.';

revoke execute on function public.refresh_occurrence_stats() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('conformia-occurrence-stats')
  where exists (select 1 from cron.job where jobname = 'conformia-occurrence-stats');
  perform cron.schedule(
    'conformia-occurrence-stats',
    '*/15 * * * *',
    $job$select public.refresh_occurrence_stats()$job$
  );
exception when others then
  raise notice 'pg_cron indisponible (%). Planifier public.refresh_occurrence_stats() '
               'toutes les 15 minutes par un autre moyen.', sqlerrm;
end;
$$;

-- =============================================================================
-- 5. COMPTEURS DE NAVIGATION — alignés sur la définition unique du retard
-- =============================================================================

create or replace function public.navigation_counters()
returns table (
  overdue int,
  pending_validation int,
  my_tasks int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    -- Même définition que occurrence_list.is_overdue : la pastille de la barre
    -- latérale et la colonne de la liste doivent donner le même nombre.
    count(*) filter (
      where oc.legal_due_date < (now() at time zone 'Africa/Algiers')::date
        and not (oc.status = any (public.overdue_exempt_statuses()))
    )::int,
    count(*) filter (
      where oc.status = 'PENDING_VALIDATION'
        and public.can_validate_occurrence(oc.id)
    )::int,
    count(*) filter (
      where oc.owner_id = public.current_profile_id()
        and oc.status in ('TODO', 'IN_PROGRESS', 'REJECTED')
    )::int
  from public.obligation_occurrences oc
  where oc.deleted_at is null
$$;

comment on function public.navigation_counters() is
  '⚠️ SECURITY INVOKER. Les trois compteurs ne portent que sur les lignes que la RLS
   laisse voir. Le compteur de retard emploie overdue_exempt_statuses(), la MÊME
   définition que la liste — un écart entre les deux se lirait comme un défaut.';

-- =============================================================================
-- 6. RÉAFFECTATION GROUPÉE
-- =============================================================================

/*
 * Réaffectation de plusieurs dossiers en une transaction. Écrite en base et non
 * en boucle applicative : cinquante occurrences réaffectées une à une, ce sont
 * cinquante allers-retours, et un incident au vingtième laisse la moitié du lot
 * dans l'ancien état.
 *
 * ⚠️ SECURITY DEFINER, et il faut dire précisément pourquoi.
 *
 * Changer le responsable d'un dossier relève de `occurrence.assign`. Mais la
 * politique UPDATE de obligation_occurrences, elle, exige `occurrence.write`.
 * Or la DIRECTION détient la première sans la seconde : en SECURITY INVOKER,
 * son geste ne toucherait aucune ligne — l'écran afficherait un bouton actif et
 * ne ferait rien. Mesuré, pas supposé : la réaffectation rendait 0.
 *
 * `occurrence.assign` EST la permission qui autorise à changer le responsable ;
 * exiger en plus `occurrence.write` la viderait de son sens.
 *
 * Le contournement de RLS est compensé par quatre bornes :
 *   — l'appelant doit détenir `occurrence.assign` ;
 *   — il doit pouvoir LIRE les occurrences du domaine de chaque ligne : la
 *     fonction n'ouvre donc aucun dossier qu'il ne voyait pas déjà ;
 *   — seules les lignes non verrouillées et non closes bougent ;
 *   — seule la colonne `owner_id` change.
 *
 * Le trigger d'audit s'applique normalement : chaque réaffectation laisse une
 * trace nominative.
 */
create or replace function public.reassign_occurrences(
  p_occurrence_ids uuid[],
  p_owner_id uuid
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected int;
begin
  if not public.is_active_user() then
    raise exception 'Réaffectation refusée : session inactive.' using errcode = '42501';
  end if;

  if not public.has_permission('occurrence.assign') then
    raise exception 'Réaffectation refusée : occurrence.assign requis.'
      using errcode = '42501';
  end if;

  if p_owner_id is not null
     and not exists (
       select 1 from public.profiles p where p.id = p_owner_id and p.is_active
     )
  then
    raise exception 'Réaffectation refusée : destinataire inconnu ou désactivé.'
      using errcode = '23503';
  end if;

  update public.obligation_occurrences oc
     set owner_id = p_owner_id,
         updated_at = now()
   where oc.id = any (p_occurrence_ids)
     and oc.deleted_at is null
     -- Un dossier verrouillé ou clos ne change pas de mains.
     and oc.is_locked = false
     and oc.status not in ('ARCHIVED', 'SUBMITTED', 'NOT_APPLICABLE')
     -- ⚠️ Cloisonnement : on ne déplace pas un dossier qu'on n'a pas le droit
     -- de voir. Sans cette clause, SECURITY DEFINER ouvrirait tous les domaines.
     and public.has_permission_in_domain(
           'occurrence.read',
           public.obligation_domain_of_type(oc.obligation_type_id)
         );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.reassign_occurrences(uuid[], uuid) is
  '⚠️ SECURITY DEFINER borné. Réaffectation groupée, en UNE transaction. Exige
   occurrence.assign — la politique UPDATE exigeant occurrence.write, que la
   DIRECTION ne détient pas, une exécution sous les droits de l''appelant ne
   toucherait aucune ligne. Le cloisonnement par domaine est réappliqué ligne par
   ligne : la fonction n''ouvre rien que l''appelant ne voyait déjà. Les dossiers
   verrouillés ou clos sont exclus, et seul owner_id change.';

revoke execute on function public.reassign_occurrences(uuid[], uuid) from public, anon;
grant execute on function public.reassign_occurrences(uuid[], uuid) to authenticated;

-- =============================================================================
-- 7. PRÉFÉRENCES DE FILTRAGE PAR UTILISATEUR
-- =============================================================================

create table public.user_view_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Identifiant d'écran (« occurrences », « my-tasks »…), pas une URL : une
  -- refonte du routage ne doit pas effacer les préférences de tout le monde.
  view_key text not null,
  filters jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, view_key)
);

comment on table public.user_view_preferences is
  'Derniers filtres utilisés par écran et par personne. Confort d''usage pur : aucune
   donnée métier, aucune valeur probante. L''URL reste la source de vérité d''une vue
   partagée ; cette table ne sert qu''au retour sur un écran sans paramètres.';

alter table public.user_view_preferences enable row level security;

create policy user_view_preferences_select on public.user_view_preferences
  for select to authenticated using (user_id = auth.uid());
comment on policy user_view_preferences_select on public.user_view_preferences is
  'Chacun ne lit que ses propres préférences. Aucune exception d''administration :
   les filtres d''un collègue ne regardent personne.';

create policy user_view_preferences_insert on public.user_view_preferences
  for insert to authenticated with check (user_id = auth.uid());
comment on policy user_view_preferences_insert on public.user_view_preferences is
  'On n''enregistre de préférences que pour soi-même.';

create policy user_view_preferences_update on public.user_view_preferences
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
comment on policy user_view_preferences_update on public.user_view_preferences is
  'Idem insertion. Aucune politique DELETE : une préférence se remplace, elle ne
   se supprime pas — et la ligne disparaît avec le profil.';

/*
 * PAS de trigger d'audit sur cette table, et c'est délibéré.
 *
 * CLAUDE.md §3.6 impose une trace pour toute écriture sur une ENTITÉ MÉTIER.
 * Un choix de filtre n'en est pas une : il ne prouve rien, n'engage personne, et
 * changerait à chaque clic. Journaliser cela noierait le journal d'audit sous du
 * bruit, ce qui affaiblirait sa valeur probante au lieu de la renforcer.
 */
