-- =============================================================================
-- 0008 — FICHE D'OCCURRENCE
--
-- Écran de travail effectif : dossier, pièces, discussion, historique, actions.
--
-- ⚠️ CE FICHIER NE CONTIENT PAS LA MACHINE À ÉTATS. Elle existe déjà, en données
-- (public.status_transition_rules) et en triggers (0001/0002) :
-- validate_status_transition() décide, record_status_transition() journalise.
-- apply_occurrence_transition() ci-dessous ne DÉCIDE aucune transition — elle
-- transporte. Elle existe parce que PostgREST ne sait pas, en une requête, poser
-- le GUC de motif, vérifier une version attendue et écrire les colonnes annexes.
-- Toute transition ajoutée demain reste une ligne de status_transition_rules.
-- =============================================================================

-- =============================================================================
-- 1. MOTIF DE RETARD — vocabulaire fermé, plus texte libre
--
--    C'est la donnée que personne ne possède aujourd'hui : POURQUOI les retards
--    se produisent. Un champ libre seul ne s'agrège pas ; une liste fermée
--    s'agrège mais appauvrit. Les deux, donc.
-- =============================================================================

create type public.late_reason_code as enum (
  'MISSING_DOCUMENT',
  'VALIDATOR_UNAVAILABLE',
  'LATE_EXTERNAL_INFORMATION',
  'OVERSIGHT',
  'OTHER'
);

comment on type public.late_reason_code is
  'Catégories de retard, pour agrégation dans le rapport de conformité. OVERSIGHT '
  '(« oubli ») figure délibérément dans la liste : une taxonomie qui n''offre que des '
  'causes externes produit des statistiques flatteuses et sans usage.';

alter table public.obligation_occurrences
  add column late_reason_code public.late_reason_code;

comment on column public.obligation_occurrences.late_reason_code is
  'Catégorie du retard, exigée au dépôt lorsque celui-ci intervient après '
  'legal_due_date. Le texte libre reste dans late_reason.';

-- OTHER sans explication ne dit rien : la catégorie fourre-tout est la seule qui
-- rende le champ libre obligatoire.
alter table public.obligation_occurrences
  add constraint obligation_occurrences_late_reason_other
  check (
    late_reason_code is distinct from 'OTHER'
    or nullif(btrim(late_reason), '') is not null
  );

create index obligation_occurrences_late_reason_idx
  on public.obligation_occurrences (late_reason_code)
  where late_reason_code is not null;

comment on index public.obligation_occurrences_late_reason_idx is
  'Alimente le rapport « pourquoi les retards se produisent ». Index partiel : la '
  'colonne est nulle sur l''immense majorité des lignes.';

-- =============================================================================
-- 2. COMPLÉTUDE DU DOSSIER
--
--    ⚠️ DÉCISION ARRÊTÉE : une pièce est fournie quand un DOCUMENT VIVANT lui est
--    rattaché — jamais parce qu'un utilisateur a coché une case. Un dossier de
--    conformité dont la complétude repose sur une déclaration ne prouve rien, et
--    l'interdiction de soumettre sans pièce obligatoire se contournerait d'un clic.
--
--    occurrence_checklist_items.is_checked devient donc une DÉRIVATION : le
--    trigger BEFORE la recalcule à chaque écriture, quelle que soit la valeur
--    envoyée. Les écrans de 5.1 qui la lisent continuent de fonctionner et ne
--    peuvent plus lire un mensonge.
-- =============================================================================

create or replace function public.derive_checklist_item_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest public.documents%rowtype;
begin
  select d.* into latest
  from public.documents d
  where d.checklist_item_id = new.id
    and d.deleted_at is null
  order by d.uploaded_at desc, d.id desc
  limit 1;

  new.is_checked := found;
  new.checked_by := case when found then latest.uploaded_by end;
  new.checked_at := case when found then latest.uploaded_at end;

  return new;
end;
$$;

comment on function public.derive_checklist_item_state() is
  'Recalcule is_checked / checked_by / checked_at depuis les pièces réellement '
  'déposées, en écrasant ce que l''appelant a envoyé. Cocher une pièce à la main '
  'n''est donc pas refusé : c''est sans effet, ce qui se contourne encore moins.';

create trigger trg_checklist_items_derive_state
  before insert or update on public.occurrence_checklist_items
  for each row execute function public.derive_checklist_item_state();

create or replace function public.touch_checklist_items_of_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un rattachement peut changer de pièce : les deux extrémités sont réévaluées.
  -- La réécriture est volontairement NEUTRE — c'est le trigger BEFORE ci-dessus
  -- qui calcule la valeur ; une seule expression de vérité, jamais deux.
  update public.occurrence_checklist_items ci
     set is_checked = ci.is_checked
   where ci.id = any (
     array_remove(
       array[
         (case when tg_op <> 'INSERT' then old.checklist_item_id end),
         (case when tg_op <> 'DELETE' then new.checklist_item_id end)
       ],
       null
     )
   );

  return null;
end;
$$;

comment on function public.touch_checklist_items_of_document() is
  'Propage un dépôt, un remplacement ou un retrait sur l''état de la pièce attendue. '
  'SECURITY DEFINER : le déposant détient document.upload, pas nécessairement '
  'occurrence.write, et la conséquence d''un dépôt ne peut pas dépendre de cela.';

create trigger trg_documents_touch_checklist
  after insert or update or delete on public.documents
  for each row execute function public.touch_checklist_items_of_document();

create or replace function public.occurrence_missing_items(p_occurrence_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(ci.label order by ci.order_index), array[]::text[])
  from public.occurrence_checklist_items ci
  where ci.occurrence_id = p_occurrence_id
    and ci.is_mandatory
    and not exists (
      select 1
      from public.documents d
      where d.checklist_item_id = ci.id
        and d.deleted_at is null
    );
$$;

comment on function public.occurrence_missing_items(uuid) is
  'Libellés des pièces OBLIGATOIRES encore absentes ; tableau vide si le dossier est '
  'complet. Sert au refus de soumission ET au message qui nomme précisément ce qui '
  'manque — « il manque une pièce » n''aide personne.';

-- -----------------------------------------------------------------------------
-- La vue de liste comptait les pièces cochées TOUTES catégories confondues face
-- aux seules obligatoires : « 5/3 » était atteignable. Les deux comptes portent
-- désormais sur le même ensemble.
-- -----------------------------------------------------------------------------

create or replace view public.occurrence_list with (security_invoker = true) as
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

  (
    select count(*)::int
    from public.occurrence_checklist_items ci
    where ci.occurrence_id = oc.id and ci.is_mandatory and ci.is_checked
  ) as documents_provided,
  (
    select count(*)::int
    from public.occurrence_checklist_items ci
    where ci.occurrence_id = oc.id and ci.is_mandatory
  ) as documents_required,

  (
    oc.legal_due_date < (now() at time zone 'Africa/Algiers')::date
    and not (oc.status = any (public.overdue_exempt_statuses()))
  ) as is_overdue,
  (
    oc.internal_due_date < (now() at time zone 'Africa/Algiers')::date
    and not (oc.status = any (public.overdue_exempt_statuses()))
  ) as is_internally_late,

  (oc.internal_due_date - (now() at time zone 'Africa/Algiers')::date) as days_to_internal,
  (oc.legal_due_date - (now() at time zone 'Africa/Algiers')::date) as days_to_legal

-- ⚠️ Les `limit 1` des jointures latérales sont des CLÔTURES D'OPTIMISATION, pas
-- une précaution : sans eux le planificateur aplatit la latérale, prend
-- obligation_types comme relation externe et la liste passe de 24 ms à 1 036 ms
-- sur 10 000 occurrences. Raisonnement complet en 0007.
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

-- =============================================================================
-- 3. AUDIT DES ÉCRITURES RESTÉES HORS JOURNAL
--
--    CLAUDE.md §3.6 : toute écriture métier produit une entrée d'audit. Deux
--    tables y échappaient. Un commentaire peut porter une justification de retard,
--    et l'état d'une pièce est un fait opposable : ce sont des écritures métier au
--    même titre qu'une transition.
-- =============================================================================

create trigger trg_audit
  after insert or update or delete on public.occurrence_comments
  for each row execute function public.audit_trigger();

create trigger trg_audit
  after insert or update or delete on public.occurrence_checklist_items
  for each row execute function public.audit_trigger();

-- =============================================================================
-- 4. VISIBILITÉ D'UNE OCCURRENCE POUR L'APPELANT
--
--    Reproduit exactement le USING de obligation_occurrences_select. Les fonctions
--    SECURITY DEFINER de ce fichier court-circuitent la RLS : elles doivent donc
--    réappliquer le cloisonnement, et une seule expression le porte.
-- =============================================================================

create or replace function public.can_see_occurrence(p_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.obligation_occurrences oc
    where oc.id = p_occurrence_id
      and oc.deleted_at is null
      and public.is_active_user()
      and (
        public.has_permission_in_domain(
          'occurrence.read', public.obligation_domain_of_type(oc.obligation_type_id))
        or oc.owner_id = public.current_profile_id()
        or oc.validator_id = public.current_profile_id()
      )
  );
$$;

comment on function public.can_see_occurrence(uuid) is
  'Copie fidèle du USING de obligation_occurrences_select, à l''usage des fonctions '
  'SECURITY DEFINER de ce fichier. Toute évolution du cloisonnement doit toucher les '
  'deux — le test d''intégration rls compare leurs résultats.';

-- =============================================================================
-- 5. TRANSITION D'ÉTAT — TRANSPORT, PAS DÉCISION
--
--    Rend un jsonb décrivant l'issue au lieu de lever une exception, pour les
--    issues ATTENDUES : version périmée, dossier incomplet, motif de retard requis.
--    Ce ne sont pas des bugs, ce sont des réponses (CLAUDE.md §3.3). Une transition
--    réellement interdite, elle, reste une exception levée par le trigger de 0002.
--
--    Aucune écriture n'a lieu avant que toutes les gardes soient franchies : un
--    retour anticipé ne laisse rien derrière lui.
-- =============================================================================

create or replace function public.apply_occurrence_transition(
  p_occurrence_id uuid,
  p_to_status public.occurrence_status,
  p_expected_version int,
  p_reason text default null,
  p_reference_number text default null,
  p_late_reason_code public.late_reason_code default null,
  p_late_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ public.obligation_occurrences%rowtype;
  needs_proof boolean;
  missing text[];
  today_algiers date := (pg_catalog.now() at time zone 'Africa/Algiers')::date;
  reason_clean text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_see_occurrence(p_occurrence_id) then
    -- Indistinguable d'un identifiant inexistant : l'écart de message permettrait
    -- d'énumérer les dossiers des autres domaines.
    return jsonb_build_object('outcome', 'NOT_FOUND');
  end if;

  select * into occ
  from public.obligation_occurrences
  where id = p_occurrence_id
  for update;

  if occ.status = p_to_status then
    return jsonb_build_object('outcome', 'NO_CHANGE', 'version', occ.version);
  end if;

  -- ⚠️ Verrouillage optimiste. La ligne est déjà verrouillée par le FOR UPDATE :
  -- deux transitions concurrentes se sérialisent, et la seconde voit la version
  -- déjà incrémentée. Jamais d'écrasement silencieux.
  if occ.version <> p_expected_version then
    return jsonb_build_object(
      'outcome', 'VERSION_CONFLICT',
      'version', occ.version,
      'status', occ.status
    );
  end if;

  -- Garde de complétude. Portée par la BASE et non par la seule Server Action :
  -- l'action est un point d'entrée HTTP, la base est le dernier rempart.
  if p_to_status = 'PENDING_VALIDATION' then
    missing := public.occurrence_missing_items(p_occurrence_id);
    if pg_catalog.array_length(missing, 1) is not null then
      return jsonb_build_object('outcome', 'INCOMPLETE', 'missing', to_jsonb(missing));
    end if;
  end if;

  if p_to_status = 'SUBMITTED' and occ.status = 'VALIDATED' then
    select ot.requires_proof into needs_proof
    from public.obligation_types ot
    where ot.id = occ.obligation_type_id;

    if coalesce(needs_proof, false) then
      if nullif(pg_catalog.btrim(coalesce(p_reference_number, occ.reference_number, '')), '') is null then
        return jsonb_build_object('outcome', 'REFERENCE_REQUIRED');
      end if;
      if not exists (
        select 1 from public.documents d
        where d.occurrence_id = p_occurrence_id
          and d.document_kind = 'PREUVE_DEPOT'
          and d.deleted_at is null
      ) then
        return jsonb_build_object('outcome', 'PROOF_REQUIRED');
      end if;
    end if;

    -- ⚠️ Motif de retard OBLIGATOIRE au-delà de l'échéance légale. C'est le seul
    -- moment où l'information est encore fraîche ; réclamée plus tard, elle est
    -- reconstruite, donc fausse.
    if occ.legal_due_date < today_algiers and p_late_reason_code is null then
      return jsonb_build_object('outcome', 'LATE_REASON_REQUIRED', 'dueDate', occ.legal_due_date);
    end if;
  end if;

  -- Motif transporté jusqu'au trigger, pour les transitions dont le motif n'a
  -- pas de colonne dédiée (réouverture d'archive, retour d'un dossier sans objet).
  perform pg_catalog.set_config('conformia.transition_reason', coalesce(reason_clean, ''), true);

  update public.obligation_occurrences
     set status = p_to_status,
         started_at = case
           when p_to_status = 'IN_PROGRESS' then coalesce(started_at, pg_catalog.now())
           else started_at end,
         submitted_for_validation_at = case
           when p_to_status = 'PENDING_VALIDATION' then pg_catalog.now()
           else submitted_for_validation_at end,
         validated_at = case
           when p_to_status = 'VALIDATED' then pg_catalog.now() else validated_at end,
         validated_by = case
           when p_to_status = 'VALIDATED' then public.app_actor_id() else validated_by end,
         submitted_at = case
           when p_to_status = 'SUBMITTED' then pg_catalog.now() else submitted_at end,
         submitted_by = case
           when p_to_status = 'SUBMITTED' then public.app_actor_id() else submitted_by end,
         reference_number = coalesce(
           nullif(pg_catalog.btrim(coalesce(p_reference_number, '')), ''), reference_number),
         late_reason_code = case
           when p_to_status = 'SUBMITTED' then coalesce(p_late_reason_code, late_reason_code)
           else late_reason_code end,
         late_reason = case
           when p_to_status = 'SUBMITTED'
             then coalesce(nullif(pg_catalog.btrim(coalesce(p_late_reason, '')), ''), late_reason)
           else late_reason end,
         na_reason = case
           when p_to_status = 'NOT_APPLICABLE' then reason_clean else na_reason end,
         rejection_reason = case
           when p_to_status = 'REJECTED' then reason_clean else rejection_reason end
   where id = p_occurrence_id
     and version = p_expected_version
  returning * into occ;

  if not found then
    return jsonb_build_object('outcome', 'VERSION_CONFLICT');
  end if;

  return jsonb_build_object('outcome', 'APPLIED', 'version', occ.version, 'status', occ.status);
end;
$$;

comment on function public.apply_occurrence_transition is
  'TRANSPORT d''une transition, pas sa décision : l''autorisation, l''existence de la '
  'transition et l''obligation de motif restent portées par validate_status_transition() '
  'et par status_transition_rules. Ajoute ici, et ici seulement, ce que PostgREST ne sait '
  'pas exprimer : version attendue, GUC de motif, colonnes annexes, gardes de complétude '
  'et de motif de retard. SECURITY DEFINER car obligation_occurrences_update exige '
  'occurrence.write, que DIRECTION ne détient pas alors qu''elle détient occurrence.validate, '
  'occurrence.mark_na et occurrence.unlock : sans cela, ces trois actions seraient des '
  'boutons sans effet. Bornes : dossier visible de l''appelant, version attendue, et le '
  'trigger de transition qui vérifie la permission exacte de CHAQUE transition.';

revoke all on function public.apply_occurrence_transition(
  uuid, public.occurrence_status, int, text, text, public.late_reason_code, text) from public;
grant execute on function public.apply_occurrence_transition(
  uuid, public.occurrence_status, int, text, text, public.late_reason_code, text) to authenticated;

-- =============================================================================
-- 6. DÉCLARATION RECTIFICATIVE
--
--    Une rectificative n'écrase rien : c'est une occurrence de plus, reliée à
--    l'originale, avec sa propre liste de pièces et son propre cycle de vie.
--
--    ⚠️ Les échéances de l'originale sont REPRISES telles quelles. L'échéance
--    légale d'une période est un fait, pas un choix : inventer une échéance de
--    confort pour la rectificative reviendrait à inventer une règle réglementaire
--    (CLAUDE.md §7). Une rectificative déposée tardivement apparaît donc en retard
--    — ce qui est exact — jusqu'à son dépôt, statut qui l'exempte du compteur.
-- =============================================================================

create or replace function public.create_occurrence_rectification(
  p_occurrence_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.obligation_occurrences%rowtype;
  base_key text;
  next_index int;
  new_id uuid;
  reason_clean text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if reason_clean is null then
    raise exception 'Motif obligatoire pour une déclaration rectificative.'
      using errcode = '23514';
  end if;

  if not public.can_see_occurrence(p_occurrence_id) then
    raise exception 'Occurrence introuvable.' using errcode = 'P0002';
  end if;

  select * into source
  from public.obligation_occurrences
  where id = p_occurrence_id
  for update;

  if source.status not in ('SUBMITTED', 'ARCHIVED') then
    raise exception 'Une rectificative ne se crée que depuis un dossier déposé ou archivé (statut : %).',
      source.status
      using errcode = '23514';
  end if;

  -- La permission d'écriture est celle du dossier créé, pas du dossier source :
  -- rectifier, c'est ouvrir un nouveau dossier de travail.
  if not public.has_permission_in_domain(
        'occurrence.write', public.obligation_domain_of_type(source.obligation_type_id)) then
    raise exception 'Permission occurrence.write requise.' using errcode = '42501';
  end if;

  -- Rectifier une rectificative reste rattaché à la période de BASE : la chaîne
  -- des suffixes ne s'empile pas (2026-01-R1-R1 n'aurait aucun sens).
  base_key := pg_catalog.regexp_replace(source.period_key, '-R[0-9]+$', '');

  select coalesce(max(o.rectification_index), 0) + 1 into next_index
  from public.obligation_occurrences o
  where o.entity_id = source.entity_id
    and o.obligation_type_id = source.obligation_type_id
    and (o.period_key = base_key or o.period_key like base_key || '-R%');

  insert into public.obligation_occurrences (
    entity_id, obligation_type_id,
    period_key, period_start, period_end, event_date, expiry_date,
    legal_due_date, internal_due_date,
    status, owner_id, validator_id,
    rectifies_occurrence_id, rectification_index
  )
  values (
    source.entity_id, source.obligation_type_id,
    base_key || '-R' || next_index, source.period_start, source.period_end,
    source.event_date, source.expiry_date,
    source.legal_due_date, source.internal_due_date,
    'TODO', source.owner_id, source.validator_id,
    source.id, next_index
  )
  returning id into new_id;

  -- Liste de pièces REGÉNÉRÉE depuis le référentiel courant : une rectificative
  -- se dépose sous les règles d'aujourd'hui, pas sous celles d'hier.
  insert into public.occurrence_checklist_items (
    occurrence_id, required_document_id, label, is_mandatory, document_kind, order_index
  )
  select new_id, rd.id, rd.label, rd.is_mandatory, rd.document_kind, rd.order_index
  from public.obligation_required_documents rd
  where rd.obligation_type_id = source.obligation_type_id
  order by rd.order_index;

  -- Le motif se lit sur la ligne de création du journal d'état : la rectificative
  -- porte sa justification dès sa première seconde d'existence.
  insert into public.occurrence_transitions
    (occurrence_id, from_status, to_status, actor_id, reason, metadata)
  values (
    new_id, null, 'TODO', public.app_actor_id(), reason_clean,
    jsonb_build_object('origin', 'RECTIFICATION', 'rectifies', source.id::text)
  );

  return new_id;
end;
$$;

comment on function public.create_occurrence_rectification(uuid, text) is
  'Crée la n-ième rectificative d''une période : même obligation, même période de base, '
  'period_key suffixée -Rn, liste de pièces régénérée depuis le référentiel courant, '
  'statut TODO. SECURITY DEFINER pour écrire la liste de pièces et la ligne de journal '
  'dans la MÊME transaction que l''occurrence — une rectificative sans ses pièces ou sans '
  'son motif serait un dossier orphelin. Bornes : dossier source visible, statut SUBMITTED '
  'ou ARCHIVED, occurrence.write sur le domaine, motif non vide.';

revoke all on function public.create_occurrence_rectification(uuid, text) from public;
grant execute on function public.create_occurrence_rectification(uuid, text) to authenticated;

-- =============================================================================
-- 7. DÉPENDANCE ENTRE OBLIGATIONS — INFORMATION, JAMAIS BLOCAGE
--
--    « Le dépôt des comptes sociaux suppose que l'AGO 2026 soit clôturée. »
--    Le rapprochement se fait sur la période : l'occurrence la plus récente de
--    l'obligation dont on dépend qui commence au plus tard avec la nôtre. Aucune
--    égalité de period_key n'est exigée — les deux obligations peuvent avoir des
--    périodicités différentes, c'est même le cas normal.
-- =============================================================================

create or replace function public.occurrence_dependency_state(p_occurrence_id uuid)
returns table (
  obligation_type_id uuid,
  obligation_code text,
  obligation_name text,
  dependency_occurrence_id uuid,
  period_key text,
  status public.occurrence_status
)
language sql
stable
set search_path = ''
as $$
  select
    dep.id,
    dep.code,
    dep.name,
    dep_occ.id,
    dep_occ.period_key,
    dep_occ.status
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  join public.obligation_types dep on dep.id = ot.depends_on_obligation_type_id
  left join lateral (
    select o.id, o.period_key, o.status
    from public.obligation_occurrences o
    where o.obligation_type_id = dep.id
      and o.entity_id = oc.entity_id
      and o.deleted_at is null
      and o.period_start <= oc.period_start
    order by o.period_start desc
    limit 1
  ) dep_occ on true
  where oc.id = p_occurrence_id;
$$;

comment on function public.occurrence_dependency_state(uuid) is
  'Obligation dont dépend celle de l''occurrence, et état de sa propre occurrence la plus '
  'proche. ⚠️ INFORMATION SEULE : aucune transition n''est empêchée par une dépendance non '
  'clôturée. Le métier sait parfois ce que le modèle ignore, et bloquer sur cette base '
  'produirait des contournements hors de l''outil.';

-- =============================================================================
-- 8. INDEX D'APPUI DE LA FICHE
-- =============================================================================

-- Onglet « Dossier » : pièces rattachées à une ligne de la liste de contrôle.
create index documents_checklist_item_idx
  on public.documents (checklist_item_id)
  where checklist_item_id is not null and deleted_at is null;

comment on index public.documents_checklist_item_idx is
  'Sert occurrence_missing_items() et l''affichage pièce par pièce. Sans lui, la garde de '
  'complétude balaierait la table des documents à chaque soumission.';

-- Onglet « Périodes précédentes » : les 12 dernières occurrences de la même
-- obligation. L'index de 0001 porte sur (obligation_type_id, period_start desc)
-- sans clause partielle ; celui-ci écarte en plus les dossiers supprimés.
create index obligation_occurrences_history_idx
  on public.obligation_occurrences (obligation_type_id, entity_id, period_start desc)
  where deleted_at is null;

-- =============================================================================
-- 9. CONVENTION DE NOM NORMALISÉ — CORRECTION
--
--    La convention posée en 0003 s'arrêtait à {CODE}_{PERIODE}_{KIND}_v{N}. Deux
--    pièces DIFFÉRENTES de même nature sur le même dossier — deux JUSTIFICATIF —
--    produisaient alors le même nom en v1 et violaient la contrainte d'unicité
--    (occurrence_id, normalized_filename, version) : la seconde pièce du dossier
--    était refusée. Le libellé de la pièce attendue est intercalé, puisque c'est
--    lui qui les distingue aux yeux de l'utilisateur.
-- =============================================================================

comment on column public.documents.normalized_filename is
  'Nom normalisé : {CODE_OBLIGATION}_{PERIODE}_{DOCUMENT_KIND}_{LIBELLE_PIECE}_v{N}.{ext}. '
  'C''est ce nom qui est proposé au téléchargement, pour que les pièces redéposées soient '
  'identifiables. Le segment de libellé n''est pas décoratif : sans lui, deux pièces de même '
  'nature sur un même dossier entrent en collision sur documents_version_key.';

-- =============================================================================
-- 10. SÉPARATION DES TÂCHES — UNE SEULE EXPRESSION, DEUX CONSOMMATEURS
--
--    `can_validate_occurrence()` répond « l'appelant détient-il le droit de
--    valider ce domaine », pas « peut-il valider CE dossier maintenant » : la
--    séparation des tâches vit dans un autre trigger. L'interface qui n'aurait
--    consulté que la première aurait affiché « Valider » au préparateur, dont
--    l'action aurait ensuite échoué.
--
--    Le prédicat est donc extrait, et `enforce_separation_of_duties()` le
--    consulte au lieu de le réimplémenter. Une règle, un endroit.
-- =============================================================================

create or replace function public.self_validation_blocked(
  p_occurrence_type_id uuid,
  p_owner_id uuid,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_actor_id is not null
    and p_owner_id is not null
    and p_actor_id = p_owner_id
    and not public.setting_bool('allow_self_validation', false)
    and not coalesce(
      (select ot.allow_self_validation from public.obligation_types ot
        where ot.id = p_occurrence_type_id),
      false);
$$;

comment on function public.self_validation_blocked(uuid, uuid, uuid) is
  'Vrai quand l''acteur est le préparateur du dossier ET que l''auto-validation n''est '
  'levée ni globalement ni sur l''obligation. Consultée par le trigger qui refuse ET par '
  'la barre d''actions qui masque : le bouton ne peut plus promettre ce que la base refuse.';

create or replace function public.enforce_separation_of_duties()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'VALIDATED' or old.status = 'VALIDATED' then
    return new;
  end if;

  if public.self_validation_blocked(
       new.obligation_type_id, new.owner_id, public.current_profile_id()) then
    raise exception
      'Séparation des tâches : le préparateur d''une occurrence ne peut pas la valider.'
      using errcode = '42501',
            hint = 'Faire valider par un tiers, ou lever l''interdiction sur cette obligation.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_separation_of_duties() is
  'Refuse la validation par le préparateur. Ne porte plus la règle : il la LIT dans '
  'self_validation_blocked(), partagée avec l''interface.';

/**
 * Même prédicat, adressé par le dossier — ce que l'interface a sous la main.
 */
create or replace function public.self_validation_blocked_for(p_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.self_validation_blocked(
           oc.obligation_type_id, oc.owner_id, public.current_profile_id())
  from public.obligation_occurrences oc
  where oc.id = p_occurrence_id
    and public.can_see_occurrence(oc.id);
$$;

comment on function public.self_validation_blocked_for(uuid) is
  'Variante adressée par occurrence, à l''usage de la barre d''actions. Rend NULL sur un '
  'dossier invisible de l''appelant — traité comme « non concluant » côté interface, qui '
  'n''affichera de toute façon aucun bouton sur un dossier qu''elle n''a pas pu charger.';

-- =============================================================================
-- 11. CORRECTION — add_business_days() LEVAIT UNE EXCEPTION À CHAQUE APPEL
--
--    La version de 0003 écrivait :
--
--      select array_agg(value::int)
--        from public.app_settings s,
--             lateral jsonb_array_elements_text(s.value) as value
--
--    `value` désigne alors À LA FOIS la colonne jsonb de app_settings et l'alias
--    de la latérale : PostgreSQL répond « column reference "value" is ambiguous »
--    et la fonction ne rend jamais rien.
--
--    Conséquence mesurée : `can_validate_occurrence()` appelle cette fonction
--    dans sa branche de repli DIRECTION, atteinte précisément quand l'appelant ne
--    détient PAS occurrence.validate. La fonction censée rendre « false » levait
--    donc une exception — et la fiche d'un dossier en attente de validation
--    échouait au chargement pour tout préparateur.
--
--    Le défaut n'avait aucune couverture : rien n'appelait encore cette fonction
--    sur un chemin testé.
-- =============================================================================

create or replace function public.add_business_days(from_date date, day_count int)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  cursor_date date := from_date;
  remaining int := day_count;
  weekend int[];
begin
  select coalesce(
           (select array_agg(day_value::int)
              from public.app_settings s,
                   lateral pg_catalog.jsonb_array_elements_text(s.value) as day_value
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

comment on function public.add_business_days(date, int) is
  'Ajoute n jours ouvrés, week-end algérien (vendredi-samedi) et jours fériés déduits. '
  'L''alias de la latérale ne s''appelle plus `value` : il entrait en collision avec la '
  'colonne du même nom et rendait la fonction inappelable.';

-- =============================================================================
-- 12. SUPPRESSION LOGIQUE — CE QUE LA RLS INTERDISAIT SANS QU'ON LE SACHE
--
--    ⚠️ COMPORTEMENT POSTGRESQL PEU CONNU, MESURÉ ICI : quand une table porte une
--    politique SELECT, la ligne RÉSULTANTE d'un UPDATE doit elle aussi la
--    satisfaire. Or `occurrence_comments_select` et `documents_select` filtrent
--    toutes deux `deleted_at is null`.
--
--    Conséquence : poser `deleted_at` faisait sortir la ligne du champ de la
--    politique de lecture, et l'UPDATE était refusé — « new row violates row-level
--    security policy ». Autrement dit, la SEULE forme de suppression que le projet
--    autorise (CLAUDE.md §6 : jamais de suppression physique) était impossible.
--    Vérifié sur une table témoin, hors de tout contexte applicatif.
--
--    Deux issues possibles : retirer `deleted_at is null` des politiques de lecture
--    — mais la garantie de confidentialité reposerait alors sur la discipline de
--    chaque requête — ou passer l'écriture par une fonction bornée. La seconde est
--    retenue : la politique de lecture reste la garantie, et le retrait devient une
--    opération nommée, tracée, à conditions explicites.
-- =============================================================================

create or replace function public.soft_delete_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
begin
  select c.author_id into author
  from public.occurrence_comments c
  where c.id = p_comment_id
    and c.deleted_at is null
    and public.can_see_occurrence(c.occurrence_id);

  if not found then
    return false;
  end if;

  -- Mêmes conditions que occurrence_comments_update : chacun ne retire que ses
  -- propres commentaires. La fonction ne relâche rien, elle rend l'écriture possible.
  if author is distinct from public.current_profile_id() then
    raise exception 'Seul l''auteur peut retirer son commentaire.' using errcode = '42501';
  end if;

  update public.occurrence_comments
     set deleted_at = pg_catalog.now()
   where id = p_comment_id;

  return true;
end;
$$;

comment on function public.soft_delete_comment(uuid) is
  'Retrait logique d''un commentaire. SECURITY DEFINER non pour élargir un droit mais '
  'pour contourner un effet de bord de la politique de LECTURE : une ligne dont on pose '
  'deleted_at cesse de satisfaire `deleted_at is null`, et PostgreSQL refuse alors '
  'l''UPDATE. La ligne survit, et le trigger d''audit conserve son texte.';

revoke all on function public.soft_delete_comment(uuid) from public;
grant execute on function public.soft_delete_comment(uuid) to authenticated;

create or replace function public.soft_delete_document(p_document_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents%rowtype;
  reason_clean text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if reason_clean is null then
    raise exception 'Motif obligatoire pour retirer une pièce.' using errcode = '23514';
  end if;

  select * into doc
  from public.documents d
  where d.id = p_document_id
    and d.deleted_at is null;

  if not found or not public.can_see_occurrence(doc.occurrence_id) then
    return false;
  end if;

  -- Mêmes conditions que documents_update.
  if not public.has_permission_in_domain(
       'document.delete', public.obligation_domain_of_occurrence(doc.occurrence_id)) then
    raise exception 'Permission document.delete requise.' using errcode = '42501';
  end if;

  update public.documents
     set deleted_at = pg_catalog.now(),
         deleted_by = public.current_profile_id(),
         deletion_reason = reason_clean
   where id = p_document_id;

  return true;
end;
$$;

comment on function public.soft_delete_document(uuid, text) is
  'Retrait logique d''une pièce, motif obligatoire. Même raison d''être que '
  'soft_delete_comment : la politique de lecture filtre deleted_at is null, ce qui '
  'rendait l''UPDATE de retrait impossible. Le fichier reste dans le bucket — aucune '
  'politique DELETE n''existe sur storage.objects, et c''est délibéré.';

revoke all on function public.soft_delete_document(uuid, text) from public;
grant execute on function public.soft_delete_document(uuid, text) to authenticated;
