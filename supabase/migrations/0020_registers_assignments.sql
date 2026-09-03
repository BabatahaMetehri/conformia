-- =============================================================================
-- 0020 — REGISTRES ET AFFECTATIONS : DE QUOI LES RENDRE UTILISABLES
--
-- Les migrations 0018 et 0019 ont posé le MODÈLE — la triade responsable /
-- suppléant / superviseur, les registres de commerce, la trace `acted_as`.
-- Rien de tout cela n'était atteignable depuis un écran.
--
-- Cette migration n'ajoute aucune règle métier. Elle expose ce qui existe déjà :
-- des vues qui joignent une fois pour toutes ce que les écrans afficheront, et
-- quelques fonctions pour les actes que l'interface doit pouvoir déclencher.
--
-- ⚠️ PRINCIPE TENU PARTOUT ICI : toute vue est `security_invoker`. La RLS
-- s'applique À TRAVERS elle, exactement comme sur les tables. Une vue de confort
-- qui contournerait le cloisonnement serait un contournement de plus, pas un
-- confort.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — L'ÉCHÉANCIER CONNAÎT LE REGISTRE ET LE SUPPLÉANT
--
-- `occurrence_list` joint déjà l'obligation, le domaine, l'organisme, le
-- responsable, le validateur et les compteurs de pièces : une seule requête rend
-- une page. Il lui manquait le suppléant — introduit en 0018 — et le registre,
-- sans lequel le filtre demandé n'a pas de support.
-- =============================================================================

drop view if exists public.occurrence_list;

create view public.occurrence_list
  with (security_invoker = true)
  as
  select oc.id,
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
         oc.deputy_id,
         oc.validator_id,
         oc.commercial_register_id,
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
         /*
          * ⚠️ LA PORTÉE VOYAGE AVEC LA LIGNE, et c'est ce qui rend tenable
          * l'interdiction de faire disparaître les obligations d'entreprise
          * quand on filtre sur un registre. L'écran ne devine pas : il lit.
          */
         ot.scope as obligation_scope,
         oc.domain_id,
         ot.authority_id,
         ot.requires_proof,
         dom.code as domain_code,
         dom.label as domain_label,
         au.name as authority_name,
         owner.full_name as owner_name,
         deputy.full_name as deputy_name,
         val.full_name as validator_name,
         cr.rc_number as register_number,
         cr.label as register_label,
         cr.status as register_status,
         (select count(*)::int from public.documents d
           where d.occurrence_id = oc.id and d.deleted_at is null) as documents_provided,
         (select count(*)::int from public.occurrence_checklist_items ci
           where ci.occurrence_id = oc.id and ci.is_mandatory) as documents_required,
         (oc.legal_due_date < (pg_catalog.now() at time zone 'Africa/Algiers')::date
          and oc.status not in ('SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE')) as is_overdue,
         (oc.internal_due_date < (pg_catalog.now() at time zone 'Africa/Algiers')::date
          and oc.status not in ('SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE')) as is_internally_late,
         (oc.internal_due_date - (pg_catalog.now() at time zone 'Africa/Algiers')::date)
           as days_to_internal,
         (oc.legal_due_date - (pg_catalog.now() at time zone 'Africa/Algiers')::date)
           as days_to_legal
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  join public.domains dom on dom.id = oc.domain_id
  left join public.authorities au on au.id = ot.authority_id
  left join public.profiles owner on owner.id = oc.owner_id
  left join public.profiles deputy on deputy.id = oc.deputy_id
  left join public.profiles val on val.id = oc.validator_id
  left join public.commercial_registers cr on cr.id = oc.commercial_register_id
  where oc.deleted_at is null;

comment on view public.occurrence_list is
  'Écran de travail : une seule requête rend une page complète. '
  'security_invoker — la RLS s''applique intégralement à travers la vue. '
  '⚠️ Porte `obligation_scope` : c''est lui qui permet de filtrer par registre '
  'SANS faire disparaître les obligations d''entreprise.';

grant select on public.occurrence_list to authenticated;


-- =============================================================================
-- SECTION 2 — LA LISTE DES REGISTRES
--
-- ⚠️ LE COMPTE À REBOURS EST CALCULÉ EN BASE, pas dans le navigateur. Une date
-- d'expiration lue à l'heure du poste client donnerait un nombre de jours
-- différent selon le fuseau de qui regarde — et l'échéance d'un registre de
-- commerce algérien ne dépend pas du fuseau de celui qui la consulte.
-- =============================================================================

create view public.commercial_register_list
  with (security_invoker = true)
  as
  select cr.id,
         cr.entity_id,
         cr.rc_number,
         cr.register_type,
         cr.label,
         cr.activity_label,
         cr.activity_codes,
         cr.address,
         cr.wilaya,
         cr.commune,
         cr.issued_at,
         cr.expires_at,
         cr.status,
         cr.notes,
         cr.created_at,
         cr.updated_at,
         cr.deleted_at,
         case
           when cr.expires_at is null then null
           else cr.expires_at - (pg_catalog.now() at time zone 'Africa/Algiers')::date
         end as days_to_expiry,
         /*
          * Un registre expirant sous 90 jours mérite d'être signalé. Le seuil est
          * ici plutôt qu'à l'écran pour que la liste et le tableau de bord
          * s'accordent : deux seuils recopiés finissent par diverger.
          */
         (cr.expires_at is not null
          and cr.status = 'ACTIF'
          and cr.expires_at - (pg_catalog.now() at time zone 'Africa/Algiers')::date
              between 0 and 90) as expires_soon,
         (cr.expires_at is not null
          and cr.expires_at < (pg_catalog.now() at time zone 'Africa/Algiers')::date) as expired,
         (select count(*)::int
            from public.obligation_types ot
           where ot.entity_id = cr.entity_id
             and ot.scope = 'PER_REGISTER'
             and ot.is_active
             and ot.deleted_at is null) as obligation_count,
         (select count(*)::int
            from public.obligation_occurrences oc
           where oc.commercial_register_id = cr.id
             and oc.deleted_at is null) as occurrence_count,
         (select count(*)::int
            from public.obligation_occurrences oc
           where oc.commercial_register_id = cr.id
             and oc.deleted_at is null
             and oc.legal_due_date < (pg_catalog.now() at time zone 'Africa/Algiers')::date
             and oc.status not in ('SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE')) as overdue_count
  from public.commercial_registers cr
  where cr.deleted_at is null;

comment on view public.commercial_register_list is
  'Liste des registres, avec compte à rebours d''expiration et volumétrie. '
  '⚠️ Les registres RADIÉS y figurent : une radiation arrête la génération, elle '
  'ne retire pas le registre de la vue — son historique doit rester consultable.';

grant select on public.commercial_register_list to authenticated;


-- =============================================================================
-- SECTION 3 — L'HISTORIQUE D'UN REGISTRE
--
-- C'est l'écran demandé : TOUTES les occurrences d'un registre, toutes périodes
-- confondues. Rien de plus qu'une lecture de `occurrence_list` bornée au
-- registre — mais il fallait que `occurrence_list` connaisse le registre, ce
-- qui est l'objet de la section 1.
--
-- La chronologie du REGISTRE LUI-MÊME est autre chose : ce sont ses propres
-- modifications, et elles vivent dans le journal d'audit.
-- =============================================================================

create or replace function public.register_timeline(p_register_id uuid)
returns table (
  occurred_at timestamptz,
  action text,
  actor_name text,
  changed_fields text[],
  before jsonb,
  after jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  /*
   * ⚠️ SECURITY DEFINER, et c'est nécessaire : `audit_log` n'est lisible qu'avec
   * `audit.read`, permission que ni le responsable ni le superviseur ne
   * détiennent. Or la chronologie d'un registre — renouvellement, changement
   * d'activité, suspension — n'est pas de l'audit technique : c'est la vie de
   * l'établissement, et elle appartient à qui suit ses dossiers.
   *
   * Le cloisonnement n'est pas relâché pour autant : la fonction ne rend RIEN si
   * l'appelant ne voit pas le registre, et c'est la RLS de
   * `commercial_registers` qui en décide, consultée explicitement ci-dessous.
   */
  select a.occurred_at,
         a.action::text,
         p.full_name,
         a.changed_fields,
         a.before,
         a.after
  from public.audit_log a
  left join public.profiles p on p.id = a.actor_id
  where a.entity_table = 'commercial_registers'
    -- `entity_id_ref` est du TEXTE : le journal d'audit couvre des tables dont
    -- la clé n'est pas toujours un uuid. La comparaison se fait donc sur le
    -- texte, côté paramètre, et non par un transtypage de la colonne qui
    -- écarterait l'index.
    and a.entity_id_ref = p_register_id::text
    and exists (
      select 1 from public.commercial_registers cr
      where cr.id = p_register_id
        and public.is_active_user()
        and public.has_permission('obligation.read')
    )
  order by a.occurred_at desc;
$$;

comment on function public.register_timeline(uuid) is
  'Modifications du registre lui-même — renouvellements, changements d''activité, '
  'suspension. ⚠️ Rend le vide si l''appelant ne peut pas voir les registres : la '
  'condition reprend celle de la politique `commercial_registers_select`.';

grant execute on function public.register_timeline(uuid) to authenticated;


-- =============================================================================
-- SECTION 4 — PROPAGATION D'UNE AFFECTATION PAR DÉFAUT
--
-- ⚠️ AUX SEULS DOSSIERS « À FAIRE », ET C'EST UNE RÈGLE, PAS UNE PRUDENCE.
--
-- Un dossier en cours de traitement a un responsable qui l'a commencé : lui
-- retirer sous les pieds parce que le référentiel a changé casserait la
-- séparation des pouvoirs — la trace dirait qu'il l'a préparé, la ligne dirait
-- qu'il ne s'en occupe pas — et ferait disparaître un dossier de la liste de
-- quelqu'un qui y travaillait.
-- =============================================================================

create or replace function public.propagate_default_assignment(
  p_obligation_type_id uuid,
  p_owner_id uuid,
  p_deputy_id uuid,
  p_validator_id uuid
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_touched int;
begin
  if not public.has_permission('occurrence.assign') then
    raise exception 'Affectation refusée : permission occurrence.assign requise.'
      using errcode = '42501';
  end if;

  update public.obligation_occurrences oc
     set owner_id = p_owner_id,
         deputy_id = p_deputy_id,
         validator_id = p_validator_id
   where oc.obligation_type_id = p_obligation_type_id
     and oc.status = 'TODO'
     and oc.deleted_at is null
     and oc.is_locked = false
     -- Ne rien écrire là où rien ne change : une écriture inutile produit une
     -- entrée d'audit qui raconte un événement qui n'a pas eu lieu.
     and (oc.owner_id is distinct from p_owner_id
          or oc.deputy_id is distinct from p_deputy_id
          or oc.validator_id is distinct from p_validator_id);

  get diagnostics v_touched = row_count;
  return v_touched;
end;
$$;

comment on function public.propagate_default_assignment(uuid, uuid, uuid, uuid) is
  'Applique l''affectation par défaut d''une obligation à ses dossiers À FAIRE. '
  '⚠️ SECURITY INVOKER : la RLS s''applique, l''appelant n''atteint que son '
  'périmètre. Les dossiers ENGAGÉS ne sont jamais touchés — leur responsable les '
  'a commencés.';

grant execute on function public.propagate_default_assignment(uuid, uuid, uuid, uuid)
  to authenticated;

/**
 * Combien de dossiers une propagation toucherait — pour le DIRE avant de le faire.
 *
 * ⚠️ Une confirmation qui annonce « des occurrences seront modifiées » ne permet
 * de décider de rien. Celle-ci annonce un nombre.
 */
create or replace function public.count_propagable_occurrences(p_obligation_type_id uuid)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from public.obligation_occurrences oc
  where oc.obligation_type_id = p_obligation_type_id
    and oc.status = 'TODO'
    and oc.deleted_at is null
    and oc.is_locked = false;
$$;

grant execute on function public.count_propagable_occurrences(uuid) to authenticated;


-- =============================================================================
-- SECTION 5 — LES ABSENCES EN COURS
--
-- ⚠️ CE QUE CETTE VUE NE FAIT PAS : accorder ou retirer un droit. Une absence
-- est une information d'ORGANISATION. Elle change l'acheminement des rappels ;
-- elle ne change aucune permission, et le suppléant peut agir en permanence,
-- absence déclarée ou non. `is_absent_on()` n'est appelée par aucune politique,
-- et un test le vérifie structurellement à chaque exécution.
-- =============================================================================

create view public.current_absences
  with (security_invoker = true)
  as
  select ab.id,
         ab.entity_id,
         ab.user_id,
         p.full_name as user_name,
         ab.starts_at,
         ab.ends_at,
         ab.reason,
         ab.created_at,
         ab.created_by,
         ab.revoked_at,
         (ab.revoked_at is null
          and (pg_catalog.now() at time zone 'Africa/Algiers')::date
              between ab.starts_at and ab.ends_at) as is_current,
         (ab.ends_at - (pg_catalog.now() at time zone 'Africa/Algiers')::date) as days_remaining
  from public.user_absences ab
  join public.profiles p on p.id = ab.user_id;

comment on view public.current_absences is
  'Absences déclarées, en cours ou passées. ⚠️ N''accorde et ne retire AUCUN '
  'droit : une absence oriente les rappels, elle ne touche pas aux permissions.';

grant select on public.current_absences to authenticated;


-- =============================================================================
-- SECTION 6 — SITUATION PAR REGISTRE
--
-- Le taux de conformité de chaque établissement. Un chiffre unique pour
-- l'entreprise masque l'établissement qui décroche ; c'est précisément ce qu'un
-- groupe multi-sites a besoin de voir.
-- =============================================================================

create or replace function public.register_compliance()
returns table (
  register_id uuid,
  rc_number text,
  label text,
  wilaya text,
  status text,
  total int,
  submitted int,
  overdue int,
  compliance_rate numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select cr.id,
         cr.rc_number,
         cr.label,
         cr.wilaya,
         cr.status,
         count(oc.id)::int,
         count(oc.id) filter (
           where oc.status in ('SUBMITTED', 'ARCHIVED'))::int,
         count(oc.id) filter (
           where oc.legal_due_date < (pg_catalog.now() at time zone 'Africa/Algiers')::date
             and oc.status not in ('SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE'))::int,
         /*
          * ⚠️ Le taux est NULL quand il n'y a aucun dossier, jamais 0 %. Un
          * établissement sans obligation n'est pas « à 0 % de conformité » — il
          * n'a rien à déclarer, et l'afficher en rouge enverrait chercher un
          * problème qui n'existe pas.
          *
          * Les dossiers SANS OBJET sortent du dénominateur : on ne peut pas être
          * en défaut sur une déclaration qui n'avait pas lieu d'être.
          */
         case
           when count(oc.id) filter (where oc.status <> 'NOT_APPLICABLE') = 0 then null
           else round(
             100.0 * count(oc.id) filter (where oc.status in ('SUBMITTED', 'ARCHIVED'))
             / count(oc.id) filter (where oc.status <> 'NOT_APPLICABLE'), 1)
         end
  from public.commercial_registers cr
  left join public.obligation_occurrences oc
         on oc.commercial_register_id = cr.id and oc.deleted_at is null
  where cr.deleted_at is null
  group by cr.id, cr.rc_number, cr.label, cr.wilaya, cr.status
  order by cr.register_type, cr.rc_number;
$$;

comment on function public.register_compliance() is
  'Taux de conformité par registre. SECURITY INVOKER : la RLS s''applique, et le '
  'taux ne porte donc que sur les dossiers que l''appelant peut voir.';

grant execute on function public.register_compliance() to authenticated;


-- =============================================================================
-- SECTION 7 — LA RECHERCHE GLOBALE CONNAIT LES REGISTRES
--
-- Chercher « 16/00-1234567 B 24 » ou « Rouiba » depuis n'importe quel écran.
-- Le vecteur suit la forme des trois autres : le NUMÉRO en tête de poids, la
-- désignation ensuite, l'activité en appui.
-- =============================================================================

create or replace function public.commercial_register_search_vector(
  p_rc_number text,
  p_label text,
  p_activity_label text,
  p_wilaya text
)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_rc_number)), 'A') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_label)), 'B') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_activity_label)), 'C') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_wilaya)), 'C')
$$;

comment on function public.commercial_register_search_vector(text, text, text, text) is
  'Vecteur de recherche d''un registre : numéro RC en poids fort, désignation, '
  'puis activité et wilaya.';

create index if not exists commercial_registers_search_idx
  on public.commercial_registers
  using gin (public.commercial_register_search_vector(rc_number, label, activity_label, wilaya))
  where deleted_at is null;

create or replace function public.global_search(p_query text, p_limit integer default 5)
returns table (kind text, result_id uuid, title text, subtitle text, rank real)
language sql
stable
set search_path = ''
as $$
  (
    select
      'OBLIGATION'::text,
      ot.id,
      ot.name,
      ot.code,
      ts_rank(
        public.obligation_type_search_vector(ot.code, ot.name, ot.legal_basis, ot.procedure_md),
        public.search_tsquery(p_query)
      )
    from public.obligation_types ot
    where public.search_tsquery(p_query) is not null
      and ot.deleted_at is null
      and public.obligation_type_search_vector(ot.code, ot.name, ot.legal_basis, ot.procedure_md)
          @@ public.search_tsquery(p_query)
    order by 5 desc, ot.name
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )

  union all

  (
    select
      'OCCURRENCE'::text,
      oc.id,
      ot.name,
      oc.period_key,
      ts_rank(
        public.occurrence_search_vector(oc.period_key, oc.reference_number, ot.code, ot.name),
        public.search_tsquery(p_query)
      )
    from public.obligation_occurrences oc
    join public.obligation_types ot on ot.id = oc.obligation_type_id
    where public.search_tsquery(p_query) is not null
      and oc.deleted_at is null
      and public.occurrence_search_vector(oc.period_key, oc.reference_number, ot.code, ot.name)
          @@ public.search_tsquery(p_query)
    order by 5 desc, oc.legal_due_date desc
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )

  union all

  (
    select
      'DOCUMENT'::text,
      d.id,
      d.original_filename,
      oc.period_key,
      ts_rank(
        public.document_search_vector(d.original_filename, d.normalized_filename),
        public.search_tsquery(p_query)
      )
    from public.documents d
    join public.obligation_occurrences oc on oc.id = d.occurrence_id
    where public.search_tsquery(p_query) is not null
      and d.deleted_at is null
      and public.document_search_vector(d.original_filename, d.normalized_filename)
          @@ public.search_tsquery(p_query)
    order by 5 desc, d.uploaded_at desc
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )

  union all

  (
    select
      'REGISTER'::text,
      cr.id,
      cr.label,
      cr.rc_number,
      ts_rank(
        public.commercial_register_search_vector(
          cr.rc_number, cr.label, cr.activity_label, cr.wilaya),
        public.search_tsquery(p_query)
      )
    from public.commercial_registers cr
    where public.search_tsquery(p_query) is not null
      and cr.deleted_at is null
      and public.commercial_register_search_vector(
            cr.rc_number, cr.label, cr.activity_label, cr.wilaya)
          @@ public.search_tsquery(p_query)
    -- ⚠️ Les RADIÉS restent trouvables. Chercher un établissement fermé pour
    -- consulter son historique est un besoin courant ; l'exclure ferait croire
    -- qu'il n'a jamais existé.
    order by 5 desc, cr.rc_number
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )
$$;

comment on function public.global_search(text, integer) is
  'Recherche transverse : obligations, dossiers, pièces et REGISTRES. '
  'La RLS de chaque table s''applique — la fonction n''est pas SECURITY DEFINER, '
  'et chacun ne trouve donc que ce qu''il pourrait déjà ouvrir.';

grant execute on function public.global_search(text, integer) to authenticated;
