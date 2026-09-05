-- =============================================================================
-- 0023 — RÉTABLISSEMENT DES FILTRES DE DESTINATAIRE
--
-- ⚠️ CETTE MIGRATION CORRIGE 0022, ET IL FAUT DIRE CE QUI S'EST PASSÉ.
--
-- 0022 a RÉÉCRIT `due_notification_candidates` pour y ajouter l'acheminement
-- vers le suppléant d'un absent. La réécriture partait de la version de 0014 et
-- en a perdu quatre garanties — non par décision, mais parce qu'une fonction
-- réécrite en entier ne dit pas ce qu'elle a cessé de faire :
--
--   1. LA PRÉFÉRENCE DE CANAL DU DESTINATAIRE n'était plus consultée. Un
--      utilisateur ayant coupé le courriel dans ses réglages en recevait de
--      nouveau — et l'écran de préférences devenait décoratif. C'est le pire des
--      défauts de ce genre : l'utilisateur croit avoir agi, le système lui donne
--      raison à l'écran, et rien ne change dans sa boîte.
--   2. `deactivated_at` n'était plus vérifié. Un compte désactivé — sorti de
--      l'entreprise, mais conservé pour la traçabilité — continuait de recevoir
--      des données de conformité à son adresse.
--   3. L'ABSENCE D'ADRESSE n'était plus écartée. Un profil sans courriel
--      produisait une ligne EMAIL qui ne pouvait qu'échouer, à chaque cycle,
--      jusqu'à épuisement des tentatives.
--   4. L'EXÉCUTION ÉTAIT ACCORDÉE À `authenticated`. 0014 la révoquait
--      explicitement. La fonction est SECURITY DEFINER et rend, pour la base
--      ENTIÈRE, les adresses des destinataires et le détail des dossiers :
--      l'accorder à tout compte connecté ouvrait une énumération complète.
--
-- Aucun test ne couvrait (2), (3) ni (4) ; (1) l'était, et c'est ce test qui a
-- dénoncé la régression dès que la suite de diffusion a été écrite.
--
-- ⚠️ POURQUOI UNE MIGRATION DE PLUS, ET NON UNE CORRECTION DE 0022 : 0022 est
-- appliquée. Modifier un fichier déjà joué laisserait toute base l'ayant exécuté
-- dans un état que le fichier ne décrit plus (CLAUDE.md §6). La correction se
-- lit ici, avec son motif.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — LA FONCTION, AVEC SES QUATRE FILTRES
--
-- ⚠️ LES FILTRES PORTENT SUR LE DESTINATAIRE FINAL, c'est-à-dire APRÈS
-- déroutement. C'est la seule lecture cohérente : quand un courriel est redirigé
-- vers le suppléant d'un absent, c'est le suppléant qui le reçoit, donc SA
-- préférence, SON adresse et SON état de compte qui décident. Appliquer les
-- filtres au destinataire d'origine ferait taire une alerte parce qu'une
-- personne absente, qui ne la recevra pas, avait coupé son courriel.
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
         final.id,
         a.channel, a.kind, a.template_key, a.offset_days,
         a.code, a.name, a.authority_name, a.criticality,
         a.period_key, a.internal_due_date, a.legal_due_date, a.status,
         final.email, final.full_name, a.owner_name,
         case when a.reroute then origine.full_name else null end
  from achemine a
  join public.profiles final
    on final.id = (case when a.reroute then a.deputy_id else a.recipient_id end)
  left join public.profiles origine on origine.id = a.recipient_id
  -- Préférence du destinataire FINAL, canal par canal.
  left join public.user_notification_preferences pref
    on pref.user_id = final.id and pref.channel = a.channel
  where final.is_active
    and final.deleted_at is null
    -- ⚠️ Un compte DÉSACTIVÉ — quelqu'un qui a quitté l'entreprise, dont le
    -- profil reste pour la traçabilité — ne doit plus rien recevoir. Son adresse
    -- existe toujours en base ; elle n'est plus relevée par personne, ou pire,
    -- elle l'est par quelqu'un d'autre.
    and final.deactivated_at is null
    -- ⚠️ ABSENCE DE LIGNE = CANAL ACTIF. Un compte neuf doit être prévenu, pas
    -- muet : le défaut d'un dispositif d'alerte doit être de parler.
    and coalesce(pref.is_enabled, true)
    -- ⚠️ Les canaux DORMANTS sont écartés À LA SOURCE. Le courriel est le seul
    -- canal externe ; laisser une règle SMS ou WHATSAPP remplir la file
    -- produirait des lignes qui échoueraient à chaque cycle, indéfiniment, et
    -- noieraient les échecs réels dans le journal.
    and a.channel in ('EMAIL', 'IN_APP')
    -- Un courriel sans adresse n'est pas un envoi raté, c'est un envoi
    -- impossible : la ligne consommerait trois tentatives pour rien.
    and (a.channel <> 'EMAIL' or final.email is not null);
$fn$;

comment on function public.due_notification_candidates(timestamptz) is
  'Alertes dues à cet instant, destinataires résolus. ⚠️ Le COURRIEL destiné à '
  'une personne absente est dérouté vers le suppléant du dossier, et '
  '`absent_recipient_name` porte le nom de l''absent pour que la mention soit '
  'possible. L''IN-APP reste au destinataire d''origine : il doit retrouver le '
  'contexte à son retour. Les filtres — préférence de canal, compte actif, '
  'adresse présente — portent sur le destinataire FINAL, donc après déroutement. '
  'Les canaux dormants sont écartés à la source.';

-- =============================================================================
-- SECTION 2 — L'EXÉCUTION REDEVIENT RÉSERVÉE
--
-- ⚠️ SECURITY DEFINER + accès `authenticated` = énumération complète. La
-- fonction rend, pour la base ENTIÈRE et sans égard aux politiques, l'adresse de
-- chaque destinataire, le libellé de chaque obligation et l'échéance de chaque
-- dossier. Elle n'est appelée que par la tâche horaire, sous le rôle de service.
-- 0014 l'avait révoquée ; 0022 l'a réaccordée par inadvertance.
-- =============================================================================

revoke execute on function public.due_notification_candidates(timestamptz)
  from public, anon, authenticated;

do $$
begin
  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.due_notification_candidates(timestamptz)',
       'execute') then
    raise exception
      'due_notification_candidates reste exécutable par authenticated : la révocation n''a pas pris.';
  end if;
end;
$$;
