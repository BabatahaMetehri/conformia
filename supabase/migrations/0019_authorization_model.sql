-- =============================================================================
-- 0019 — MODÈLE D'HABILITATIONS DE LA TRIADE, ET CORRECTION DU DÉFAUT D-1
--
-- Deux chantiers dans la même migration, et ce n'est pas un raccourci : le
-- nouveau modèle de rôles impose de réécrire les politiques, et la correction
-- de performance porte EXACTEMENT sur ces mêmes politiques. Les mener
-- séparément aurait signifié réécrire deux fois les 92 politiques du schéma.
--
-- ⚠️ LE DÉFAUT DE PERFORMANCE EST MESURÉ, PAS SUPPOSÉ. Relevé le 2026-09-03 sur
-- 50 000 occurrences dont 10 000 en attente de validation, deux préparateurs,
-- lu par un compte SUPERVISEUR de portée FISCAL :
--
--   file de validation (select *)  14 257 ms   463 633 accès tampon
--   file de validation (count)     11 914 ms   459 992
--   pastille de navigation          4 043 ms   131 542
--   échéancier, première page          9,6 ms         453
--   agrégats du tableau de bord        1,6 ms         119
--   bandeau d'alertes                 11,7 ms       2 954
--
-- La cause tient dans une ligne de plan, reproduite telle quelle :
--
--   Filter: (... is_active_user() AND (has_permission_in_domain('occurrence.read',
--            obligation_domain_of_type(obligation_type_id)) OR ...)
--            AND (ot.domain_id = ANY (domains_with_permission('occurrence.validate'))) ...)
--
-- TOUT cela est un `Filter` de nœud, donc évalué UNE FOIS PAR LIGNE. Trois
-- défauts distincts s'y superposent :
--
--   1. `obligation_domain_of_type(obligation_type_id)` rouvre `obligation_types`
--      pour chaque occurrence, alors que le domaine d'un dossier ne change pas
--      en cours de requête.
--   2. Aucun appel n'est enveloppé dans un sous-select, si bien que même la
--      forme en tableau introduite par 0012 — `domains_with_permission(...)`,
--      pourtant conçue pour n'être évaluée qu'une fois — l'est en réalité une
--      fois par ligne. 0012 a corrigé la FORME sans corriger le NOMBRE
--      D'ÉVALUATIONS.
--   3. Les fonctions sont PARALLEL UNSAFE (le défaut de PostgreSQL), ce qui
--      interdit tout plan parallèle sur un balayage de 50 000 lignes.
--
-- Aucune politique n'est élargie ici. Chaque prédicat est reformulé à
-- ÉQUIVALENCE LOGIQUE, et la suite RLS est le juge de cette équivalence.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — LA MATRICE DES RÔLES, COMME DONNÉE
--
-- La matrice est écrite UNE FOIS, en VALUES, et la base est réconciliée sur
-- elle. Ce n'est pas de la cosmétique : une matrice éparpillée en `insert ...
-- select` successifs au fil des migrations ne se relit pas, et personne ne peut
-- alors répondre à « qui peut valider ? » sans rejouer l'historique.
--
-- La réconciliation est SYMÉTRIQUE : elle accorde ce qui manque et RETIRE ce
-- qui n'est pas dans la matrice. Un octroi oublié par une migration antérieure
-- est donc révoqué ici — seul comportement acceptable pour une table
-- d'habilitations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 Les deux permissions que la matrice introduit
-- -----------------------------------------------------------------------------

insert into public.permissions (code, label, category) values
  ('register.manage', 'Gérer les registres de commerce', 'referential'),
  ('absence.manage',  'Déclarer et révoquer les absences', 'administration')
on conflict (code) do nothing;

comment on table public.permissions is
  'Catalogue des permissions. ⚠️ `register.manage` est DISTINCTE de '
  '`referential.manage` : le référentiel décrit des obligations, les registres '
  'décrivent l''entreprise. Les confondre donnerait à quiconque édite une '
  'obligation le pouvoir de radier un registre, et donc d''éteindre '
  'silencieusement la génération des dossiers qui en dépendent.';

-- -----------------------------------------------------------------------------
-- 1.2 La matrice
--
-- ⚠️ CE BLOC EST LA SOURCE DE VÉRITÉ. Les quatre décisions ci-dessous ne sont
-- pas des oublis, et la vérification de 1.3 échouera si une migration
-- ultérieure les « corrige » :
--
--   • ADMIN ne détient NI occurrence.read NI document.read. L'administration
--     technique et l'accès au contenu métier sont séparés : un compte
--     d'administration compromis n'ouvre aucune déclaration fiscale.
--   • DIRECTION ne détient NI user.manage NI role.manage. Le pouvoir métier ne
--     s'attribue pas ses propres droits.
--   • SUPERVISEUR détient occurrence.write. Il peut donc préparer en cas de
--     nécessité — et la séparation des pouvoirs (section 6) l'empêchera alors
--     de valider CE dossier-là. Le contrôle porte sur l'acte, pas sur le rôle.
--   • RESPONSABLE et SUPPLEANT ont des permissions RIGOUREUSEMENT identiques.
--     Ce qui les distingue est la trace (`acted_as`), pas le droit.
-- -----------------------------------------------------------------------------

create temporary table role_matrix (role_code text, permission_code text);

insert into role_matrix (role_code, permission_code)
select r.role_code, m.permission_code
from (values
  --                       ADMIN  DIR    RESP   SUPP   SUPV   AUDIT  EXT
  ('obligation.read',      true,  true,  true,  true,  true,  true,  true),
  ('referential.manage',   true,  true,  false, false, false, false, false),
  ('register.manage',      true,  true,  false, false, false, false, false),
  ('occurrence.read',      false, true,  true,  true,  true,  true,  true),
  ('occurrence.write',     false, false, true,  true,  true,  false, false),
  ('occurrence.assign',    false, true,  false, false, true,  false, false),
  ('occurrence.submit',    false, false, true,  true,  true,  false, false),
  ('occurrence.validate',  false, true,  false, false, true,  false, false),
  ('occurrence.mark_na',   false, true,  false, false, true,  false, false),
  ('occurrence.unlock',    false, true,  false, false, false, false, false),
  ('document.read',        false, true,  true,  true,  true,  true,  true),
  ('document.upload',      false, false, true,  true,  true,  false, true),
  ('document.delete',      false, true,  false, false, true,  false, false),
  ('absence.manage',       true,  true,  false, false, true,  false, false),
  ('audit.read',           true,  true,  false, false, false, true,  false),
  ('user.manage',          true,  false, false, false, false, false, false),
  ('role.manage',          true,  false, false, false, false, false, false),
  ('settings.manage',      true,  false, false, false, false, false, false),
  ('dashboard.view_all',   false, true,  true,  true,  true,  true,  false),
  ('export.generate',      false, true,  true,  true,  true,  true,  false)
) as m(permission_code, adm, dir, resp, supp, supv, aud, ext)
cross join lateral (values
  ('ADMIN', m.adm), ('DIRECTION', m.dir), ('RESPONSABLE', m.resp),
  ('SUPPLEANT', m.supp), ('SUPERVISEUR', m.supv), ('AUDITOR', m.aud),
  ('EXTERNAL', m.ext)
) as r(role_code, granted)
where r.granted;

/*
 * ⚠️ LA RESTRICTION D'EXTERNAL AU DOMAINE FISCAL N'EST PAS DANS CETTE TABLE,
 * ET C'EST VOULU.
 *
 * `role_permissions` dit QUELLES permissions un rôle porte ;
 * `user_roles.domain_id` dit SUR QUEL PÉRIMÈTRE une personne les exerce. Le
 * « ᶠ » de la matrice est donc une propriété de l'ATTRIBUTION, pas de la
 * permission : il est porté par `roles.default_domain_code = 'FISCAL'`, vérifié
 * en 1.4.
 *
 * L'écrire ici aurait exigé une colonne de domaine sur `role_permissions` —
 * soit deux endroits où lire un périmètre, et la certitude qu'ils divergent.
 */

-- Réconciliation. Le retrait vient d'abord : une permission hors matrice ne
-- doit pas survivre plus longtemps que nécessaire.
delete from public.role_permissions rp
where exists (
        select 1 from public.roles r
        where r.id = rp.role_id
          and r.code in ('ADMIN','DIRECTION','RESPONSABLE','SUPPLEANT',
                         'SUPERVISEUR','AUDITOR','EXTERNAL'))
  and not exists (
        select 1
        from role_matrix m
        join public.roles r on r.code = m.role_code
        join public.permissions p on p.code = m.permission_code
        where r.id = rp.role_id and p.id = rp.permission_id);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_matrix m
join public.roles r on r.code = m.role_code
join public.permissions p on p.code = m.permission_code
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 1.3 La matrice appliquée EST la matrice déclarée
--
-- ⚠️ Cette vérification échoue la migration. C'est le but : une matrice
-- d'habilitations qui ne correspond pas à ce qu'on croit avoir écrit est un
-- incident de sécurité, pas un écart à consigner.
-- -----------------------------------------------------------------------------

do $$
declare
  v_excedent text;
  v_manquant text;
begin
  select string_agg(r.code || '/' || p.code, ', ' order by r.code, p.code)
    into v_excedent
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
  join public.permissions p on p.id = rp.permission_id
  where r.code in ('ADMIN','DIRECTION','RESPONSABLE','SUPPLEANT',
                   'SUPERVISEUR','AUDITOR','EXTERNAL')
    and not exists (select 1 from role_matrix m
                    where m.role_code = r.code and m.permission_code = p.code);

  select string_agg(m.role_code || '/' || m.permission_code, ', '
                    order by m.role_code, m.permission_code)
    into v_manquant
  from role_matrix m
  where not exists (
    select 1 from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    join public.permissions p on p.id = rp.permission_id
    where r.code = m.role_code and p.code = m.permission_code);

  if v_excedent is not null then
    raise exception 'Habilitations EN TROP par rapport à la matrice : %', v_excedent;
  end if;
  if v_manquant is not null then
    raise exception 'Habilitations MANQUANTES par rapport à la matrice : %', v_manquant;
  end if;
end $$;

drop table role_matrix;

-- -----------------------------------------------------------------------------
-- 1.4 Portée des rôles
--
-- RESPONSABLE, SUPPLEANT, SUPERVISEUR et DIRECTION sont de portée GLOBALE :
-- une seule personne suit l'ensemble des dossiers, tous domaines et tous
-- registres. Le mécanisme existe déjà, et il est par attribution
-- (`user_roles.domain_id is null` = global) ; ce qui manquait était de garantir
-- qu'une attribution faite SANS domaine reste globale pour ces quatre rôles,
-- autrement dit qu'aucun domaine par défaut ne vienne la restreindre.
--
-- ⚠️ ON NE REFUSE PAS une attribution restreinte à un domaine pour ces rôles.
-- La restriction par domaine reste un outil légitime — c'est celui par lequel
-- la suite RLS DÉMONTRE le cloisonnement — et l'interdire aurait supprimé le
-- moyen de le démontrer, donc affaibli la garantie même qu'on cherche à tenir.
-- -----------------------------------------------------------------------------

do $$
declare v_faute text;
begin
  select string_agg(code || ' → ' || default_domain_code, ', ' order by code)
    into v_faute
  from public.roles
  where code in ('RESPONSABLE','SUPPLEANT','SUPERVISEUR','DIRECTION')
    and default_domain_code is not null;

  if v_faute is not null then
    raise exception
      'Rôles de portée globale porteurs d''un domaine par défaut : %', v_faute;
  end if;
end $$;

comment on column public.roles.default_domain_code is
  'Domaine proposé par défaut lors d''une attribution. NULL = portée globale. '
  '⚠️ RESPONSABLE, SUPPLEANT, SUPERVISEUR et DIRECTION sont GLOBAUX : une seule '
  'personne suit l''ensemble des dossiers. EXTERNAL porte FISCAL — c''est le '
  '« ᶠ » de la matrice, et le seul endroit où il est écrit.';


-- =============================================================================
-- SECTION 2 — LE DOMAINE, DÉNORMALISÉ SUR L'OCCURRENCE
--
-- C'est la première des trois causes racines. La politique remontait le domaine
-- par `obligation_domain_of_type(obligation_type_id)`, c'est-à-dire une lecture
-- de `obligation_types` PAR LIGNE d'occurrence.
--
-- ⚠️ UNE DÉNORMALISATION N'EST ACCEPTABLE QUE SI ELLE NE PEUT PAS DÉRIVER. La
-- colonne n'est donc jamais une donnée d'entrée : elle est POSÉE par trigger à
-- l'insertion, RÉALIGNÉE si l'obligation change, et PROPAGÉE si le domaine de
-- l'obligation change. Aucun appelant ne peut l'écrire — pas même un job.
-- Un test d'intégration vérifie l'égalité en permanence.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.0 Préalable : une obligation a TOUJOURS un domaine
--
-- ⚠️ CE N'EST PAS UN DÉTOUR. Une colonne `NOT NULL` sur l'occurrence est
-- impossible tant que le parent peut être NULL. Et le domaine NULL était par
-- ailleurs une PORTE DE SORTIE du cloisonnement : les politiques portaient
-- toutes un terme `domain_id is null or ...`, si bien qu'une obligation sans
-- domaine était visible de quiconque détient `obligation.read`, tous domaines
-- confondus. Poser la contrainte referme cette porte — elle ne l'ouvre pas.
-- -----------------------------------------------------------------------------

alter table public.obligation_types alter column domain_id set not null;

comment on column public.obligation_types.domain_id is
  'Domaine de l''obligation. ⚠️ OBLIGATOIRE depuis 0019 : le domaine porte le '
  'cloisonnement, et une obligation sans domaine échappait à tout cloisonnement '
  'au lieu de n''être visible de personne.';

-- -----------------------------------------------------------------------------
-- 2.1 La colonne
-- -----------------------------------------------------------------------------

alter table public.obligation_occurrences
  add column if not exists domain_id uuid references public.domains(id);

-- 2.2 Rattrapage des lignes existantes.
update public.obligation_occurrences oc
   set domain_id = ot.domain_id
  from public.obligation_types ot
 where ot.id = oc.obligation_type_id
   and oc.domain_id is distinct from ot.domain_id;

alter table public.obligation_occurrences alter column domain_id set not null;

comment on column public.obligation_occurrences.domain_id is
  'Domaine du dossier, RECOPIÉ de l''obligation. ⚠️ CACHE, PAS DONNÉE : posé et '
  'réaligné par trigger, toute valeur fournie par l''appelant est écrasée. Existe '
  'pour que la politique RLS cesse de rouvrir `obligation_types` une fois par '
  'ligne — 14 257 ms mesurées sur 50 000 dossiers avant, la mesure après est '
  'consignée dans docs/query-plans.md.';

-- -----------------------------------------------------------------------------
-- 2.3 Pose et réalignement
-- -----------------------------------------------------------------------------

create or replace function public.set_occurrence_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain uuid;
begin
  select ot.domain_id into v_domain
  from public.obligation_types ot
  where ot.id = new.obligation_type_id;

  if v_domain is null then
    -- L'obligation n'existe pas : la clé étrangère le dira mieux que nous, mais
    -- elle le dirait APRÈS, sur une colonne NOT NULL déjà violée. Le message
    -- explicite vaut mieux qu'une violation de contrainte à déchiffrer.
    raise exception 'Obligation % introuvable : impossible de déterminer le domaine du dossier.',
      new.obligation_type_id
      using errcode = '23503';
  end if;

  new.domain_id := v_domain;
  return new;
end;
$$;

comment on function public.set_occurrence_domain() is
  'Pose `domain_id` depuis l''obligation parente. ⚠️ ÉCRASE toute valeur fournie '
  'par l''appelant : la colonne est un cache, et un cache qu''un appelant peut '
  'contredire est un cloisonnement qu''un appelant peut contourner.';

/*
 * ⚠️ NUMÉROTÉ 05 : IL DOIT PASSER AVANT TOUS LES AUTRES.
 *
 * PostgreSQL exécute les triggers de même moment dans l'ordre alphabétique de
 * leur nom, et la convention de ce schéma est `trg_occurrences_<NN>_<objet>`.
 * `trg_occurrences_10_enforce_lock` et les suivants supposent la ligne complète.
 *
 * ⚠️ ET IL PASSE AVANT LA POLITIQUE `with check`. PostgreSQL évalue les triggers
 * BEFORE ROW, puis les politiques RLS, puis les contraintes. La politique
 * d'insertion peut donc s'appuyer sur `domain_id` : il est déjà posé quand elle
 * s'évalue. C'est un point PORTANT — sans lui, la politique d'insertion
 * testerait une colonne encore nulle et refuserait tout.
 */
drop trigger if exists trg_occurrences_05_set_domain on public.obligation_occurrences;
create trigger trg_occurrences_05_set_domain
  before insert or update of obligation_type_id on public.obligation_occurrences
  for each row execute function public.set_occurrence_domain();

-- -----------------------------------------------------------------------------
-- 2.4 Propagation depuis l'obligation
-- -----------------------------------------------------------------------------

create or replace function public.propagate_domain_to_occurrences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * ⚠️ LES DOSSIERS ARCHIVÉS NE SONT PAS TOUCHÉS, ET C'EST UNE RÈGLE MÉTIER,
   * PAS UNE COMMODITÉ.
   *
   * Un dossier archivé a été traité, validé et déposé SOUS LE DOMAINE DE
   * L'ÉPOQUE. Réétiqueter l'histoire parce que l'organisation a changé
   * falsifierait la trace : le journal d'audit dirait « fiscal » là où le
   * dossier a été suivi par le service social.
   *
   * Conséquence assumée, et vérifiée telle quelle par le test d'intégration :
   * l'invariant « domaine du dossier = domaine de l'obligation » porte sur les
   * dossiers NON ARCHIVÉS.
   *
   * Effet de bord heureux : `is_locked` n'est posé que par la transition
   * SUBMITTED → ARCHIVED, si bien qu'exclure les archivés exclut exactement les
   * verrouillés — la propagation ne se heurte jamais au trigger de verrou.
   */
  update public.obligation_occurrences
     set domain_id = new.domain_id
   where obligation_type_id = new.id
     and status <> 'ARCHIVED'
     and domain_id is distinct from new.domain_id;

  return null;
end;
$$;

comment on function public.propagate_domain_to_occurrences() is
  'Réaligne le domaine des dossiers NON ARCHIVÉS quand celui de l''obligation '
  'change. Les archivés gardent le domaine sous lequel ils ont été traités.';

drop trigger if exists trg_obligation_types_60_propagate_domain on public.obligation_types;
create trigger trg_obligation_types_60_propagate_domain
  after update of domain_id on public.obligation_types
  for each row
  when (old.domain_id is distinct from new.domain_id)
  execute function public.propagate_domain_to_occurrences();


-- =============================================================================
-- SECTION 3 — LES FONCTIONS D'AUTORISATION : UNE SEULE ÉVALUATION
--
-- Deuxième cause racine. Une fonction `STABLE` n'est PAS mémoïsée par
-- PostgreSQL : seule une IMMUTABLE est repliée en constante. Placée dans un
-- `Filter`, une fonction STABLE est appelée une fois par ligne examinée.
--
-- ⚠️ LES PARENTHÈSES AUTOUR DU SELECT SONT L'ÉLÉMENT DÉTERMINANT, et rien
-- d'autre. `(select f())` est un sous-select non corrélé : le planificateur en
-- fait un InitPlan, évalué UNE FOIS par requête et réutilisé pour toutes les
-- lignes. `f()` sans parenthèses, à forme identique, est évalué 50 000 fois.
-- C'est la totalité de la différence entre 14 secondes et quelques
-- millisecondes.
--
-- Corollaire, et c'est ce qui a été manqué en 0012 : rendre un TABLEAU ne suffit
-- pas. `x = any (f())` évalue `f()` par ligne tout autant. Il faut
-- `x = any ((select f()))`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 Les domaines où l'appelant détient une permission, en tableau
-- -----------------------------------------------------------------------------

create or replace function public.accessible_domains_array(p_permission text)
returns uuid[]
language sql
stable
parallel safe
security definer
set search_path = ''
as $$
  select case
    -- Un compte désactivé ne lit rien : tableau vide, donc aucun domaine ne
    -- correspond, donc refus. La désactivation prime sur l'habilitation.
    when not public.is_active_user() then array[]::uuid[]

    -- Portée globale : une attribution sans domaine porte la permission
    -- partout. On rend alors TOUS les domaines, y compris ceux créés après
    -- l'attribution — c'est le sens de « global ».
    when exists (
      select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id
      where ur.user_id in (select public.effective_principals())
        and p.code = p_permission
        and ur.domain_id is null
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > pg_catalog.now())
    )
    then (select coalesce(pg_catalog.array_agg(d.id), array[]::uuid[])
            from public.domains d)

    else (
      select coalesce(pg_catalog.array_agg(distinct ur.domain_id), array[]::uuid[])
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id
      where ur.user_id in (select public.effective_principals())
        and p.code = p_permission
        and ur.domain_id is not null
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > pg_catalog.now())
    )
  end;
$$;

comment on function public.accessible_domains_array(text) is
  'Domaines où l''appelant détient la permission demandée, en TABLEAU. '
  '⚠️ ÉQUIVAUT À `has_permission_in_domain(perm, X)` pour tout X non nul : même '
  'traitement des délégations (par `effective_principals`), des attributions '
  'révoquées ou expirées, et de la portée globale. La forme en tableau existe '
  'pour être enveloppée — `X = any ((select accessible_domains_array(p))::uuid[])` '
  '— ce qui produit un InitPlan évalué une seule fois par requête au lieu d''un '
  'appel par ligne. ⚠️ LE TRANSTYPAGE `::uuid[]` EST OBLIGATOIRE : sans lui, '
  'PostgreSQL lit `any (sous-requête)` — la forme ensembliste — et compare un '
  'uuid à un uuid[], ce qui échoue à la création de la politique.';

grant execute on function public.accessible_domains_array(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3.2 PARALLEL SAFE sur toutes les fonctions d'autorisation
--
-- ⚠️ Troisième cause racine, et la plus discrète. `PARALLEL UNSAFE` est le
-- défaut de PostgreSQL, et il suffit d'UNE fonction unsafe dans un prédicat
-- pour interdire tout plan parallèle sur la requête entière — sur un balayage
-- de 50 000 lignes, c'est un facteur perdu d'emblée.
--
-- Ces fonctions ne font que LIRE, et n'écrivent ni table ni séquence ni fichier
-- ni paramètre de session : elles satisfont la définition de PARALLEL SAFE. Le
-- défaut n'était pas un choix, c'était une omission.
-- -----------------------------------------------------------------------------

alter function public.current_profile_id() parallel safe;
alter function public.is_active_user() parallel safe;
alter function public.effective_principals() parallel safe;
alter function public.has_permission(text) parallel safe;
alter function public.has_permission_in_domain(text, uuid) parallel safe;
alter function public.accessible_domains() parallel safe;
alter function public.is_admin() parallel safe;
alter function public.is_direction(uuid) parallel safe;
alter function public.obligation_domain_of_type(uuid) parallel safe;
alter function public.obligation_domain_of_occurrence(uuid) parallel safe;
alter function public.domains_with_permission(text) parallel safe;
alter function public.can_see_occurrence(uuid) parallel safe;
alter function public.can_validate_occurrence(uuid) parallel safe;
alter function public.setting_bool(text, boolean) parallel safe;
alter function public.is_absent_on(uuid, date) parallel safe;

-- -----------------------------------------------------------------------------
-- 3.3 Les fonctions de domaine lisent désormais la colonne dénormalisée
-- -----------------------------------------------------------------------------

create or replace function public.obligation_domain_of_occurrence(occurrence_id uuid)
returns uuid
language sql
stable
parallel safe
security definer
set search_path = ''
as $$
  -- ⚠️ Ne joint plus `obligation_types` : le domaine est porté par le dossier
  -- lui-même depuis 0019. Une lecture d'index sur la clé primaire remplace une
  -- jointure sur deux tables.
  select oc.domain_id
  from public.obligation_occurrences oc
  where oc.id = occurrence_id;
$$;

comment on function public.obligation_domain_of_occurrence(uuid) is
  'Domaine d''un dossier, lu sur le dossier. ⚠️ Le trigger '
  '`set_occurrence_domain` garantit l''égalité avec l''obligation parente : cette '
  'fonction ne peut donc pas répondre autre chose que la jointure d''avant.';

-- -----------------------------------------------------------------------------
-- 3.4 `can_see_occurrence` — copie fidèle de la politique, tenue à jour
--
-- ⚠️ Cette fonction EST une seconde écriture du `using` de
-- `obligation_occurrences_select`. C'était déjà le cas, assumé et documenté en
-- 0008 ; elle doit donc bouger EN MÊME TEMPS que la politique. Un test
-- d'intégration compare leurs résultats ligne à ligne.
-- -----------------------------------------------------------------------------

create or replace function public.can_see_occurrence(p_occurrence_id uuid)
returns boolean
language sql
stable
parallel safe
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
        oc.domain_id = any (public.accessible_domains_array('occurrence.read'))
        or oc.owner_id = public.current_profile_id()
        or oc.deputy_id = public.current_profile_id()
        or oc.validator_id = public.current_profile_id()
      )
  );
$$;

comment on function public.can_see_occurrence(uuid) is
  'Copie fidèle du `using` de obligation_occurrences_select, à l''usage des '
  'fonctions SECURITY DEFINER qui ne traversent pas la RLS. ⚠️ Ici les appels ne '
  'sont PAS enveloppés dans un sous-select, et c''est correct : la fonction '
  'travaille sur UNE ligne, il n''y a pas de répétition à éviter.';

-- -----------------------------------------------------------------------------
-- 3.5 `can_validate_occurrence` — même traitement du domaine
-- -----------------------------------------------------------------------------

create or replace function public.can_validate_occurrence(occurrence_id uuid)
returns boolean
language plpgsql
stable
parallel safe
security definer
set search_path = ''
as $$
declare
  occ public.obligation_occurrences%rowtype;
begin
  select * into occ from public.obligation_occurrences where id = occurrence_id;
  if not found then
    return false;
  end if;

  -- Chaîne nominale : la permission de valider dans le domaine du dossier.
  -- Le domaine est lu SUR le dossier, plus par jointure.
  if public.has_permission_in_domain('occurrence.validate', occ.domain_id) then
    return true;
  end if;

  -- Filet DIRECTION : au-delà du délai, la direction peut débloquer un dossier
  -- resté en attente. Il dépend de l'ancienneté de CE dossier, il reste donc
  -- par dossier.
  if occ.status = 'PENDING_VALIDATION' and occ.submitted_for_validation_at is not null then
    -- `current_date` est un mot-clé SQL, pas une fonction : il ne dépend pas du
    -- chemin de recherche et n'a donc pas à être qualifié.
    if current_date > public.add_business_days(
         occ.submitted_for_validation_at::date,
         public.setting_int('validation_fallback_days', 5))
       and public.is_direction(auth.uid())
       and public.is_active_user()
    then
      return true;
    end if;
  end if;

  return false;
end;
$$;

comment on function public.can_validate_occurrence(uuid) is
  'Vrai si l''appelant peut valider ce dossier : permission dans son domaine, ou '
  'filet DIRECTION passé le délai. ⚠️ Ne dit RIEN de la séparation des pouvoirs — '
  'c''est `self_validation_blocked` qui la porte, et les deux se composent.';


-- =============================================================================
-- SECTION 4 — LES INDEX
--
-- Une fois le domaine porté par la ligne et la permission évaluée une seule
-- fois, la politique se réduit à une comparaison d'égalité sur `domain_id` et à
-- une disjonction sur trois colonnes d'identité. Reste à ce que le
-- planificateur puisse les atteindre par index plutôt que par balayage.
-- =============================================================================

-- Écran de liste : le dossier d'une entité, dans un domaine, par statut, trié
-- par échéance interne. C'est la forme exacte de l'échéancier.
create index if not exists obligation_occurrences_entity_domain_status_idx
  on public.obligation_occurrences (entity_id, domain_id, status, internal_due_date)
  where deleted_at is null;

-- Même écran, vu par registre.
create index if not exists obligation_occurrences_entity_register_status_idx
  on public.obligation_occurrences (entity_id, commercial_register_id, status)
  where deleted_at is null;

/*
 * ⚠️ LA DISJONCTION D'IDENTITÉ EXIGE UN INDEX PAR TERME, sans quoi le
 * planificateur ne peut pas former de `BitmapOr` et retombe sur un balayage
 * complet dès que le domaine ne suffit pas.
 *
 * Deux des trois termes SONT DÉJÀ SERVIS par des index composites dont la
 * colonne de tête est celle qu'on cherche — un tel index répond à une égalité
 * sur sa colonne de tête, et en créer un plus étroit par-dessus serait du poids
 * mort en écriture pour aucun gain en lecture :
 *
 *   • `owner_id`     → ..._owner_internal_due_idx et ..._owner_status_idx
 *   • `validator_id` → ..._validator_idx (validator_id, status)
 *                       where deleted_at is null and validator_id is not null ;
 *                       le prédicat partiel est plus étroit, et
 *                       `validator_id = X` l'implique, donc l'index reste
 *                       utilisable
 *
 * Seul `deputy_id`, introduit par 0018, n'était servi par rien.
 *
 * ⚠️ VÉRIFIÉ, PAS SUPPOSÉ. Sur une valeur sélective, le plan donne bien :
 *
 *   BitmapOr
 *     -> Bitmap Index Scan on obligation_occurrences_owner_internal_due_idx
 *     -> Bitmap Index Scan on obligation_occurrences_deputy_idx
 *     -> Bitmap Index Scan on obligation_occurrences_validator_idx
 *
 * Sur une valeur peu sélective — un compte qui possède la moitié des dossiers —
 * le planificateur retient un balayage séquentiel, et il a raison de le faire :
 * l'index n'est pas absent, il n'est simplement pas rentable à cette
 * sélectivité.
 */
create index if not exists obligation_occurrences_deputy_idx
  on public.obligation_occurrences (deputy_id)
  where deleted_at is null and deputy_id is not null;

/*
 * La séparation des pouvoirs interroge désormais « cette personne a-t-elle
 * préparé ce dossier ? » (section 6). Posée sans index, la question rouvrirait
 * `occurrence_transitions` pour chaque dossier de la file.
 *
 * L'ordre des colonnes n'est pas indifférent : `actor_id` en tête permet de
 * ramener EN UN PARCOURS l'ensemble — petit — des dossiers que l'appelant a
 * préparés, que le planificateur peut alors anti-joindre à la file. Mettre
 * `occurrence_id` en tête aurait imposé une recherche par dossier.
 */
create index if not exists occurrence_transitions_actor_role_idx
  on public.occurrence_transitions (actor_id, acted_as, occurrence_id)
  where acted_as is not null;

/*
 * ⚠️ SUPPRESSION MOTIVÉE PAR `pg_stat_user_indexes`, PAS PAR L'INTUITION.
 *
 * `obligation_occurrences_entity_status_due_idx` (entity_id, status,
 * legal_due_date) where deleted_at is null : 0 balayage depuis la dernière
 * réinitialisation, 792 kB. Le nouvel index
 * `..._entity_domain_status_idx` a la même colonne de tête et couvre les mêmes
 * accès par entité en y ajoutant le domaine, que toute politique de liste
 * teste désormais. Le conserver, c'est payer une écriture de plus par dossier
 * créé pour un index que personne ne lit.
 *
 * Les autres index à 0 balayage sont CONSERVÉS, et c'est délibéré :
 * `..._rectification_idx` et `..._search_idx` servent des écrans (rectificatives,
 * recherche plein texte) que le relevé n'a pas exercés. Un index inutilisé
 * parce que la fonctionnalité n'a pas été sollicitée n'est pas un index inutile.
 */
drop index if exists public.obligation_occurrences_entity_status_due_idx;


-- =============================================================================
-- SECTION 5 — RÉÉCRITURE DE TOUTES LES POLITIQUES
--
-- 89 des 92 politiques du schéma portaient au moins un appel de fonction non
-- enveloppé. Le motif est TRANSVERSE : ce n'est pas la file de validation qui
-- est lente, c'est toute requête portant sur assez de lignes.
--
-- ⚠️ CHAQUE POLITIQUE EST RÉÉCRITE À ÉQUIVALENCE LOGIQUE. Deux transformations
-- seulement, appliquées mécaniquement :
--
--   (a) `f(constantes)`                 → `(select f(constantes))`
--   (b) `has_permission_in_domain(p, X)`
--         → `X = any ((select accessible_domains_array(p))::uuid[])`
--
-- ⚠️ LE TRANSTYPAGE `::uuid[]` N'EST PAS DÉCORATIF. `any` a deux formes, et
-- PostgreSQL choisit d'après la SYNTAXE : `any (sous-select)` est la forme
-- ensembliste, qui compare la colonne aux LIGNES du sous-select — soit ici un
-- uuid à un uuid[], et l'erreur « operator does not exist: uuid = uuid[] » à la
-- création de la politique. Le transtypage fait du sous-select une expression,
-- donc la forme TABLEAU, tout en le laissant non corrélé : le plan porte bien
-- un `InitPlan` et le filtre lit `(InitPlan 1).col1`.
--
-- La seconde n'est une équivalence que parce que `X` ne peut plus être NULL
-- (section 2.0) : `NULL = any (...)` est NULL, donc faux, là où
-- `has_permission_in_domain(p, NULL)` répondait vrai pour une attribution de
-- portée globale. C'est cette contrainte NOT NULL qui rend la réécriture sûre,
-- et c'est pour cela qu'elle la précède.
--
-- Trois politiques changent en plus de SENS, chacune pour une raison écrite sur
-- place : les occurrences (le suppléant), les registres et les absences (les
-- permissions dédiées de la matrice).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 Référentiel technique — lecture pour tout compte actif, écriture au
--     référentiel. Aucun changement de sens : enveloppement seul.
-- -----------------------------------------------------------------------------

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using ((select public.is_active_user()));

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

drop policy if exists authorities_select on public.authorities;
create policy authorities_select on public.authorities
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists authorities_insert on public.authorities;
create policy authorities_insert on public.authorities
  for insert to authenticated
  with check ((select public.has_permission('referential.manage')));

drop policy if exists authorities_update on public.authorities;
create policy authorities_update on public.authorities
  for update to authenticated
  using ((select public.has_permission('referential.manage')))
  with check ((select public.has_permission('referential.manage')));

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments
  for insert to authenticated
  with check ((select public.has_permission('referential.manage')));

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  for update to authenticated
  using ((select public.has_permission('referential.manage')))
  with check ((select public.has_permission('referential.manage')));

drop policy if exists domains_select on public.domains;
create policy domains_select on public.domains
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists domains_insert on public.domains;
create policy domains_insert on public.domains
  for insert to authenticated
  with check ((select public.has_permission('referential.manage')));

drop policy if exists domains_update on public.domains;
create policy domains_update on public.domains
  for update to authenticated
  using ((select public.has_permission('referential.manage')))
  with check ((select public.has_permission('referential.manage')));

drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists holidays_insert on public.holidays;
create policy holidays_insert on public.holidays
  for insert to authenticated
  with check ((select public.has_permission('referential.manage')));

drop policy if exists holidays_update on public.holidays;
create policy holidays_update on public.holidays
  for update to authenticated
  using ((select public.has_permission('referential.manage')))
  with check ((select public.has_permission('referential.manage')));

drop policy if exists entities_select on public.entities;
create policy entities_select on public.entities
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists entities_insert on public.entities;
create policy entities_insert on public.entities
  for insert to authenticated
  with check ((select public.has_permission('settings.manage')));

drop policy if exists entities_update on public.entities;
create policy entities_update on public.entities
  for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

drop policy if exists escalation_policies_select on public.escalation_policies;
create policy escalation_policies_select on public.escalation_policies
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists escalation_policies_insert on public.escalation_policies;
create policy escalation_policies_insert on public.escalation_policies
  for insert to authenticated
  with check ((select public.has_permission('settings.manage')));

drop policy if exists escalation_policies_update on public.escalation_policies;
create policy escalation_policies_update on public.escalation_policies
  for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

drop policy if exists escalation_policies_delete on public.escalation_policies;
create policy escalation_policies_delete on public.escalation_policies
  for delete to authenticated
  using ((select public.has_permission('settings.manage')));

drop policy if exists notification_rules_select on public.notification_rules;
create policy notification_rules_select on public.notification_rules
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists notification_rules_insert on public.notification_rules;
create policy notification_rules_insert on public.notification_rules
  for insert to authenticated
  with check ((select public.has_permission('settings.manage')));

drop policy if exists notification_rules_update on public.notification_rules;
create policy notification_rules_update on public.notification_rules
  for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

drop policy if exists notification_rules_delete on public.notification_rules;
create policy notification_rules_delete on public.notification_rules
  for delete to authenticated
  using ((select public.has_permission('settings.manage')));

drop policy if exists status_transition_rules_select on public.status_transition_rules;
create policy status_transition_rules_select on public.status_transition_rules
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists status_transition_rules_insert on public.status_transition_rules;
create policy status_transition_rules_insert on public.status_transition_rules
  for insert to authenticated
  with check ((select public.has_permission('settings.manage')));

drop policy if exists status_transition_rules_update on public.status_transition_rules;
create policy status_transition_rules_update on public.status_transition_rules
  for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

drop policy if exists transition_notifications_select on public.transition_notifications;
create policy transition_notifications_select on public.transition_notifications
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check ((select public.has_permission('role.manage')));

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using ((select public.has_permission('role.manage')) and not is_system)
  with check ((select public.has_permission('role.manage')) and not is_system);

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check ((select public.is_active_user()) and (select public.has_permission('role.manage')));

drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('role.manage')));

-- -----------------------------------------------------------------------------
-- 5.2 Journaux et exploitation
-- -----------------------------------------------------------------------------

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('audit.read')));

drop policy if exists audit_redacted_columns_select on public.audit_redacted_columns;
create policy audit_redacted_columns_select on public.audit_redacted_columns
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('audit.read')));

drop policy if exists auth_attempts_select on public.auth_attempts;
create policy auth_attempts_select on public.auth_attempts
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('audit.read')));

drop policy if exists backup_runs_select on public.backup_runs;
create policy backup_runs_select on public.backup_runs
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('settings.manage')));

drop policy if exists job_runs_select on public.job_runs;
create policy job_runs_select on public.job_runs
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('settings.manage')));

drop policy if exists restore_tests_select on public.restore_tests;
create policy restore_tests_select on public.restore_tests
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('settings.manage')));

drop policy if exists export_runs_select on public.export_runs;
create policy export_runs_select on public.export_runs
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      requested_by = (select public.current_profile_id())
      or (select public.has_permission('audit.read'))
    )
  );

drop policy if exists calendar_feed_tokens_select on public.calendar_feed_tokens;
create policy calendar_feed_tokens_select on public.calendar_feed_tokens
  for select to authenticated
  using ((select public.is_active_user()) and user_id = (select public.current_profile_id()));

-- -----------------------------------------------------------------------------
-- 5.3 Référentiel des obligations
--
-- ⚠️ CHANGEMENT DE FONCTION D'HABILITATION, ET IL RESSERRE.
-- L'ancienne forme testait `domain_id in (select accessible_domains())`, soit
-- « les domaines où l'appelant porte UN RÔLE, quel qu'il soit ». La nouvelle
-- teste les domaines où il porte PRÉCISÉMENT `obligation.read`. Un compte
-- portant dans un domaine un rôle qui n'accorde pas la lecture du référentiel y
-- voyait le référentiel ; il ne le voit plus. Aucun élargissement.
--
-- Le terme `domain_id is null or ...` disparaît : la colonne est NOT NULL
-- depuis 2.0.
-- -----------------------------------------------------------------------------

drop policy if exists obligation_types_select on public.obligation_types;
create policy obligation_types_select on public.obligation_types
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      (select public.is_admin())
      or (
        (select public.has_permission('obligation.read'))
        and domain_id = any ((select public.accessible_domains_array('obligation.read'))::uuid[])
      )
    )
  );
comment on policy obligation_types_select on public.obligation_types is
  'Le référentiel est cloisonné par domaine, comme les occurrences. ADMIN y accède au '
  'titre de referential.manage — et n''y trouve aucune donnée de dossier.';

drop policy if exists obligation_types_insert on public.obligation_types;
create policy obligation_types_insert on public.obligation_types
  for insert to authenticated
  with check ((select public.has_permission('referential.manage')));

drop policy if exists obligation_types_update on public.obligation_types;
create policy obligation_types_update on public.obligation_types
  for update to authenticated
  using ((select public.has_permission('referential.manage')))
  with check ((select public.has_permission('referential.manage')));

drop policy if exists obligation_required_documents_select on public.obligation_required_documents;
create policy obligation_required_documents_select on public.obligation_required_documents
  for select to authenticated
  using (
    (select public.is_active_user())
    and exists (
      select 1 from public.obligation_types ot
      where ot.id = obligation_required_documents.obligation_type_id
        and (
          (select public.is_admin())
          or (
            (select public.has_permission('obligation.read'))
            and ot.domain_id = any ((select public.accessible_domains_array('obligation.read'))::uuid[])
          )
        )
    )
  );
comment on policy obligation_required_documents_select on public.obligation_required_documents is
  'Visible avec l''obligation qu''elle décrit : même cloisonnement de domaine.';

drop policy if exists obligation_required_documents_insert on public.obligation_required_documents;
create policy obligation_required_documents_insert on public.obligation_required_documents
  for insert to authenticated
  with check ((select public.has_permission('referential.manage')));

drop policy if exists obligation_required_documents_update on public.obligation_required_documents;
create policy obligation_required_documents_update on public.obligation_required_documents
  for update to authenticated
  using ((select public.has_permission('referential.manage')))
  with check ((select public.has_permission('referential.manage')));

drop policy if exists obligation_required_documents_delete on public.obligation_required_documents;
create policy obligation_required_documents_delete on public.obligation_required_documents
  for delete to authenticated
  using ((select public.has_permission('referential.manage')));

-- -----------------------------------------------------------------------------
-- 5.4 Occurrences — LA POLITIQUE QUI COÛTAIT 14 SECONDES
--
-- Forme d'arrivée, et chaque parenthèse y est portante :
--
--   domain_id = any ((select accessible_domains_array('occurrence.read'))::uuid[])
--   or owner_id     = (select current_profile_id())
--   or deputy_id    = (select current_profile_id())
--   or validator_id = (select current_profile_id())
--
-- ⚠️ `deputy_id` EST UN AJOUT, et il élargit — délibérément. Le suppléant est
-- par construction la personne qui reprend le dossier quand le responsable
-- n'est pas là ; un dossier qu'il ne VOIT pas est un dossier qu'il ne peut pas
-- reprendre. Le terme est le pendant exact des deux qui existaient déjà pour le
-- responsable et le validateur, et il ne donne accès qu'aux dossiers où la
-- personne est NOMMÉMENT désignée — pas à un domaine.
--
-- ⚠️ Ce que cette politique ne fait toujours pas : ADMIN n'y figure pas, il ne
-- détient pas occurrence.read, et le cloisonnement entre domaines reste
-- complet — ni liste, ni compteur, ni recherche.
-- -----------------------------------------------------------------------------

drop policy if exists obligation_occurrences_select on public.obligation_occurrences;
create policy obligation_occurrences_select on public.obligation_occurrences
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      domain_id = any ((select public.accessible_domains_array('occurrence.read'))::uuid[])
      or owner_id = (select public.current_profile_id())
      or deputy_id = (select public.current_profile_id())
      or validator_id = (select public.current_profile_id())
    )
  );
comment on policy obligation_occurrences_select on public.obligation_occurrences is
  '⚠️ CLOISONNEMENT COMPLET ENTRE DOMAINES. Un utilisateur cantonné au social ne voit '
  'PAS l''existence des dossiers fiscaux : ni en liste, ni en compteur, ni en recherche. '
  'Le filtre étant porté par la RLS, un COUNT(*) ne peut pas davantage révéler leur '
  'nombre qu''un SELECT ne peut révéler leur contenu. Décision arrêtée. '
  'ADMIN n''apparaît nulle part ici : il ne détient pas occurrence.read. '
  '⚠️ Les parenthèses des sous-selects ne sont pas décoratives : sans elles, chaque '
  'appel est évalué une fois par ligne — 14 257 ms mesurées sur 50 000 dossiers.';

drop policy if exists obligation_occurrences_insert on public.obligation_occurrences;
create policy obligation_occurrences_insert on public.obligation_occurrences
  for insert to authenticated
  with check (
    -- ⚠️ `domain_id` est LISIBLE ICI parce que le trigger BEFORE INSERT
    -- `trg_occurrences_05_set_domain` l'a déjà posé : PostgreSQL exécute les
    -- triggers BEFORE ROW avant d'évaluer les politiques `with check`.
    domain_id = any ((select public.accessible_domains_array('occurrence.write'))::uuid[])
  );
comment on policy obligation_occurrences_insert on public.obligation_occurrences is
  'Création manuelle réservée au domaine concerné. Le flux nominal passe par le job de '
  'génération, qui s''exécute en service_role.';

drop policy if exists obligation_occurrences_update on public.obligation_occurrences;
create policy obligation_occurrences_update on public.obligation_occurrences
  for update to authenticated
  using (
    domain_id = any ((select public.accessible_domains_array('occurrence.write'))::uuid[])
    and is_locked = false
  )
  with check (
    domain_id = any ((select public.accessible_domains_array('occurrence.write'))::uuid[])
  );
comment on policy obligation_occurrences_update on public.obligation_occurrences is
  'Écriture dans son domaine, sur un dossier non verrouillé. Le verrou est doublé par le '
  'trigger enforce_occurrence_lock : la politique protège du client, le trigger protège '
  'aussi des jobs. Aucune politique DELETE : une occurrence ne se supprime pas.';

drop policy if exists occurrence_checklist_items_select on public.occurrence_checklist_items;
create policy occurrence_checklist_items_select on public.occurrence_checklist_items
  for select to authenticated
  using (
    (select public.is_active_user())
    and exists (
      select 1 from public.obligation_occurrences oc
      where oc.id = occurrence_checklist_items.occurrence_id
    )
  );
comment on policy occurrence_checklist_items_select on public.occurrence_checklist_items is
  'Visible si l''occurrence parente l''est : le EXISTS traverse la politique de '
  'obligation_occurrences, qui applique le cloisonnement de domaine.';

drop policy if exists occurrence_checklist_items_insert on public.occurrence_checklist_items;
create policy occurrence_checklist_items_insert on public.occurrence_checklist_items
  for insert to authenticated
  with check (
    public.obligation_domain_of_occurrence(occurrence_id)
      = any ((select public.accessible_domains_array('occurrence.write'))::uuid[])
  );

drop policy if exists occurrence_checklist_items_update on public.occurrence_checklist_items;
create policy occurrence_checklist_items_update on public.occurrence_checklist_items
  for update to authenticated
  using (
    public.obligation_domain_of_occurrence(occurrence_id)
      = any ((select public.accessible_domains_array('occurrence.write'))::uuid[])
  )
  with check (
    public.obligation_domain_of_occurrence(occurrence_id)
      = any ((select public.accessible_domains_array('occurrence.write'))::uuid[])
  );

drop policy if exists occurrence_comments_select on public.occurrence_comments;
create policy occurrence_comments_select on public.occurrence_comments
  for select to authenticated
  using (
    (select public.is_active_user())
    and deleted_at is null
    and exists (
      select 1 from public.obligation_occurrences oc
      where oc.id = occurrence_comments.occurrence_id
    )
  );

drop policy if exists occurrence_comments_insert on public.occurrence_comments;
create policy occurrence_comments_insert on public.occurrence_comments
  for insert to authenticated
  with check (
    (select public.is_active_user())
    and author_id = (select public.current_profile_id())
    and exists (
      select 1 from public.obligation_occurrences oc
      where oc.id = occurrence_comments.occurrence_id
    )
  );

drop policy if exists occurrence_comments_update on public.occurrence_comments;
create policy occurrence_comments_update on public.occurrence_comments
  for update to authenticated
  using ((select public.is_active_user()) and author_id = (select public.current_profile_id()))
  with check ((select public.is_active_user()) and author_id = (select public.current_profile_id()));

drop policy if exists occurrence_transitions_select on public.occurrence_transitions;
create policy occurrence_transitions_select on public.occurrence_transitions
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      (select public.has_permission('audit.read'))
      or exists (
        select 1 from public.obligation_occurrences oc
        where oc.id = occurrence_transitions.occurrence_id
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 5.5 Documents
--
-- ⚠️ La structure du prédicat est CONSERVÉE TELLE QUELLE, y compris l'appel à
-- `obligation_domain_of_occurrence(occurrence_id)`, qui reste par ligne. Ce
-- n'est pas un oubli : replier ce terme dans le `exists` aurait produit un
-- prédicat plus SERRÉ sur l'UPDATE, où le `exists` n'existait pas. Sur une
-- politique de sécurité, on ne change qu'une chose à la fois.
--
-- Le gain vient d'ailleurs : la fonction ne joint plus deux tables (3.3), et la
-- permission n'est plus recalculée par ligne. Une liste de documents est par
-- ailleurs toujours bornée à un dossier.
-- -----------------------------------------------------------------------------

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    (select public.is_active_user())
    and deleted_at is null
    and public.obligation_domain_of_occurrence(occurrence_id)
          = any ((select public.accessible_domains_array('document.read'))::uuid[])
    and exists (
      select 1 from public.obligation_occurrences oc
      where oc.id = documents.occurrence_id
    )
  );

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    (select public.is_active_user())
    and public.obligation_domain_of_occurrence(occurrence_id)
          = any ((select public.accessible_domains_array('document.delete'))::uuid[])
  )
  with check (
    public.obligation_domain_of_occurrence(occurrence_id)
      = any ((select public.accessible_domains_array('document.delete'))::uuid[])
  );

drop policy if exists document_access_log_select on public.document_access_log;
create policy document_access_log_select on public.document_access_log
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      (select public.has_permission('audit.read'))
      or exists (select 1 from public.documents d where d.id = document_access_log.document_id)
    )
  );

drop policy if exists document_integrity_checks_select on public.document_integrity_checks;
create policy document_integrity_checks_select on public.document_integrity_checks
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      (select public.has_permission('audit.read'))
      or exists (select 1 from public.documents d where d.id = document_integrity_checks.document_id)
    )
  );

drop policy if exists document_upload_tickets_select on public.document_upload_tickets;
create policy document_upload_tickets_select on public.document_upload_tickets
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      created_by = (select public.current_profile_id())
      or (select public.has_permission('audit.read'))
    )
  );

-- -----------------------------------------------------------------------------
-- 5.6 Registres de commerce — PERMISSION DÉDIÉE
--
-- ⚠️ CHANGEMENT DE SENS ASSUMÉ. 0018 avait posé `referential.manage` sur
-- l'écriture, faute de mieux : la permission dédiée n'existait pas encore.
-- Radier un registre ÉTEINT la génération de tous les dossiers qui en
-- dépendent ; ce n'est pas le même pouvoir que corriger le libellé d'une
-- obligation, et cela ne doit pas s'obtenir avec la même permission.
--
-- Aucune politique DELETE : un registre se RADIE (statut RADIE) et se supprime
-- logiquement. Un registre effacé physiquement emporterait le rattachement des
-- dossiers qu'il a produits.
-- -----------------------------------------------------------------------------

drop policy if exists commercial_registers_select on public.commercial_registers;
create policy commercial_registers_select on public.commercial_registers
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('obligation.read')));
comment on policy commercial_registers_select on public.commercial_registers is
  'Tout compte actif détenant obligation.read voit les registres : ils décrivent '
  'l''entreprise, pas un dossier. Ils ne sont pas cloisonnés par domaine — un '
  'registre n''appartient à aucun domaine.';

drop policy if exists commercial_registers_insert on public.commercial_registers;
create policy commercial_registers_insert on public.commercial_registers
  for insert to authenticated
  with check ((select public.has_permission('register.manage')));

drop policy if exists commercial_registers_update on public.commercial_registers;
create policy commercial_registers_update on public.commercial_registers
  for update to authenticated
  using ((select public.has_permission('register.manage')))
  with check ((select public.has_permission('register.manage')));
comment on policy commercial_registers_update on public.commercial_registers is
  '⚠️ register.manage, PAS referential.manage : radier un registre éteint la '
  'génération des dossiers qui en dépendent. Aucune politique DELETE — la '
  'radiation passe par le statut et la suppression logique.';

-- -----------------------------------------------------------------------------
-- 5.7 Absences — PERMISSION DÉDIÉE, ET LECTURE LARGE
--
-- ⚠️ SAVOIR QUI EST ABSENT N'EST PAS CONFIDENTIEL, et le supposer nuirait :
-- quiconque suit des dossiers doit pouvoir comprendre pourquoi un dossier
-- n'avance pas. La lecture est donc ouverte à tout détenteur de
-- `occurrence.read`, en plus de l'intéressé et des gestionnaires d'absence.
--
-- ⚠️ ET CELA NE DONNE AUCUN DROIT. Une absence est une information
-- d'organisation ; elle ne transfère aucune permission au suppléant, qui les
-- détient de son rôle et non d'une déclaration. `is_absent_on()` n'est appelée
-- par AUCUNE politique, et un test le vérifie structurellement.
--
-- Aucune politique DELETE : une absence se révoque par `revoked_at`. Effacer
-- une absence effacerait la raison pour laquelle un dossier a changé de mains.
-- -----------------------------------------------------------------------------

drop policy if exists user_absences_select on public.user_absences;
create policy user_absences_select on public.user_absences
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      user_id = (select auth.uid())
      or (select public.has_permission('absence.manage'))
      or (select public.has_permission('occurrence.read'))
    )
  );
comment on policy user_absences_select on public.user_absences is
  'L''intéressé, les gestionnaires d''absence, et quiconque suit des dossiers. '
  '⚠️ Savoir qui est absent n''est pas confidentiel : c''est ce qui permet de '
  'comprendre pourquoi un dossier n''avance pas.';

drop policy if exists user_absences_insert on public.user_absences;
create policy user_absences_insert on public.user_absences
  for insert to authenticated
  with check (
    (select public.is_active_user())
    and (
      user_id = (select auth.uid())
      or (select public.has_permission('absence.manage'))
    )
  );

drop policy if exists user_absences_update on public.user_absences;
create policy user_absences_update on public.user_absences
  for update to authenticated
  using (
    (select public.is_active_user())
    and (user_id = (select auth.uid()) or (select public.has_permission('absence.manage')))
  )
  with check (
    (select public.is_active_user())
    and (user_id = (select auth.uid()) or (select public.has_permission('absence.manage')))
  );
comment on policy user_absences_update on public.user_absences is
  'absence.manage, ou l''intéressé pour lui-même. ⚠️ Aucune politique DELETE : '
  'une absence se révoque par revoked_at, elle ne s''efface pas.';

-- -----------------------------------------------------------------------------
-- 5.8 Identités
--
-- ⚠️ `profiles_select` PORTE UNE COPIE de la politique des occurrences, pour
-- répondre à « de qui puis-je voir le nom ? ». Elle bouge donc avec elle —
-- suppléant compris.
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      id = (select public.current_profile_id())
      or (select public.has_permission('user.manage'))
      or exists (
        select 1
        from public.obligation_occurrences oc
        where (
                oc.owner_id = profiles.id
                or oc.deputy_id = profiles.id
                or oc.validator_id = profiles.id
              )
          and (
                oc.domain_id = any ((select public.accessible_domains_array('occurrence.read'))::uuid[])
                or oc.owner_id = (select public.current_profile_id())
                or oc.deputy_id = (select public.current_profile_id())
                or oc.validator_id = (select public.current_profile_id())
              )
      )
    )
  );
comment on policy profiles_select on public.profiles is
  'Soi-même, l''administration des comptes, et les personnes rencontrées sur un '
  'dossier visible. ⚠️ La seconde condition RECOPIE le using de '
  'obligation_occurrences_select : les deux doivent bouger ensemble, et un test '
  'd''intégration compare leurs résultats.';

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select public.is_active_user()) and id = (select public.current_profile_id()))
  with check ((select public.is_active_user()) and id = (select public.current_profile_id()));

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      (select public.has_permission('user.manage'))
      or user_id = (select public.current_profile_id())
    )
  );

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check ((select public.has_permission('role.manage')));

drop policy if exists user_roles_update on public.user_roles;
create policy user_roles_update on public.user_roles
  for update to authenticated
  using ((select public.has_permission('role.manage')))
  with check ((select public.has_permission('role.manage')));

drop policy if exists user_invitations_select on public.user_invitations;
create policy user_invitations_select on public.user_invitations
  for select to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('user.manage')));

drop policy if exists user_invitations_insert on public.user_invitations;
create policy user_invitations_insert on public.user_invitations
  for insert to authenticated
  with check (
    (select public.is_active_user())
    and (select public.has_permission('user.manage'))
    and invited_by = (select public.current_profile_id())
  );

drop policy if exists user_invitations_update on public.user_invitations;
create policy user_invitations_update on public.user_invitations
  for update to authenticated
  using ((select public.is_active_user()) and (select public.has_permission('user.manage')))
  with check ((select public.has_permission('user.manage')));

drop policy if exists validation_delegations_select on public.validation_delegations;
create policy validation_delegations_select on public.validation_delegations
  for select to authenticated
  using (
    (select public.is_active_user())
    and (
      delegator_id = (select public.current_profile_id())
      or delegate_id = (select public.current_profile_id())
      or (select public.has_permission('user.manage'))
    )
  );

drop policy if exists validation_delegations_insert on public.validation_delegations;
create policy validation_delegations_insert on public.validation_delegations
  for insert to authenticated
  with check (
    (select public.is_active_user())
    and delegator_id = (select public.current_profile_id())
    and delegate_id <> (select public.current_profile_id())
  );

drop policy if exists validation_delegations_update on public.validation_delegations;
create policy validation_delegations_update on public.validation_delegations
  for update to authenticated
  using (
    (select public.is_active_user())
    and (
      delegator_id = (select public.current_profile_id())
      or (select public.has_permission('user.manage'))
    )
  )
  with check (
    (select public.is_active_user())
    and (
      delegator_id = (select public.current_profile_id())
      or (select public.has_permission('user.manage'))
    )
  );

-- -----------------------------------------------------------------------------
-- 5.9 Préférences et notifications personnelles
-- -----------------------------------------------------------------------------

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using ((select public.is_active_user()) and recipient_id = (select public.current_profile_id()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using ((select public.is_active_user()) and recipient_id = (select public.current_profile_id()))
  with check (recipient_id = (select public.current_profile_id()));

drop policy if exists user_notification_preferences_select on public.user_notification_preferences;
create policy user_notification_preferences_select on public.user_notification_preferences
  for select to authenticated
  using ((select public.is_active_user()) and user_id = (select public.current_profile_id()));

drop policy if exists user_notification_preferences_insert on public.user_notification_preferences;
create policy user_notification_preferences_insert on public.user_notification_preferences
  for insert to authenticated
  with check ((select public.is_active_user()) and user_id = (select public.current_profile_id()));

drop policy if exists user_notification_preferences_update on public.user_notification_preferences;
create policy user_notification_preferences_update on public.user_notification_preferences
  for update to authenticated
  using ((select public.is_active_user()) and user_id = (select public.current_profile_id()))
  with check (user_id = (select public.current_profile_id()));

drop policy if exists user_notification_preferences_delete on public.user_notification_preferences;
create policy user_notification_preferences_delete on public.user_notification_preferences
  for delete to authenticated
  using ((select public.is_active_user()) and user_id = (select public.current_profile_id()));

drop policy if exists user_view_preferences_select on public.user_view_preferences;
create policy user_view_preferences_select on public.user_view_preferences
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists user_view_preferences_insert on public.user_view_preferences;
create policy user_view_preferences_insert on public.user_view_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists user_view_preferences_update on public.user_view_preferences;
create policy user_view_preferences_update on public.user_view_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- =============================================================================
-- SECTION 6 — SÉPARATION DES POUVOIRS : LE CONTRÔLE PORTE SUR L'ACTE
--
-- La règle d'avant refusait la validation au seul `owner_id`. Elle était
-- suffisante tant que la préparation était l'affaire d'un service ; elle ne
-- l'est plus avec la triade, pour deux raisons concrètes :
--
--   • le SUPPLEANT prépare exactement comme le RESPONSABLE — c'est le sens de
--     sa fonction — et rien ne l'empêchait de valider ensuite ;
--   • le SUPERVISEUR détient `occurrence.write` (matrice, section 1.2). Il peut
--     donc préparer, et il détient aussi `occurrence.validate`. Sans contrôle
--     sur l'acte, il pouvait préparer puis valider seul, ce qui vide la
--     séparation des pouvoirs de tout contenu.
--
-- ⚠️ LE CONTRÔLE PORTE SUR L'ACTE, PAS SUR LE RÔLE PORTÉ. On ne regarde pas
-- « quel rôle a cette personne » mais « cette personne a-t-elle préparé CE
-- dossier ». Trois faits l'établissent : elle en est le responsable, elle en est
-- le suppléant, ou elle y a agi À CE TITRE — trace lue dans `acted_as`.
--
-- Les deux soupapes sont INCHANGÉES : `app_settings.allow_self_validation`
-- pour l'exception générale, `obligation_types.allow_self_validation` pour la
-- dérogation par obligation.
-- =============================================================================

create or replace function public.self_validation_blocked(
  p_occurrence_id uuid,
  p_occurrence_type_id uuid,
  p_owner_id uuid,
  p_deputy_id uuid,
  p_actor_id uuid
)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = ''
as $$
  select
    p_actor_id is not null
    /*
     * ⚠️ `coalesce(..., false)` AUTOUR DE LA DISJONCTION, ET C'EST PORTANT.
     *
     * Un dossier sans responsable ni suppléant donne `NULL or NULL or false`,
     * soit NULL. Renvoyée telle quelle, cette valeur passe pour « faux » dans
     * un `if`, mais pour « exclu » dans le `not (...)` de la file : le dossier
     * DISPARAÎTRAIT de la file au lieu d'y figurer. La version à trois
     * arguments s'en protégeait par un `p_owner_id is not null` explicite ;
     * la disjonction demande la forme totale.
     */
    and coalesce(
      p_owner_id = p_actor_id
      or p_deputy_id = p_actor_id
      -- A agi sur CE dossier au titre de la préparation. C'est la trace qui
      -- répond, pas le rôle porté aujourd'hui : quelqu'un qui a préparé puis
      -- changé de fonction reste le préparateur de ce dossier-là.
      or exists (
        select 1
        from public.occurrence_transitions t
        where t.occurrence_id = p_occurrence_id
          and t.actor_id = p_actor_id
          and t.acted_as in ('RESPONSABLE', 'SUPPLEANT')
      ),
      false)
    -- Soupape générale, puis dérogation par obligation.
    and not public.setting_bool('allow_self_validation', false)
    and not coalesce(
      (select ot.allow_self_validation from public.obligation_types ot
        where ot.id = p_occurrence_type_id),
      false);
$$;

comment on function public.self_validation_blocked(uuid, uuid, uuid, uuid, uuid) is
  'Vrai quand l''acteur a PRÉPARÉ ce dossier — responsable, suppléant, ou auteur '
  'd''une transition avec acted_as RESPONSABLE/SUPPLEANT — et que l''auto-validation '
  'n''est levée ni globalement ni sur l''obligation. Consultée par le trigger qui '
  'refuse ET par la barre d''actions qui masque : le bouton ne peut plus promettre '
  'ce que la base refuse.';

grant execute on function public.self_validation_blocked(uuid, uuid, uuid, uuid, uuid)
  to authenticated;

create or replace function public.self_validation_blocked_for(p_occurrence_id uuid)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = ''
as $$
  select public.self_validation_blocked(
           oc.id, oc.obligation_type_id, oc.owner_id, oc.deputy_id,
           public.current_profile_id())
  from public.obligation_occurrences oc
  where oc.id = p_occurrence_id
    and public.can_see_occurrence(oc.id);
$$;

comment on function public.self_validation_blocked_for(uuid) is
  'Variante adressée par dossier, à l''usage de la barre d''actions. Rend NULL sur '
  'un dossier invisible de l''appelant — traité comme « non concluant » côté '
  'interface, qui n''affichera de toute façon aucun bouton sur un dossier qu''elle '
  'n''a pas pu charger.';

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
       new.id, new.obligation_type_id, new.owner_id, new.deputy_id,
       public.current_profile_id()) then
    raise exception
      'Séparation des tâches : qui a préparé ce dossier ne peut pas le valider.'
      using errcode = '42501',
            hint = 'Faire valider par un tiers, ou lever l''interdiction sur cette obligation.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_separation_of_duties() is
  'Refuse la validation par le préparateur. Ne porte pas la règle : il la LIT '
  'dans self_validation_blocked(), partagée avec l''interface et avec la file. '
  '⚠️ C''est CE trigger qui garantit — la file et l''interface ne font que ne pas '
  'proposer ce qu''il refusera.';

-- -----------------------------------------------------------------------------
-- 6.1 `evaluate_transition` — l' appelant qui refuse AVANT que le trigger ne lève
--
-- ⚠️ Corps repris TEL QUEL de la définition en base, à deux substitutions près,
-- appliquées mécaniquement : la lecture du domaine passe par la colonne
-- dénormalisée, et l' appel à `self_validation_blocked` prend la nouvelle
-- signature. Recopier à la main une fonction de 130 lignes qui décide de
-- chaque transition métier, c'est se donner une chance d' en changer une par
-- inadvertance.
-- -----------------------------------------------------------------------------

create or replace function public.evaluate_transition(p_occurrence_id uuid, p_to_status occurrence_status, p_reason text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text, p_late_reason_code late_reason_code DEFAULT NULL::late_reason_code)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  occ public.obligation_occurrences%rowtype;
  rule public.status_transition_rules%rowtype;
  occ_domain uuid;
  needs_proof boolean;
  missing text[];
  today_algiers date := (pg_catalog.now() at time zone 'Africa/Algiers')::date;
  reason_clean text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  levels int;
  obtained int;
begin
  if not public.can_see_occurrence(p_occurrence_id) then
    -- Indistinguable d'un identifiant inexistant : l'écart de message permettrait
    -- d'énumérer les dossiers des autres domaines.
    return jsonb_build_object('outcome', 'NOT_FOUND');
  end if;

  select * into occ from public.obligation_occurrences where id = p_occurrence_id;
  if occ.id is null then
    return jsonb_build_object('outcome', 'NOT_FOUND');
  end if;

  if occ.status = p_to_status then
    return jsonb_build_object('outcome', 'NO_CHANGE', 'version', occ.version);
  end if;

  -- ── La transition existe-t-elle ? ─────────────────────────────────────────
  -- Lue dans status_transition_rules, jamais écrite en dur.
  select * into rule
  from public.status_transition_rules
  where from_status = occ.status and to_status = p_to_status;

  if rule.id is null then
    return jsonb_build_object(
      'outcome', 'INVALID_TRANSITION', 'from', occ.status, 'to', p_to_status);
  end if;

  -- ── Verrou ────────────────────────────────────────────────────────────────
  -- Une seule porte de sortie, celle de `enforce_occurrence_lock` : la
  -- réouverture d'un dossier archivé.
  if occ.is_locked and not (occ.status = 'ARCHIVED' and p_to_status = 'SUBMITTED') then
    return jsonb_build_object('outcome', 'LOCKED');
  end if;

  -- ── Habilitation ──────────────────────────────────────────────────────────
  -- Le domaine est porté par le dossier depuis 0019 : plus de lecture de
  -- `obligation_types` pour l'obtenir.
  occ_domain := occ.domain_id;

  if rule.required_permission = 'occurrence.validate' then
    -- can_validate_occurrence intègre le filet DIRECTION passé le délai d'attente.
    if not public.can_validate_occurrence(p_occurrence_id) then
      return jsonb_build_object('outcome', 'FORBIDDEN', 'permission', rule.required_permission);
    end if;
  elsif not public.has_permission_in_domain(rule.required_permission, occ_domain) then
    return jsonb_build_object('outcome', 'FORBIDDEN', 'permission', rule.required_permission);
  end if;

  -- ── Motif ─────────────────────────────────────────────────────────────────
  if rule.requires_reason and reason_clean is null then
    return jsonb_build_object('outcome', 'REASON_REQUIRED');
  end if;

  -- ── Complétude du dossier ─────────────────────────────────────────────────
  if p_to_status = 'PENDING_VALIDATION' then
    missing := public.occurrence_missing_items(p_occurrence_id);
    if pg_catalog.array_length(missing, 1) is not null then
      return jsonb_build_object('outcome', 'INCOMPLETE', 'missing', to_jsonb(missing));
    end if;
  end if;

  -- ── Séparation des pouvoirs, et niveaux de validation ─────────────────────
  if p_to_status = 'VALIDATED' then
    if public.self_validation_blocked(
         occ.id, occ.obligation_type_id, occ.owner_id, occ.deputy_id,
         public.current_profile_id()) then
      return jsonb_build_object('outcome', 'SELF_VALIDATION_BLOCKED');
    end if;

    levels := public.validation_levels_required(p_occurrence_id);
    obtained := public.validation_steps_obtained(p_occurrence_id);

    if levels > 1 then
      if obtained = 0 then
        -- Première validation : elle compte, mais ne change pas l'état.
        return jsonb_build_object(
          'outcome', 'ALLOWED', 'effect', 'PARTIAL_VALIDATION',
          'obtained', obtained, 'required', levels, 'version', occ.version);
      end if;

      -- Second niveau : réservé à la DIRECTION, par décision arrêtée.
      if not public.is_direction(auth.uid()) then
        return jsonb_build_object(
          'outcome', 'SECOND_LEVEL_REQUIRES_DIRECTION',
          'obtained', obtained, 'required', levels);
      end if;
    end if;
  end if;

  -- ── Dépôt : preuve, référence, motif de retard ────────────────────────────
  if p_to_status = 'SUBMITTED' and occ.status = 'VALIDATED' then
    select ot.requires_proof into needs_proof
    from public.obligation_types ot where ot.id = occ.obligation_type_id;

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
    if occ.legal_due_date < today_algiers
       and coalesce(p_late_reason_code, occ.late_reason_code) is null then
      return jsonb_build_object('outcome', 'LATE_REASON_REQUIRED', 'dueDate', occ.legal_due_date);
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'ALLOWED', 'effect', 'FULL', 'version', occ.version, 'label', rule.label);
end;
$function$;

/*
 * ⚠️ L'ANCIENNE SIGNATURE À TROIS ARGUMENTS EST SUPPRIMÉE, PAS LAISSÉE EN PLACE.
 *
 * La leçon vient de 0018 : une surcharge conservée « au cas où » laisse les
 * appelants existants viser silencieusement l'ANCIENNE règle. Ici ce serait
 * pire qu'une erreur de plan — la fonction à trois arguments ne connaît ni le
 * dossier ni le suppléant, elle ne PEUT PAS répondre juste, et elle répondrait
 * « non bloqué » sur exactement les cas que cette section ajoute.
 *
 * Ce `drop` échoue si un appelant SQL subsiste. C'est voulu : c'est la
 * vérification, pas un nettoyage.
 */
drop function if exists public.self_validation_blocked(uuid, uuid, uuid);


-- =============================================================================
-- SECTION 7 — LA FILE DE VALIDATION ET SON COMPTEUR
--
-- La file applique deux choses que la politique RLS ne dit pas : qui peut
-- VALIDER (et non seulement lire), et la séparation des pouvoirs. Les deux sont
-- reformulées ici sur le même principe qu'en section 5.
-- =============================================================================

create or replace view public.validation_queue
  with (security_invoker = true)
  as
  select oc.id,
         oc.obligation_type_id,
         oc.period_key,
         oc.period_start,
         oc.legal_due_date,
         oc.internal_due_date,
         oc.status,
         oc.version,
         oc.owner_id,
         oc.validator_id,
         oc.submitted_for_validation_at,
         ot.code as obligation_code,
         ot.name as obligation_name,
         ot.criticality,
         ot.validation_levels,
         dom.code as domain_code,
         au.name as authority_name,
         owner.full_name as owner_name,
         public.validation_steps_obtained(oc.id) as validations_obtained,
         (oc.internal_due_date - (pg_catalog.now() at time zone 'Africa/Algiers')::date)
           as days_to_internal
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  left join public.domains dom on dom.id = ot.domain_id
  left join public.authorities au on au.id = ot.authority_id
  left join public.profiles owner on owner.id = oc.owner_id
  where oc.status = 'PENDING_VALIDATION'
    and oc.deleted_at is null
    -- ── Habilitation à valider ──────────────────────────────────────────────
    and (
      -- Terme 1, la chaîne nominale. Le domaine est lu SUR LE DOSSIER, et le
      -- tableau des domaines habilités est un InitPlan : une évaluation pour
      -- toute la requête.
      oc.domain_id = any ((select public.accessible_domains_array('occurrence.validate'))::uuid[])
      -- Terme 2, le filet DIRECTION. Il dépend de l'ancienneté de CE dossier et
      -- reste donc par ligne — mais il est GARDÉ par un test devenu constant,
      -- de sorte que l'appel coûteux ne s'exécute jamais pour les autres
      -- comptes.
      --
      -- ⚠️ On appelle `can_validate_occurrence` plutôt que de recopier la règle
      -- du filet : la dupliquer ici en ferait une seconde source de vérité.
      or ((select public.is_direction(auth.uid())) and public.can_validate_occurrence(oc.id))
    )
    -- ── Séparation des pouvoirs ─────────────────────────────────────────────
    --
    -- ⚠️ `self_validation_blocked()` reste LA définition de la règle : c'est elle
    -- que le trigger applique, et c'est le trigger qui garantit. Mais l'appeler
    -- ici une fois par ligne rouvrait `app_settings` et `obligation_types` pour
    -- chaque dossier. La vue joint déjà `obligation_types` : elle lit donc la
    -- dérogation dans la ligne qu'elle a sous la main, et le sous-select rend
    -- la soupape générale constante.
    --
    -- ⚠️ LE TROISIÈME TERME EST UNE SOUS-REQUÊTE NON CORRÉLÉE. `oc.id in (select
    -- ... where t.actor_id = <moi>)` ramène en un parcours d'index l'ensemble —
    -- petit — des dossiers que l'appelant a préparés, que le planificateur
    -- anti-joint ensuite. La forme corrélée `exists (... and t.occurrence_id =
    -- oc.id)` aurait rouvert la table une fois par dossier de la file, soit
    -- exactement le défaut que cette migration corrige.
    --
    -- Deux écritures du même prédicat, et un test d'intégration qui compare
    -- leurs résultats. Toute évolution doit toucher les deux.
    --
    -- ⚠️ `coalesce(..., false)` AUTOUR DE LA DISJONCTION — DÉFAUT MESURÉ, PAS
    -- PRÉCAUTION. `deputy_id` est NULL sur la quasi-totalité des dossiers :
    -- `NULL = moi` vaut NULL, `not (... and NULL and ...)` vaut NULL, et une
    -- ligne dont le filtre rend NULL est ÉCARTÉE. Sans ce `coalesce`, la file
    -- est passée de 5 000 dossiers à ZÉRO sur le jeu de mesure — un écran vide,
    -- sans erreur, sans rien à quoi se raccrocher. La fonction
    -- `self_validation_blocked` porte la même protection : les deux écritures
    -- du prédicat doivent la porter, sans quoi elles ne disent pas la même
    -- chose exactement là où c'est le plus difficile à voir.
    and not (
      coalesce(
        oc.owner_id = (select public.current_profile_id())
        or oc.deputy_id = (select public.current_profile_id())
        or oc.id in (
          select t.occurrence_id
          from public.occurrence_transitions t
          where t.actor_id = (select public.current_profile_id())
            and t.acted_as in ('RESPONSABLE', 'SUPPLEANT')
        ),
        false)
      and not (select public.setting_bool('allow_self_validation', false))
      and not coalesce(ot.allow_self_validation, false)
    );

comment on view public.validation_queue is
  'Dossiers en attente de la validation de l''appelant, délégations comprises — '
  'elles entrent par `effective_principals()`, dans `accessible_domains_array`. '
  'security_invoker : la politique des occurrences s''applique par-dessus. '
  '⚠️ L''habilitation est évaluée UNE FOIS PAR REQUÊTE et non par dossier : voir '
  'l''en-tête de 0019 et la mesure qui l''a motivée.';

grant select on public.validation_queue to authenticated;

/*
 * ⚠️ LE COMPTEUR PASSE DE SECURITY DEFINER À SECURITY INVOKER.
 *
 * En SECURITY DEFINER, la fonction interrogeait `validation_queue` — une vue
 * `security_invoker` — sous l'identité du PROPRIÉTAIRE, qui contourne la RLS.
 * La pastille comptait donc des dossiers que l'écran, lui, filtrait : les deux
 * ne pouvaient s'accorder que par coïncidence, et l'écart aurait grandi avec
 * toute divergence entre `occurrence.read` et `occurrence.validate`.
 *
 * En SECURITY INVOKER, la pastille et l'écran appliquent LA MÊME politique. Ce
 * n'est pas une optimisation : c'est le retrait d'un contournement de RLS.
 */
create or replace function public.pending_validation_count()
returns int
language sql
stable
parallel safe
security invoker
set search_path = ''
as $fn$
  -- ⚠️ Compte la VUE elle-même : c'est la seule façon d'être certain que la
  -- pastille et l'écran donnent le même nombre. Recopier ses conditions ici
  -- les laisserait diverger au premier changement.
  select pg_catalog.count(*)::int from public.validation_queue;
$fn$;

comment on function public.pending_validation_count() is
  'Compteur affiché dans la navigation. Compte `validation_queue` sans recopier '
  'ses conditions : un compteur qui annonce trois dossiers pour une file qui en '
  'montre deux détruit la confiance dans les deux. ⚠️ SECURITY INVOKER : la '
  'politique des occurrences s''applique, comme sur l''écran.';

grant execute on function public.pending_validation_count() to authenticated;


-- =============================================================================
-- SECTION 8 — VÉRIFICATIONS
--
-- ⚠️ Ces blocs échouent la migration. Une garantie de sécurité qu'on n'a pas
-- vérifiée n'est pas une garantie, c'est une intention.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 8.1 Plus aucune politique ne porte d'appel d'habilitation non enveloppé
--
-- La détection retire du texte de la politique toutes les formes ENVELOPPÉES,
-- puis cherche ce qui reste. C'est le seul sens de lecture qui ne se laisse pas
-- tromper par l'imbrication.
-- -----------------------------------------------------------------------------

do $$
declare v_faute text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into v_faute
  from pg_policies
  where schemaname = 'public'
    and regexp_replace(
          coalesce(qual, '') || ' ' || coalesce(with_check, ''),
          '\( SELECT [a-z_]+\(', '', 'g')
        -- ⚠️ Les parenthèses autour de la concaténation sont obligatoires :
        -- l'opérateur d'expression rationnelle est plus prioritaire que la
        -- concaténation, et sans elles le prédicat se lit
        -- « (texte ~ motif) || suite », soit du texte là où un booléen est
        -- attendu.
        ~ ('(has_permission|has_permission_in_domain|is_active_user|is_admin'
           || '|current_profile_id|accessible_domains|accessible_domains_array'
           || '|effective_principals|domains_with_permission)\(');

  if v_faute is not null then
    raise exception
      'Politiques portant un appel d''habilitation NON ENVELOPPÉ (évalué par ligne) : %',
      v_faute;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8.2 Toute fonction d'habilitation est STABLE et PARALLEL SAFE
-- -----------------------------------------------------------------------------

do $$
declare v_faute text;
begin
  -- `provolatile` et `proparallel` sont de type "char" : sans transtypage, la
  -- concaténation ne sait pas quel opérateur choisir.
  select string_agg(p.proname || ' (' || p.provolatile::text
                    || '/' || p.proparallel::text || ')',
                    ', ' order by p.proname)
    into v_faute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('current_profile_id','is_active_user','effective_principals',
                      'has_permission','has_permission_in_domain','accessible_domains',
                      'accessible_domains_array','is_admin','is_direction',
                      'obligation_domain_of_type','obligation_domain_of_occurrence',
                      'domains_with_permission','can_see_occurrence',
                      'can_validate_occurrence','self_validation_blocked')
    and (p.provolatile <> 's' or p.proparallel <> 's');

  if v_faute is not null then
    raise exception
      'Fonctions d''habilitation qui ne sont pas STABLE PARALLEL SAFE : %', v_faute;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8.3 Le domaine dénormalisé est exact
-- -----------------------------------------------------------------------------

do $$
declare v_ecarts bigint;
begin
  select count(*) into v_ecarts
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.status <> 'ARCHIVED'
    and oc.domain_id is distinct from ot.domain_id;

  if v_ecarts > 0 then
    raise exception
      '% dossier(s) non archivé(s) portent un domaine différent de leur obligation.',
      v_ecarts;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8.4 Aucune politique ne fait dépendre un droit d'une déclaration d'absence
--
-- ⚠️ Reprise de la vérification posée en 0018, et maintenue ici parce que c'est
-- exactement le genre de raccourci qu'une réécriture de politiques peut
-- introduire sans y penser. Les permissions du suppléant viennent de son RÔLE.
-- -----------------------------------------------------------------------------

do $$
declare v_faute text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into v_faute
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%is_absent_on%';

  if v_faute is not null then
    raise exception
      'Politiques faisant dépendre un droit d''une absence : %. '
      'Les permissions du suppléant viennent de son rôle, pas d''une déclaration.',
      v_faute;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8.5 Toutes les tables du schéma public portent la RLS
-- -----------------------------------------------------------------------------

do $$
declare v_faute text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_faute
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if v_faute is not null then
    raise exception 'Tables sans RLS : %', v_faute;
  end if;
end $$;
