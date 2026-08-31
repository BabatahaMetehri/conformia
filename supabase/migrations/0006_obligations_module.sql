-- =============================================================================
-- CONFORMIA — 0006 : module référentiel des obligations
--
-- Trois apports :
--   1. la recherche plein texte porte désormais sur la PROCÉDURE ;
--   2. deux barrières structurelles — on ne désactive pas une obligation dont
--      une autre dépend, on ne supprime pas une obligation qui porte encore des
--      dossiers vivants ;
--   3. le recalcul des échéances après modification d'une règle, strictement
--      borné aux occurrences au statut TODO.
--
-- ⚠️ Aucune règle réglementaire ici. Périodicités, ancres et décalages restent
-- des DONNÉES portées par obligation_types.due_rule (cf. CLAUDE.md §3.5).
-- =============================================================================

-- =============================================================================
-- 1. RECHERCHE — la procédure entre dans l'index
-- =============================================================================

/*
 * 0005 annonçait la conséquence : modifier le corps d'une fonction indexée
 * n'actualise pas l'index, PostgreSQL faisant confiance à `immutable`. Ajouter
 * un champ change la SIGNATURE, ce qui est plus franc — l'ancien index devient
 * inutilisable et doit être reconstruit ici même, dans la même migration.
 *
 * Ordre imposé : créer la nouvelle fonction, la faire adopter par global_search,
 * puis seulement retirer l'ancienne et son index.
 */

create or replace function public.obligation_type_search_vector(
  p_code text, p_name text, p_legal_basis text, p_procedure_md text
)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_code)), 'A') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_name)), 'B') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_legal_basis)), 'C') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_procedure_md)), 'D')
$$;

comment on function public.obligation_type_search_vector(text, text, text, text) is
  'Vecteur de recherche d''une obligation. Le code pèse plus que le nom, le nom plus que
   la base légale, et la procédure vient en dernier : elle est longue, et un mot qui y
   apparaît une fois ne dit pas que le document parle de ce sujet.
   ⚠️ Toute modification de ce corps exige un REINDEX de obligation_types_search_idx.';

-- global_search adopte la nouvelle signature AVANT que l'ancienne ne disparaisse.
create or replace function public.global_search(p_query text, p_limit int default 5)
returns table (
  kind text,
  result_id uuid,
  title text,
  subtitle text,
  rank real
)
language sql
stable
security invoker
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
$$;

comment on function public.global_search(text, int) is
  '⚠️ SECURITY INVOKER, et cela doit le rester. La recherche s''exécute sous la RLS de
   l''appelant : on ne trouve pas ce qu''on n''a pas le droit de lire, et l''absence de
   résultat ne distingue pas « inexistant » de « interdit ».';

drop index public.obligation_types_search_idx;
drop function public.obligation_type_search_vector(text, text, text);

create index obligation_types_search_idx on public.obligation_types
  using gin (public.obligation_type_search_vector(code, name, legal_basis, procedure_md))
  where deleted_at is null;

-- =============================================================================
-- 2. BARRIÈRES STRUCTURELLES
-- =============================================================================

/*
 * Ces deux règles sont posées en TRIGGER, pas dans le service.
 *
 * Un service peut être contourné : un job, un script de migration, une session
 * psql d'astreinte écrivent directement dans la table. La règle « on ne coupe
 * pas le sol sous une dépendance active » doit tenir dans ces cas-là aussi,
 * sans quoi elle n'est qu'une politesse de l'interface.
 */

create or replace function public.prevent_obligation_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependent_count int;
begin
  -- Ne se déclenche qu'au passage actif → inactif.
  if old.is_active = false or new.is_active = true then
    return new;
  end if;

  select count(*) into dependent_count
  from public.obligation_types dependent
  where dependent.depends_on_obligation_type_id = new.id
    and dependent.is_active = true
    and dependent.deleted_at is null;

  if dependent_count > 0 then
    raise exception
      'Désactivation refusée : % obligation(s) active(s) dépendent de celle-ci.',
      dependent_count
      using errcode = '23514',
            hint = 'Désactiver ou détacher les obligations dépendantes au préalable.';
  end if;

  return new;
end;
$$;

comment on function public.prevent_obligation_deactivation() is
  'Une obligation cible d''une dépendance ACTIVE ne se désactive pas. La désactivation
   n''affecte jamais les occurrences déjà générées — elle ne fait qu''arrêter les
   générations futures ; c''est la chaîne de dépendance, elle, qui se romprait.';

create trigger trg_obligation_types_prevent_deactivation
  before update on public.obligation_types
  for each row execute function public.prevent_obligation_deactivation();

create or replace function public.prevent_obligation_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_count int;
begin
  -- Ne se déclenche qu'au moment où la suppression logique est posée.
  if old.deleted_at is not null or new.deleted_at is null then
    return new;
  end if;

  select count(*) into live_count
  from public.obligation_occurrences oc
  where oc.obligation_type_id = new.id
    and oc.deleted_at is null
    and oc.status <> 'ARCHIVED';

  if live_count > 0 then
    raise exception
      'Suppression refusée : % dossier(s) non archivé(s) référencent cette obligation.',
      live_count
      using errcode = '23514',
            hint = 'Archiver ou clore ces dossiers avant de retirer l''obligation.';
  end if;

  return new;
end;
$$;

comment on function public.prevent_obligation_soft_delete() is
  'Suppression LOGIQUE uniquement, et seulement si plus aucun dossier vivant ne s''y
   rattache. Un dossier archivé n''empêche rien : son historique reste lisible, et
   l''obligation reste jointe pour l''afficher. Aucune suppression physique n''existe.';

create trigger trg_obligation_types_prevent_soft_delete
  before update on public.obligation_types
  for each row execute function public.prevent_obligation_soft_delete();

-- =============================================================================
-- 3. RECALCUL DES ÉCHÉANCES APRÈS MODIFICATION D'UNE RÈGLE
-- =============================================================================

/*
 * ⚠️ SECURITY DEFINER, et il faut dire précisément pourquoi.
 *
 * Modifier une règle relève de `referential.manage`. Écrire dans
 * obligation_occurrences relève de `occurrence.write`. Aucun rôle de la matrice
 * ne détient les deux : la DIRECTION gère le référentiel sans écrire dans les
 * dossiers, les gestionnaires écrivent dans les dossiers sans toucher au
 * référentiel. Le recalcul tomberait donc entre les deux et ne serait jamais
 * possible — alors qu'il n'est pas une écriture métier, mais la propagation
 * mécanique d'une donnée dérivée.
 *
 * Le contournement de RLS est compensé par quatre bornes strictes :
 *   — l'appelant doit détenir `referential.manage` ;
 *   — il doit AUSSI pouvoir lire les occurrences du domaine concerné : la
 *     fonction n'ouvre donc aucune information qu'il n'avait pas déjà ;
 *   — seules les lignes TODO, non verrouillées, non supprimées, et rattachées à
 *     l'obligation passée en argument sont touchées ;
 *   — seules deux colonnes de date changent. Ni statut, ni responsable, ni rien
 *     d'autre.
 *
 * Le trigger d'audit s'applique normalement : chaque ligne déplacée laisse une
 * trace nominative.
 *
 * Les dates sont CALCULÉES PAR L'APPELANT et non ici : le projet ne contient
 * qu'une seule implémentation du calcul d'échéance (src/services/scheduling),
 * et la réécrire en PL/pgSQL en créerait une seconde, condamnée à diverger.
 */
create or replace function public.recalculate_todo_due_dates(
  p_obligation_type_id uuid,
  p_updates jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_domain uuid;
  updated_count int;
begin
  if not public.is_active_user() then
    raise exception 'Recalcul refusé : session inactive.' using errcode = '42501';
  end if;

  if not public.has_permission('referential.manage') then
    raise exception 'Recalcul refusé : referential.manage requis.' using errcode = '42501';
  end if;

  target_domain := public.obligation_domain_of_type(p_obligation_type_id);

  -- Barrière de cloisonnement : on ne déplace pas des dossiers qu'on n'a pas le
  -- droit de voir. Sans elle, un porteur de referential.manage sans accès au
  -- domaine agirait à l'aveugle sur des dossiers qui lui sont invisibles.
  if not public.has_permission_in_domain('occurrence.read', target_domain) then
    raise exception 'Recalcul refusé : lecture des occurrences du domaine requise.'
      using errcode = '42501';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'Recalcul refusé : liste de mises à jour attendue.' using errcode = '22023';
  end if;

  with proposed as (
    select
      (item ->> 'occurrence_id')::uuid as occurrence_id,
      (item ->> 'legal_due_date')::date as legal_due_date,
      (item ->> 'internal_due_date')::date as internal_due_date
    from jsonb_array_elements(p_updates) as item
  ),
  applied as (
    update public.obligation_occurrences oc
       set legal_due_date = p.legal_due_date,
           internal_due_date = p.internal_due_date,
           updated_at = now()
      from proposed p
     where oc.id = p.occurrence_id
       -- ⚠️ Les quatre bornes. TODO seulement : on ne déplace pas le sol sous
       -- les pieds de quelqu'un qui a déjà commencé à travailler.
       and oc.obligation_type_id = p_obligation_type_id
       and oc.status = 'TODO'
       and oc.is_locked = false
       and oc.deleted_at is null
    returning oc.id
  )
  select count(*) into updated_count from applied;

  return updated_count;
end;
$$;

comment on function public.recalculate_todo_due_dates(uuid, jsonb) is
  '⚠️ SECURITY DEFINER borné. Propage une règle d''échéance modifiée aux SEULES
   occurrences TODO, non verrouillées, de l''obligation visée. Exige referential.manage
   ET la lecture des occurrences du domaine : la fonction n''expose donc rien de
   nouveau, elle n''ouvre qu''une écriture dérivée. IN_PROGRESS, PENDING_VALIDATION,
   VALIDATED, SUBMITTED, ARCHIVED et NOT_APPLICABLE ne sont JAMAIS touchés.
   Décision arrêtée.';

revoke execute on function public.recalculate_todo_due_dates(uuid, jsonb) from public, anon;
grant execute on function public.recalculate_todo_due_dates(uuid, jsonb) to authenticated;
