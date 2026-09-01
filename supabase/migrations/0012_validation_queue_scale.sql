-- =============================================================================
-- 0012 — FILE DE VALIDATION : TENUE EN CHARGE
--
-- ⚠️ DÉFAUT MESURÉ, PAS SUPPOSÉ. La vue `validation_queue` (0010) et
-- `pending_validation_count()` filtraient chaque ligne par
-- `can_validate_occurrence(oc.id)`. Cette fonction rouvre
-- `obligation_occurrences` pour CHAQUE ligne examinée : le coût est linéaire en
-- nombre de dossiers en attente, avec une lecture de table par dossier.
--
-- Constaté en éprouvant le tableau de bord sur 50 000 occurrences : avec 10 000
-- dossiers en attente de validation, l'écran /validation mettait 8 secondes à
-- répondre, et son compteur de navigation 22 secondes. C'est le même défaut que
-- celui corrigé sur `dashboard_alerts` en 0011, au même endroit du raisonnement :
-- une règle d'habilitation juste, appliquée une fois par ligne au lieu d'une
-- fois par domaine.
--
-- Ni le cloisonnement NI la séparation des pouvoirs ne sont relâchés. Les deux
-- sont reformulés :
--   • les domaines où l'appelant peut valider sont calculés UNE fois ;
--   • le filet DIRECTION reste par dossier, parce qu'il dépend de l'ancienneté
--     de CE dossier — mais il ne s'évalue que pour les comptes DIRECTION, et
--     la condition la moins chère est placée en premier.
-- =============================================================================

/**
 * Domaines où l'appelant détient une permission donnée.
 *
 * ⚠️ STABLE et sans argument variable dans son usage : PostgreSQL peut
 * l'évaluer une fois par requête au lieu d'une fois par ligne. C'est toute la
 * différence entre un balayage et une comparaison en mémoire.
 *
 * Rend un tableau plutôt qu'un `setof` pour être comparable par `= any(...)`,
 * forme que le planificateur traite comme une constante.
 */
create or replace function public.domains_with_permission(p_permission text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(d.id), array[]::uuid[])
  from public.domains d
  where public.has_permission_in_domain(p_permission, d.id);
$fn$;

comment on function public.domains_with_permission(text) is
  'Domaines où l''appelant détient la permission demandée, sous forme de tableau. '
  'Extraite pour que les vues cessent d''appeler une fonction d''habilitation une '
  'fois par ligne : le nombre de domaines est petit et fixe, le nombre de '
  'dossiers ne l''est pas.';

grant execute on function public.domains_with_permission(text) to authenticated;

-- -----------------------------------------------------------------------------
-- La file
-- -----------------------------------------------------------------------------

drop view if exists public.validation_queue;

create view public.validation_queue
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
    -- ── Habilitation, reformulée ────────────────────────────────────────────
    -- Terme 1 : la chaîne nominale, évaluée par DOMAINE et non par dossier.
    and (
      ot.domain_id = any (public.domains_with_permission('occurrence.validate'))
      -- Terme 2 : le filet DIRECTION. Il dépend de l'ancienneté de CE dossier et
      -- reste donc par ligne — mais il est GARDÉ par un test sans argument, de
      -- sorte que l'appel coûteux ne s'exécute jamais pour les autres comptes.
      --
      -- ⚠️ On appelle `can_validate_occurrence` plutôt que de recopier la règle
      -- du filet : la dupliquer ici en ferait une seconde source de vérité, et
      -- c'est exactement ce que ce projet refuse ailleurs.
      or (public.is_direction(auth.uid()) and public.can_validate_occurrence(oc.id))
    )
    -- ── Séparation des pouvoirs, exprimée sur les colonnes DÉJÀ JOINTES ─────
    --
    -- ⚠️ `self_validation_blocked()` reste LA définition de la règle : c'est elle
    -- que le trigger applique, et c'est le trigger qui garantit. Mais l'appeler
    -- ici une fois par ligne rouvrait `app_settings` et `obligation_types` pour
    -- chaque dossier — 6,4 secondes sur 10 000 dossiers en attente, mesurées.
    -- La vue joint déjà `obligation_types` : elle lit donc la dérogation dans la
    -- ligne qu'elle a sous la main.
    --
    -- Même procédé que `can_see_occurrence` vis-à-vis de la politique des
    -- occurrences : deux écritures du même prédicat, et un test d'intégration
    -- qui compare leurs résultats. Toute évolution doit toucher les deux.
    and not (
      oc.owner_id = public.current_profile_id()
      and not public.setting_bool('allow_self_validation', false)
      and not coalesce(ot.allow_self_validation, false)
    );

comment on view public.validation_queue is
  'Dossiers en attente de la validation de l''appelant, délégations comprises — '
  'elles entrent par `effective_principals()`, dans `has_permission_in_domain`. '
  'security_invoker : la politique des occurrences s''applique par-dessus. '
  '⚠️ L''habilitation est évaluée PAR DOMAINE et non par dossier : voir 0012 et '
  'la mesure qui l''a motivée.';

grant select on public.validation_queue to authenticated;

-- -----------------------------------------------------------------------------
-- Le compteur, aligné sur la file — une seule définition
-- -----------------------------------------------------------------------------

create or replace function public.pending_validation_count()
returns int
language sql
stable
security definer
set search_path = ''
as $fn$
  -- ⚠️ Compte la VUE elle-même : c'est la seule façon d'être certain que la
  -- pastille et l'écran donnent le même nombre. Recopier les conditions ici,
  -- comme le faisait 0010, les laissait diverger au premier changement.
  select count(*)::int from public.validation_queue;
$fn$;

comment on function public.pending_validation_count() is
  'Compteur affiché dans la navigation. Compte `validation_queue` sans recopier '
  'ses conditions : un compteur qui annonce trois dossiers pour une file qui en '
  'montre deux détruit la confiance dans les deux.';

grant execute on function public.pending_validation_count() to authenticated;
