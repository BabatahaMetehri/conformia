-- =============================================================================
-- 0022 — ACHEMINEMENT DES ALERTES SELON LA TRIADE
--
-- Les audiences dataient d'avant la triade : OWNER, VALIDATOR, DEPARTMENT_HEAD.
-- La première désignait le porteur, la deuxième le validateur, la troisième le
-- responsable du SERVICE du porteur — notion que 0018 a rendue caduque en
-- remplaçant la répartition par service par responsable / suppléant /
-- superviseur.
--
-- ⚠️ ON N'EFFACE PAS, ON DÉSACTIVE. PostgreSQL ne sait pas retirer une valeur
-- d'une énumération, et c'est heureux : `notification_rules` et le journal
-- d'audit portent les anciennes valeurs, et les effacer rendrait l'historique
-- illisible. Elles sont donc MIGRÉES puis laissées dormantes, comme les rôles
-- par service (0018) et comme les canaux SMS et WHATSAPP ci-dessous.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — LES AUDIENCES DE LA TRIADE
--
-- ⚠️ `alter type ... add value` ne peut pas s'exécuter dans la même transaction
-- que son premier usage. Les valeurs sont donc ajoutées ici, seules ; ce qui
-- s'en sert vient dans les sections suivantes.
-- =============================================================================

alter type public.notification_audience add value if not exists 'RESPONSIBLE';
alter type public.notification_audience add value if not exists 'DEPUTY';
alter type public.notification_audience add value if not exists 'SUPERVISOR';

/*
 * ⚠️ WHATSAPP EST DÉCLARÉ, PAS IMPLÉMENTÉ — et ce n'est pas une étape vers son
 * activation.
 *
 * Le courriel est le SEUL canal externe, décision arrêtée. Un second canal
 * ajouterait des démarches administratives, un coût par message et une surface
 * de panne, pour un gain marginal sur une équipe de cette taille. La valeur
 * existe pour que l'absence soit EXPLICITE : un administrateur qui la choisit
 * obtient une erreur qui se lit, plutôt qu'un silence qu'il mettra une semaine à
 * élucider.
 */
alter type public.notification_channel add value if not exists 'WHATSAPP';


-- =============================================================================
-- SECTION 2 — QUI EST L'AUDIENCE, MAINTENANT
--
-- ⚠️ LA CORRESPONDANCE N'EST PAS UN RENOMMAGE. `SUPERVISOR` désigne le
-- validateur DU DOSSIER (`validator_id`), pas le responsable du service du
-- porteur. C'est un changement de sens, pas d'étiquette : l'ancien
-- `DEPARTMENT_HEAD` remontait la hiérarchie de service, la triade désigne
-- nommément qui valide CE dossier. Une escalade qui se trompe de destinataire
-- ne réveille personne.
--
-- Les trois anciennes valeurs restent traitées, pour que les règles qu'une
-- migration n'aurait pas converties continuent d'acheminer quelque chose plutôt
-- que rien. Un silence d'acheminement est le pire des défauts : il ne se
-- signale pas.
-- =============================================================================

create or replace function public.notification_audience_members(
  p_occurrence uuid,
  p_audience public.notification_audience
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Le RESPONSABLE du dossier.
  select oc.owner_id
  from public.obligation_occurrences oc
  where oc.id = p_occurrence
    and p_audience in ('RESPONSIBLE', 'OWNER')
    and oc.owner_id is not null

  union

  -- Le SUPPLÉANT. Introduit par 0018 ; aucune ancienne audience n'y correspond,
  -- ce qui est logique : la fonction n'existait pas avant lui.
  select oc.deputy_id
  from public.obligation_occurrences oc
  where oc.id = p_occurrence
    and p_audience = 'DEPUTY'
    and oc.deputy_id is not null

  union

  -- Le SUPERVISEUR, c'est-à-dire le validateur DÉSIGNÉ SUR CE DOSSIER.
  select oc.validator_id
  from public.obligation_occurrences oc
  where oc.id = p_occurrence
    and p_audience in ('SUPERVISOR', 'VALIDATOR')
    and oc.validator_id is not null

  union

  /*
   * ⚠️ `DEPARTMENT_HEAD` EST CONSERVÉE ET REDIRIGÉE vers le validateur du
   * dossier. La notion de « responsable du service du porteur » n'existe plus
   * depuis 0018 : la laisser interroger `departments.head_id` ferait dépendre
   * une escalade d'une hiérarchie que plus personne ne tient à jour, et le jour
   * où elle serait vide, l'escalade n'atteindrait personne EN SILENCE.
   */
  select oc.validator_id
  from public.obligation_occurrences oc
  where oc.id = p_occurrence
    and p_audience = 'DEPARTMENT_HEAD'
    and oc.validator_id is not null

  union

  select ur.user_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where p_audience = 'DIRECTION'
    and r.code = 'DIRECTION'
    and ur.revoked_at is null
    and (ur.expires_at is null or ur.expires_at > pg_catalog.now());
$$;

comment on function public.notification_audience_members(uuid, public.notification_audience) is
  'Destinataires d''une audience pour un dossier. ⚠️ SUPERVISOR désigne le '
  'VALIDATEUR DU DOSSIER, pas le responsable d''un service : la triade nomme qui '
  'valide, elle ne remonte pas une hiérarchie. Les anciennes valeurs restent '
  'traitées pour qu''une règle non convertie achemine encore quelque chose.';


-- =============================================================================
-- SECTION 3 — MIGRATION DES RÈGLES EXISTANTES
-- =============================================================================

update public.notification_rules
   set audience = 'RESPONSIBLE'
 where audience = 'OWNER';

update public.notification_rules
   set audience = 'SUPERVISOR'
 where audience in ('VALIDATOR', 'DEPARTMENT_HEAD');

update public.escalation_policies
   set notify_audience = 'RESPONSIBLE'
 where notify_audience = 'OWNER';

update public.escalation_policies
   set notify_audience = 'SUPERVISOR'
 where notify_audience in ('VALIDATOR', 'DEPARTMENT_HEAD');


-- =============================================================================
-- SECTION 4 — LA CHAÎNE D'ALERTE, COMME DONNÉE
--
-- ⚠️ ÉCRITE UNE FOIS, EN VALUES, ET LA BASE Y EST RÉCONCILIÉE. Les jalons sont
-- des DONNÉES (CLAUDE.md §3.5) : ajouter un palier ne doit demander aucun
-- déploiement. Mais une chaîne éparpillée en `insert` successifs au fil des
-- migrations ne se relit pas, et personne ne peut alors répondre à « qui est
-- prévenu à J+3 ? » sans rejouer l'historique.
--
-- Les alertes préventives portent sur l'échéance INTERNE — celle que l'équipe se
-- fixe — et non sur l'échéance légale : prévenir à J-1 de l'échéance légale
-- arriverait après la date que l'entreprise s'était donnée pour agir.
--
-- LA CHAÎNE EST CUMULATIVE. « J+3 → + SUPERVISEUR » veut dire que le superviseur
-- s'AJOUTE au responsable et au suppléant, déjà prévenus à J+1 ; d'où la
-- répétition des audiences aux paliers suivants. La lire comme un remplacement
-- ferait cesser d'alerter celui qui doit agir au moment précis où l'affaire
-- s'aggrave.
-- =============================================================================

create temporary table alert_chain (
  offset_days int,
  audience public.notification_audience,
  template_key text,
  criticality public.criticality
);

insert into alert_chain (offset_days, audience, template_key, criticality)
values
  -- ── Préventif : le responsable, et lui seul. Élargir en amont banaliserait
  --    l'alerte, et le superviseur cesserait de la lire.
  (-30, 'RESPONSIBLE', 'UpcomingDeadline', null),
  (-15, 'RESPONSIBLE', 'UpcomingDeadline', null),
  (-7,  'RESPONSIBLE', 'UpcomingDeadline', null),
  (-1,  'RESPONSIBLE', 'UpcomingDeadline', null),

  -- ── Après échéance, chaîne standard.
  (1, 'RESPONSIBLE', 'OverdueAlert', null),
  (1, 'DEPUTY',      'OverdueAlert', null),

  (3, 'RESPONSIBLE', 'OverdueAlert', null),
  (3, 'DEPUTY',      'OverdueAlert', null),
  (3, 'SUPERVISOR',  'OverdueAlert', null),

  (7, 'RESPONSIBLE', 'OverdueAlert', null),
  (7, 'DEPUTY',      'OverdueAlert', null),
  (7, 'SUPERVISOR',  'OverdueAlert', null),
  (7, 'DIRECTION',   'OverdueAlert', null),

  -- ── Chaîne ACCÉLÉRÉE pour les obligations CRITICAL. Le jour même, et non le
  --    lendemain : sur une obligation critique, vingt-quatre heures de retard
  --    coûtent une pénalité, pas un rappel.
  (0, 'RESPONSIBLE', 'OverdueAlert', 'CRITICAL'),
  (0, 'DEPUTY',      'OverdueAlert', 'CRITICAL'),
  (0, 'SUPERVISOR',  'OverdueAlert', 'CRITICAL'),

  (2, 'RESPONSIBLE', 'OverdueAlert', 'CRITICAL'),
  (2, 'DEPUTY',      'OverdueAlert', 'CRITICAL'),
  (2, 'SUPERVISOR',  'OverdueAlert', 'CRITICAL'),
  (2, 'DIRECTION',   'OverdueAlert', 'CRITICAL');

/*
 * ⚠️ RÉCONCILIATION SYMÉTRIQUE, et seulement sur les règles GÉNÉRALES —
 * `obligation_type_id is null`. Une règle attachée à une obligation précise est
 * un réglage local, décidé par quelqu'un ; l'effacer au nom de la chaîne par
 * défaut reviendrait à défaire silencieusement une décision.
 */
delete from public.notification_rules nr
where nr.obligation_type_id is null
  and not exists (
    select 1 from alert_chain c
    where c.offset_days = nr.offset_days
      and c.audience = nr.audience
      and c.template_key = nr.template_key
      and c.criticality is not distinct from nr.criticality);

-- Chaque palier existe sur LES DEUX canaux : la notification in-app est le filet
-- qui survit à une panne du fournisseur de courriel.
insert into public.notification_rules
  (obligation_type_id, criticality, offset_days, channel, audience, template_key, is_active)
select null, c.criticality, c.offset_days, ch.channel::public.notification_channel,
       c.audience, c.template_key, true
from alert_chain c
cross join (values ('EMAIL'), ('IN_APP')) as ch(channel)
where not exists (
  select 1 from public.notification_rules nr
  where nr.obligation_type_id is null
    and nr.offset_days = c.offset_days
    and nr.audience = c.audience
    and nr.template_key = c.template_key
    and nr.channel = ch.channel::public.notification_channel
    and nr.criticality is not distinct from c.criticality);

drop table alert_chain;

-- -----------------------------------------------------------------------------
-- Vérification : la chaîne appliquée EST la chaîne déclarée.
--
-- ⚠️ Elle échoue la migration. Un acheminement qui ne correspond pas à ce qu'on
-- croit avoir écrit ne se découvre pas : personne ne remarque une alerte qui
-- n'est PAS partie.
-- -----------------------------------------------------------------------------

do $$
declare v_manquant text;
begin
  select string_agg(format('%s/%s', d.offset_days, d.audience), ', ' order by d.offset_days)
    into v_manquant
  from (values
    (-30, 'RESPONSIBLE'), (-15, 'RESPONSIBLE'), (-7, 'RESPONSIBLE'), (-1, 'RESPONSIBLE'),
    (1, 'RESPONSIBLE'), (1, 'DEPUTY'),
    (3, 'SUPERVISOR'), (7, 'DIRECTION')
  ) as d(offset_days, audience)
  where not exists (
    select 1 from public.notification_rules nr
    where nr.obligation_type_id is null
      and nr.criticality is null
      and nr.offset_days = d.offset_days
      and nr.audience::text = d.audience
      and nr.channel = 'EMAIL'
      and nr.is_active);

  if v_manquant is not null then
    raise exception 'Chaîne d''alerte incomplète, paliers manquants : %', v_manquant;
  end if;
end $$;


-- =============================================================================
-- SECTION 5 — ACHEMINEMENT EN CAS D'ABSENCE
--
-- ⚠️ CE QUE CETTE SECTION NE FAIT PAS : accorder ou retirer un droit. Une
-- absence reste une information d'ORGANISATION. Elle change À QUI L'ON ÉCRIT ;
-- elle ne touche à aucune permission, et le suppléant peut agir en permanence,
-- absence déclarée ou non. `is_absent_on()` n'est appelée par aucune POLITIQUE —
-- un test le vérifie structurellement — et l'appeler ici, dans une fonction
-- d'acheminement, ne contredit pas cette règle : décider d'un destinataire n'est
-- pas décider d'un droit.
--
-- ⚠️ LE DESTINATAIRE D'ORIGINE REÇOIT QUAND MÊME L'IN-APP. C'est ce qui lui
-- permet de retrouver le contexte à son retour : une alerte redirigée puis
-- effacée de sa liste lui ferait découvrir un dossier traité sans jamais savoir
-- qu'il lui avait été confié. Seul le COURRIEL est dérouté — c'est lui qui
-- réclame une action immédiate.
-- =============================================================================

drop function if exists public.due_notification_candidates(timestamptz);

create or replace function public.due_notification_candidates(p_now timestamptz default now())
returns table (
  occurrence_id uuid,
  rule_id uuid,
  escalation_policy_id uuid,
  recipient_id uuid,
  channel public.notification_channel,
  kind text,
  template_key text,
  offset_days int,
  obligation_code text,
  obligation_name text,
  authority_name text,
  criticality public.criticality,
  period_key text,
  internal_due_date date,
  legal_due_date date,
  status public.occurrence_status,
  recipient_email text,
  recipient_name text,
  owner_name text,
  -- Nom de la personne INITIALEMENT visée, quand le courriel a été dérouté vers
  -- son suppléant. NULL dans tous les autres cas.
  --
  -- ⚠️ C'est cette colonne qui rend la mention possible — « X est absent, vous
  -- recevez cette alerte en tant que suppléant ». Sans elle, le suppléant
  -- recevrait une alerte sur un dossier dont il n'est pas responsable, sans
  -- comprendre pourquoi elle lui arrive.
  absent_recipient_name text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with reference as (
    -- ⚠️ La journée de référence est celle d'ALGER, pas celle d'UTC. À 23 h 30
    -- locales, UTC est encore la veille : le jalon J-1 partirait un jour trop
    -- tard, tous les soirs, sans que rien ne le signale.
    select ((p_now at time zone 'Africa/Algiers')::date) as today
  ),
  eligible as (
    select oc.id, oc.obligation_type_id, oc.period_key, oc.internal_due_date,
           oc.legal_due_date, oc.status, oc.deputy_id, ot.code, ot.name, ot.criticality,
           a.name as authority_name,
           owner.full_name as owner_name
    from public.obligation_occurrences oc
    join public.obligation_types ot on ot.id = oc.obligation_type_id
    left join public.authorities a on a.id = ot.authority_id
    left join public.profiles owner on owner.id = oc.owner_id
    where oc.deleted_at is null
      -- Un dossier déposé, archivé ou sans objet n'a plus d'échéance à rappeler.
      and oc.status not in ('SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE')
  ),
  jalons as (
    select e.id as occurrence_id, r.id as rule_id, null::uuid as escalation_policy_id,
           m.member_id as recipient_id, r.channel,
           case when r.offset_days < 0 then 'UPCOMING_DEADLINE' else 'OVERDUE_ALERT' end as kind,
           r.template_key, r.offset_days,
           e.code, e.name, e.authority_name, e.criticality,
           e.period_key, e.internal_due_date, e.legal_due_date, e.status, e.owner_name,
           e.deputy_id
    from eligible e
    cross join reference ref
    cross join lateral public.resolve_notification_rules(e.obligation_type_id, e.criticality) r
    cross join lateral public.notification_audience_members(e.id, r.audience) as m(member_id)
    where e.internal_due_date + r.offset_days = ref.today
  ),
  escalades as (
    select e.id as occurrence_id, null::uuid as rule_id, p.id as escalation_policy_id,
           m.member_id as recipient_id, c.channel::public.notification_channel,
           'ESCALATION' as kind, 'EscalationNotice' as template_key, p.days_after_due as offset_days,
           e.code, e.name, e.authority_name, e.criticality,
           e.period_key, e.internal_due_date, e.legal_due_date, e.status, e.owner_name,
           e.deputy_id
    from eligible e
    cross join reference ref
    cross join lateral public.resolve_escalation_policies(e.obligation_type_id, e.criticality) p
    cross join lateral (
      -- Un palier désigne une audience, un rôle ou une personne. Les trois
      -- coexistent : la chaîne standard emploie l'audience, une politique locale
      -- peut viser nommément le contrôleur de gestion.
      select member_id from public.notification_audience_members(e.id, p.notify_audience) as t(member_id)
      union
      select ur.user_id
      from public.user_roles ur
      where p.notify_role_id is not null
        and ur.role_id = p.notify_role_id
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > pg_catalog.now())
      union
      select p.notify_user_id where p.notify_user_id is not null
    ) as m(member_id)
    cross join (values ('EMAIL'), ('IN_APP')) as c(channel)
    where e.internal_due_date + p.days_after_due = ref.today
  ),
  toutes as (select * from jalons union all select * from escalades),
  -- ⚠️ LE DÉROUTEMENT, ET SES QUATRE CONDITIONS. Toutes nécessaires :
  --   • canal COURRIEL — l'in-app reste au destinataire d'origine ;
  --   • le destinataire est absent à la journée de référence, heure d'Alger ;
  --   • le dossier a un suppléant — sans lui, on n'a personne vers qui router,
  --     et taire l'alerte serait pire que l'envoyer à un absent ;
  --   • le suppléant N'EST PAS le destinataire — router un absent vers lui-même
  --     produirait un courriel affirmant « vous êtes absent ».
  achemine as (
    select t.*,
           (t.channel = 'EMAIL'
            and public.is_absent_on(t.recipient_id, ref.today)
            and t.deputy_id is not null
            and t.deputy_id <> t.recipient_id) as reroute
    from toutes t
    cross join reference ref
  )
  select a.occurrence_id, a.rule_id, a.escalation_policy_id,
         case when a.reroute then a.deputy_id else a.recipient_id end,
         a.channel, a.kind, a.template_key, a.offset_days,
         a.code, a.name, a.authority_name, a.criticality,
         a.period_key, a.internal_due_date, a.legal_due_date, a.status,
         final.email, final.full_name, a.owner_name,
         case when a.reroute then origine.full_name else null end
  from achemine a
  join public.profiles final
    on final.id = (case when a.reroute then a.deputy_id else a.recipient_id end)
  left join public.profiles origine on origine.id = a.recipient_id
  where final.is_active
    and final.deleted_at is null
    -- ⚠️ Les canaux DORMANTS sont écartés À LA SOURCE. Le courriel est le seul
    -- canal externe ; laisser une règle SMS ou WHATSAPP remplir la file
    -- produirait des lignes qui échoueraient à chaque cycle, indéfiniment, et
    -- noieraient les échecs réels dans le journal.
    and a.channel in ('EMAIL', 'IN_APP');
$fn$;

comment on function public.due_notification_candidates(timestamptz) is
  'Alertes dues à cet instant, destinataires résolus. ⚠️ Le COURRIEL destiné à '
  'une personne absente est dérouté vers le suppléant du dossier, et '
  '`absent_recipient_name` porte le nom de l''absent pour que la mention soit '
  'possible. L''IN-APP reste au destinataire d''origine : il doit retrouver le '
  'contexte à son retour. Les canaux dormants sont écartés à la source.';

grant execute on function public.due_notification_candidates(timestamptz) to authenticated;
