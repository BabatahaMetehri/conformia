-- =============================================================================
-- 0021 — RÉAFFECTATION DE LA TRIADE, AVEC MOTIF
--
-- `reassign_occurrences()` (0007) ne connaît que le responsable. La triade
-- introduite en 0018 en compte trois, et le motif d'une réaffectation ponctuelle
-- doit être consigné : c'est lui qui explique, six mois plus tard, pourquoi un
-- dossier a changé de mains.
--
-- ⚠️ LES FONCTIONS EXISTANTES NE SONT PAS TOUCHÉES. `reassign_occurrences` sert
-- la réaffectation EN LOT depuis la liste, où l'on ne déplace que le
-- responsable ; celle-ci sert la réaffectation UNITAIRE depuis la fiche, où l'on
-- ajuste les trois. Deux gestes différents, deux fonctions.
-- =============================================================================

/*
 * ⚠️ LES TROIS RÔLES ONT UNE VALEUR PAR DÉFAUT, et ce n'est pas une commodité
 * d'écriture. `supabase gen types` ne sait pas exprimer la nullabilité d'un
 * paramètre : il produit `string` pour tout `uuid`, y compris quand la fonction
 * accepte NULL. Sans défaut, retirer un suppléant — passer NULL — deviendrait
 * une erreur de typage, et la seule issue serait un transtypage forcé à chaque
 * appel. Avec un défaut, l'appelant OMET la clé, ce que le type exprime
 * exactement, et SQL y voit le NULL attendu.
 */
create or replace function public.reassign_occurrence_triad(
  p_occurrence_id uuid,
  p_reason text,
  p_owner_id uuid default null,
  p_deputy_id uuid default null,
  p_validator_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.occurrence_status;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_affected int;
begin
  if not public.is_active_user() then
    raise exception 'Réaffectation refusée : session inactive.' using errcode = '42501';
  end if;

  if not public.has_permission('occurrence.assign') then
    raise exception 'Réaffectation refusée : occurrence.assign requis.'
      using errcode = '42501';
  end if;

  /*
   * ⚠️ LE MOTIF EST OBLIGATOIRE, ET CONTRÔLÉ ICI PLUTÔT QU'À L'ÉCRAN.
   *
   * Une réaffectation sans motif est indistinguable, dans le journal, d'une
   * erreur de manipulation. Le contrôle vit en base parce qu'un formulaire se
   * contourne — une Server Action est un point d'entrée HTTP — et que la trace
   * est précisément ce qu'on ne peut pas se permettre de perdre.
   */
  if v_reason is null or pg_catalog.length(v_reason) < 3 then
    raise exception 'Réaffectation refusée : un motif est requis.'
      using errcode = '23514',
            hint = 'Indiquer pourquoi le dossier change de mains.';
  end if;

  /*
   * ⚠️ TROIS PERSONNES DISTINCTES. Le même compte responsable ET validateur
   * viderait la séparation des pouvoirs de son contenu : le trigger la
   * refuserait au moment de valider, et l'utilisateur découvrirait le blocage
   * une fois le dossier prêt, sans comprendre d'où il vient. Mieux vaut refuser
   * l'affectation que la validation.
   */
  if (p_owner_id is not null and p_owner_id = p_deputy_id)
     or (p_owner_id is not null and p_owner_id = p_validator_id)
     or (p_deputy_id is not null and p_deputy_id = p_validator_id)
  then
    raise exception 'Réaffectation refusée : les trois rôles doivent être des personnes distinctes.'
      using errcode = '23514';
  end if;

  select oc.status into v_status
  from public.obligation_occurrences oc
  where oc.id = p_occurrence_id
    and oc.deleted_at is null
    -- ⚠️ Cloisonnement : on ne déplace pas un dossier qu'on n'a pas le droit de
    -- voir. Sans cette clause, SECURITY DEFINER ouvrirait tous les domaines.
    and oc.domain_id = any (public.accessible_domains_array('occurrence.read'));

  if v_status is null then
    raise exception 'Réaffectation refusée : dossier introuvable ou hors périmètre.'
      using errcode = '42501';
  end if;

  update public.obligation_occurrences oc
     set owner_id = p_owner_id,
         deputy_id = p_deputy_id,
         validator_id = p_validator_id,
         updated_at = pg_catalog.now()
   where oc.id = p_occurrence_id
     and oc.is_locked = false
     -- Un dossier clos ne change pas de mains : il n'y a plus rien à y faire.
     and oc.status not in ('ARCHIVED', 'SUBMITTED', 'NOT_APPLICABLE');

  get diagnostics v_affected = row_count;
  if v_affected = 0 then
    raise exception 'Réaffectation refusée : dossier verrouillé ou clos.'
      using errcode = '23514';
  end if;

  /*
   * ⚠️ LE MOTIF EST CONSIGNÉ DANS `occurrence_transitions`, ET C'EST DÉLIBÉRÉ.
   *
   * Le trigger d'audit journalise déjà QUI a changé QUOI — il compare les
   * lignes — mais `audit_log` n'a pas de place pour un motif rédigé. Or c'est le
   * motif qui a de la valeur six mois plus tard.
   *
   * La ligne porte `from_status = to_status` : ce n'est PAS un changement
   * d'état, et `metadata.kind` le dit explicitement pour que la chronologie
   * l'affiche comme une réaffectation et non comme une transition inerte.
   */
  insert into public.occurrence_transitions
    (occurrence_id, from_status, to_status, actor_id, acted_as, reason, metadata)
  values (
    p_occurrence_id, v_status, v_status, public.app_actor_id(),
    public.resolve_acted_as(p_occurrence_id, public.app_actor_id()),
    v_reason,
    jsonb_build_object(
      'kind', 'REASSIGNMENT',
      'owner_id', p_owner_id,
      'deputy_id', p_deputy_id,
      'validator_id', p_validator_id));

  return v_affected;
end;
$$;

comment on function public.reassign_occurrence_triad(uuid, text, uuid, uuid, uuid) is
  'Réaffectation UNITAIRE des trois rôles d''un dossier, motif obligatoire. '
  '⚠️ Ne remplace pas `reassign_occurrences`, qui sert la réaffectation en LOT du '
  'seul responsable depuis la liste. Le motif est consigné dans '
  '`occurrence_transitions` : `audit_log` sait dire qui a changé quoi, pas '
  'pourquoi.';

grant execute on function public.reassign_occurrence_triad(uuid, text, uuid, uuid, uuid)
  to authenticated;


-- =============================================================================
-- LA RECHERCHE DE PIÈCES CONNAÎT LE REGISTRE ET LA PORTÉE
--
-- ⚠️ SANS `obligation_scope`, LE FILTRE PAR REGISTRE SERAIT FORCÉMENT EXCLUSIF
-- SUR CET ÉCRAN. Or /documents est un écran de CONSULTATION : la question posée
-- est « qu'est-ce qui concerne cet établissement ? », et les pièces d'une
-- déclaration valant pour toute l'entreprise le concernent aussi. Les masquer
-- donnerait d'un établissement une image faussement dégarnie.
--
-- La colonne voyage donc avec la ligne, et l'écran n'a rien à deviner.
-- =============================================================================

drop view if exists public.documents_search;

create view public.documents_search
  with (security_invoker = true)
  as
  select d.id,
         d.occurrence_id,
         d.checklist_item_id,
         d.original_filename,
         d.normalized_filename,
         d.mime_type,
         d.size_bytes,
         d.sha256,
         d.version,
         d.supersedes_id,
         d.document_kind,
         d.uploaded_at,
         d.uploaded_by,
         d.integrity_status,
         d.integrity_checked_at,
         p.full_name as uploader_name,
         oc.period_key,
         oc.period_start,
         oc.legal_due_date,
         oc.status as occurrence_status,
         oc.commercial_register_id,
         ot.scope as obligation_scope,
         cr.rc_number as register_number,
         ot.id as obligation_type_id,
         ot.code as obligation_code,
         ot.name as obligation_name,
         dom.id as domain_id,
         dom.code as domain_code,
         au.id as authority_id,
         au.name as authority_name,
         not (exists (
           select 1 from public.documents newer
           where newer.supersedes_id = d.id and newer.deleted_at is null)) as is_current_version,
         concat_ws(' ', d.original_filename, d.normalized_filename, ot.code, ot.name,
                   oc.period_key, au.name, p.full_name) as search_text
  from public.documents d
  join public.obligation_occurrences oc on oc.id = d.occurrence_id
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  left join public.domains dom on dom.id = ot.domain_id
  left join public.authorities au on au.id = ot.authority_id
  left join public.commercial_registers cr on cr.id = oc.commercial_register_id
  left join public.profiles p on p.id = d.uploaded_by
  where d.deleted_at is null;

comment on view public.documents_search is
  'Recherche transverse de pièces. security_invoker : la RLS s''applique. '
  '⚠️ Porte `obligation_scope` et le registre, ce qui permet un filtre par '
  'établissement INCLUSIF — les pièces valant pour toute l''entreprise restent '
  'visibles, avec leur mention.';

grant select on public.documents_search to authenticated;


-- =============================================================================
-- UN NOUVEAU GENRE D'EXPORT : LA SITUATION PAR REGISTRE
--
-- ⚠️ `alter type ... add value` NE PEUT PAS s'exécuter dans le même bloc de
-- transaction que son premier usage. La valeur est donc ajoutée ici, seule ; ce
-- qui s'en sert vient après, dans le code applicatif.
--
-- `if not exists` rend l'instruction rejouable : une migration qui échoue à
-- mi-course doit pouvoir être relancée sans buter sur ce qu'elle a déjà fait.
-- =============================================================================

alter type public.export_kind add value if not exists 'REGISTERS';


-- =============================================================================
-- CORRECTION — `propagate_default_assignment` RENDAIT ZÉRO EN SILENCE
--
-- ⚠️ DÉFAUT MESURÉ, ET DU PIRE GENRE : la fonction ne levait AUCUNE erreur.
--
-- Livrée en 0020 en `security invoker`, elle garde sur `occurrence.assign` —
-- c'est la permission d'affecter. Mais la politique `obligation_occurrences_update`
-- exige `occurrence.write`. Or la matrice de 0019 accorde à la DIRECTION
-- `occurrence.assign` SANS `occurrence.write` : elle peut affecter, elle ne
-- prépare pas les dossiers.
--
-- Conséquence, constatée sur 23 dossiers : la fonction annonçait « 22 dossiers
-- concernés » par `count_propagable_occurrences`, puis en réaffectait ZÉRO, et
-- rendait 0 sans se plaindre. L'écran affichait « aucun dossier réaffecté »,
-- et l'utilisateur en concluait qu'aucun n'était éligible.
--
-- ⚠️ LA RÈGLE N'EST PAS TOUCHÉE : seuls les dossiers À FAIRE, non verrouillés,
-- et l'écriture reste sans effet là où rien ne change. C'est le modèle de
-- PRIVILÈGE qui est corrigé, pas le périmètre — `security definer` avec un
-- contrôle de cloisonnement EXPLICITE, exactement comme le fait
-- `reassign_occurrences` depuis 0007 et pour la même raison.
-- =============================================================================

create or replace function public.propagate_default_assignment(
  p_obligation_type_id uuid,
  p_owner_id uuid,
  p_deputy_id uuid,
  p_validator_id uuid
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_touched int;
begin
  if not public.is_active_user() then
    raise exception 'Affectation refusée : session inactive.' using errcode = '42501';
  end if;

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
     /*
      * ⚠️ CLOISONNEMENT EXPLICITE. `security definer` contourne la RLS : sans
      * cette clause, la fonction déplacerait des dossiers de domaines que
      * l'appelant n'a pas le droit de voir. On reprend la condition de LECTURE,
      * qui est celle que le cloisonnement impose ; l'autorisation d'AGIR, elle,
      * est déjà tranchée par `occurrence.assign` ci-dessus.
      */
     and oc.domain_id = any (public.accessible_domains_array('occurrence.read'))
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
  '⚠️ SECURITY DEFINER depuis 0021, avec cloisonnement explicite : en INVOKER, '
  'la politique d''écriture exigeait `occurrence.write` que la DIRECTION ne '
  'détient pas, et la fonction rendait ZÉRO en silence. Les dossiers ENGAGÉS ne '
  'sont jamais touchés — leur responsable les a commencés.';

/*
 * ⚠️ Le comptage doit voir EXACTEMENT ce que la propagation touchera, sans quoi
 * la confirmation annonce un nombre que l'action ne tient pas. Il passe donc lui
 * aussi en `security definer`, avec le MÊME cloisonnement.
 */
create or replace function public.count_propagable_occurrences(p_obligation_type_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.obligation_occurrences oc
  where oc.obligation_type_id = p_obligation_type_id
    and oc.status = 'TODO'
    and oc.deleted_at is null
    and oc.is_locked = false
    and oc.domain_id = any (public.accessible_domains_array('occurrence.read'));
$$;

comment on function public.count_propagable_occurrences(uuid) is
  'Nombre de dossiers qu''une propagation toucherait. ⚠️ MÊMES conditions que '
  '`propagate_default_assignment`, cloisonnement compris : un comptage plus '
  'large annoncerait un nombre que la propagation ne tiendrait pas.';
