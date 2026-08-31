-- =============================================================================
-- CONFORMIA — 0005 : recherche globale et compteurs de navigation
--
-- Deux besoins de la coquille applicative, tous deux servis PAR LA BASE :
--
--   1. la palette ⌘K, qui cherche dans le référentiel, les occurrences et les
--      pièces ;
--   2. les compteurs affichés dans la barre latérale (en retard, à valider,
--      mes tâches).
--
-- ⚠️ Les deux fonctions publiques de ce fichier sont SECURITY INVOKER — c'est
-- son point essentiel. Elles s'exécutent avec les droits de l'appelant, donc
-- SOUS la RLS : un utilisateur RH ne peut pas trouver une occurrence fiscale par
-- la recherche, ni la voir apparaître dans un compteur. Une seule d'entre elles
-- passée en SECURITY DEFINER anéantirait le cloisonnement établi en 0002.
-- =============================================================================

-- =============================================================================
-- 1. CONFIGURATION DE RECHERCHE PLEIN TEXTE
-- =============================================================================

create extension if not exists unaccent with schema extensions;

/*
 * Configuration `unaccent_simple` : désaccentuation, PAS de racinisation.
 *
 * Le choix se joue contre `french`, qui racinise. « déclaration » y devient le
 * lexème « declar » ; une frappe intermédiaire comme « declarat » ne le retrouve
 * alors plus, puisque « declarat:* » n'est pas un préfixe de « declar ». Dans une
 * palette qui cherche À CHAQUE TOUCHE, ce trou est rédhibitoire : la ligne
 * disparaît en cours de frappe puis réapparaît, ce qui se lit comme un défaut.
 *
 * Le dictionnaire `simple` conserve le mot entier : chaque préfixe frappé est un
 * préfixe du lexème indexé, et le résultat ne clignote jamais. Contrepartie
 * assumée : chercher « déclarations » ne trouve pas « déclaration ». Frapper un
 * pluriel pour retrouver un singulier est rare ; l'inverse est constant.
 *
 * `unaccent` en tête de chaîne : les libellés sont saisis avec accents, les
 * recherches rarement.
 */
create text search configuration public.unaccent_simple (copy = simple);

alter text search configuration public.unaccent_simple
  alter mapping for
    asciiword, asciihword, hword_asciipart,
    word, hword, hword_part,
    numword, numhword, hword_numpart
  with extensions.unaccent, simple;

comment on text search configuration public.unaccent_simple is
  'Désaccentuation sans racinisation. Choisie pour la recherche à la frappe : le préfixe
   d''un mot entier reste le préfixe du lexème indexé, à chaque touche.';

-- -----------------------------------------------------------------------------
-- 1.1 Normalisation des séparateurs
-- -----------------------------------------------------------------------------

create or replace function public.searchable_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(coalesce(p_text, ''), '-_./\', '     ')
$$;

comment on function public.searchable_text(text) is
  'Ramène les séparateurs à des espaces AVANT indexation. Sans cela l''analyseur
   lexical voit « 2026-01 » comme un entier signé et produit le lexème « -01 » : la
   frappe « 2026 01 » ne retrouve alors jamais la période, ce qui est le cas d''usage
   le plus courant de la palette. Même problème pour « rapport_janvier.pdf », gardé
   collé en un seul lexème. La saisie subit la transformation symétrique dans
   search_tsquery() : les deux côtés doivent traiter les séparateurs pareillement.';

-- -----------------------------------------------------------------------------
-- 1.2 Fabrique de tsquery
-- -----------------------------------------------------------------------------

create or replace function public.search_tsquery(p_text text)
returns tsquery
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- ⚠️ to_tsquery() et NON un cast ::tsquery. Le cast n'applique aucun
  -- dictionnaire : « Décl » resterait « Décl », accentué et capitalisé, face à un
  -- index qui ne contient que « decl ». La recherche ne trouverait alors que ce
  -- qui est déjà frappé en minuscules non accentuées.
  select case
    when coalesce(trim(p_text), '') = '' then null::tsquery
    else to_tsquery(
      'public.unaccent_simple',
      -- Tout ce qui n'est pas alphanumérique devient un séparateur : la saisie ne
      -- peut porter aucun opérateur tsquery (& | ! : parenthèses), elle est réduite
      -- à des jetons. quote_literal ferme la porte restante.
      nullif(
        (
          select string_agg(quote_literal(token) || ':*', ' & ')
          from unnest(
            string_to_array(
              -- 120 caractères : au-delà, ce n'est plus une recherche interactive.
              regexp_replace(left(p_text, 120), '[^[:alnum:]]+', ' ', 'g'),
              ' '
            )
          ) as token
          where token <> ''
        ),
        ''
      )
    )
  end
$$;

comment on function public.search_tsquery(text) is
  'Traduit une saisie libre en tsquery de préfixes conjoints, normalisée par la même
   configuration que l''index. Rend NULL sur une saisie vide, ce que les appelants
   traitent comme « aucun résultat » et non comme « tous ».';

-- -----------------------------------------------------------------------------
-- 1.3 Vecteurs de recherche — UNE définition, deux usages
-- -----------------------------------------------------------------------------

/*
 * Une fonction immuable par table, appelée à l'identique par l'index et par la
 * requête. Écrire l'expression deux fois marcherait aussi, jusqu'au jour où
 * l'une des deux copies change : l'index cesserait silencieusement d'être
 * utilisable, sans qu'aucun test ne le remarque — la recherche resterait juste,
 * en séquentiel.
 *
 * ⚠️ Corollaire : MODIFIER LE CORPS D'UNE DE CES FONCTIONS N'ACTUALISE PAS
 * L'INDEX. PostgreSQL fait confiance à la mention `immutable`. Toute évolution
 * doit s'accompagner d'un REINDEX de l'index correspondant, dans la même
 * migration.
 */

create or replace function public.obligation_type_search_vector(
  p_code text, p_name text, p_legal_basis text
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
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_legal_basis)), 'C')
$$;

comment on function public.obligation_type_search_vector(text, text, text) is
  'Vecteur de recherche d''une obligation. Le code pèse plus que le nom : qui frappe
   « G50 » cherche cette obligation-là, pas les libellés qui la mentionnent.';

create or replace function public.occurrence_search_vector(
  p_period_key text, p_reference_number text, p_type_code text, p_type_name text
)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_period_key)), 'A') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_reference_number)), 'B') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_type_code)), 'B') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_type_name)), 'C')
$$;

comment on function public.occurrence_search_vector(text, text, text, text) is
  'Vecteur d''une occurrence. Il inclut le code et le nom de l''obligation parente :
   on cherche « G50 janvier », jamais « 2026-01 » seul. Ces deux champs venant d''une
   AUTRE table, ils ne peuvent pas entrer dans l''index de obligation_occurrences —
   la requête les recompose par jointure, l''index couvrant la part locale.';

create or replace function public.document_search_vector(
  p_original_filename text, p_normalized_filename text
)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_original_filename)), 'A') ||
    setweight(to_tsvector('public.unaccent_simple', public.searchable_text(p_normalized_filename)), 'B')
$$;

comment on function public.document_search_vector(text, text) is
  'Vecteur d''une pièce : les deux formes du nom de fichier, l''originale d''abord.';

-- -----------------------------------------------------------------------------
-- 1.4 Index d'EXPRESSION, sans colonne ajoutée
-- -----------------------------------------------------------------------------

/*
 * Index d'expression plutôt que colonnes tsvector générées. La différence n'est
 * pas cosmétique : une colonne générée entrerait dans to_jsonb(new), donc dans le
 * before/after de CHAQUE ligne d'audit des trois tables. Le journal doublerait de
 * volume pour y conserver un index dérivé, sans aucune valeur probante.
 * L'expression, elle, ne vit que dans l'index.
 *
 * Les prédicats partiels reprennent exactement le filtre des requêtes de
 * recherche : sans « deleted_at is null » dans la requête, le planificateur
 * n'utiliserait pas ces index.
 */

create index obligation_types_search_idx on public.obligation_types
  using gin (public.obligation_type_search_vector(code, name, legal_basis))
  where deleted_at is null;

create index obligation_occurrences_search_idx on public.obligation_occurrences
  using gin (public.occurrence_search_vector(period_key, reference_number, '', ''))
  where deleted_at is null;

create index documents_search_idx on public.documents
  using gin (public.document_search_vector(original_filename, normalized_filename))
  where deleted_at is null;

-- =============================================================================
-- 2. RECHERCHE GLOBALE
-- =============================================================================

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
        public.obligation_type_search_vector(ot.code, ot.name, ot.legal_basis),
        public.search_tsquery(p_query)
      )
    from public.obligation_types ot
    where public.search_tsquery(p_query) is not null
      and ot.deleted_at is null
      and public.obligation_type_search_vector(ot.code, ot.name, ot.legal_basis)
          @@ public.search_tsquery(p_query)
    order by 5 desc, ot.name
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )

  union all

  -- La jointure sur obligation_types traverse la politique de cette table, dont
  -- le cloisonnement par domaine est le même que celui des occurrences : elle ne
  -- peut donc rien élargir.
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
   résultat ne distingue pas « inexistant » de « interdit ». Passer cette fonction en
   SECURITY DEFINER anéantirait le cloisonnement par domaine posé en 0002.';

revoke execute on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;

revoke execute on function public.search_tsquery(text) from public, anon;
grant execute on function public.search_tsquery(text) to authenticated;

-- =============================================================================
-- 3. COMPTEURS DE NAVIGATION
-- =============================================================================

/*
 * Statuts considérés comme CLOS. Le retard ne se calcule que sur le reste.
 * Déclarés une fois ici plutôt que répétés dans trois requêtes : le jour où un
 * statut s'ajoute au cycle de vie, il n'y a qu'un endroit à revoir.
 */
create or replace function public.closed_occurrence_statuses()
returns public.occurrence_status[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['VALIDATED', 'SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE']::public.occurrence_status[]
$$;

comment on function public.closed_occurrence_statuses() is
  'Statuts terminaux : plus rien n''y est attendu de l''équipe. Un dossier VALIDATED
   attend l''administration, pas nous — il ne compte donc pas comme retard.';

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
    -- ⚠️ Échéance comparée à la date d'AUJOURD'HUI À ALGER, pas en UTC. Entre 23 h
    -- et minuit UTC la date algérienne a déjà changé : comparer en UTC afficherait
    -- « en retard » un jour trop tard (cf. CLAUDE.md §2).
    count(*) filter (
      where oc.legal_due_date < (now() at time zone 'Africa/Algiers')::date
        and not (oc.status = any (public.closed_occurrence_statuses()))
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
   laisse voir : un compteur ne peut pas révéler l''existence d''un dossier qu''une
   liste refuserait d''afficher. Un COUNT est une fuite comme une autre — la politique
   obligation_occurrences_select le dit explicitement.';

revoke execute on function public.navigation_counters() from public, anon;
grant execute on function public.navigation_counters() to authenticated;

revoke execute on function public.closed_occurrence_statuses() from public, anon;
grant execute on function public.closed_occurrence_statuses() to authenticated;
