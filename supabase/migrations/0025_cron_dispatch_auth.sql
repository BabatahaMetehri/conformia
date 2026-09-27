-- =============================================================================
-- 0025 — AUTHENTIFICATION DES TÂCHES PLANIFIÉES
--
-- ⚠️ CETTE MIGRATION RÉPARE UNE PANNE TOTALE ET SILENCIEUSE DE L'AUTOMATISATION.
--
-- Les cinq tâches planifiées appellent l'application par `net.http_post`. Deux
-- défauts CUMULÉS les rendaient inopérantes en production :
--
--   1. L'APPEL N'EST PAS AUTHENTIFIÉ. Elles n'envoient qu'un en-tête
--      `Content-Type`, alors que les Route Handlers visés exigent
--      `x-cron-secret` et répondent 401 sans lui.
--
--   2. L'ADRESSE NE PEUT PAS ÊTRE POSÉE. Elles lisent
--      `current_setting('app.…_url')`, un paramètre personnalisé dont
--      l'enregistrement durable — `alter database … set app.…` — exige
--      SUPERUSER. Or le rôle `postgres` de Supabase n'est PAS superuser, ni en
--      local ni sur l'offre hébergée. Le réglage serait resté NULL pour
--      toujours, et l'appel serait parti vers une adresse vide.
--
-- Conséquence : AUCUNE des cinq n'aurait abouti.
--
--   • génération des dossiers   — plus aucun dossier créé ;
--   • notifications horaires    — plus aucun rappel d'échéance ;
--   • résumé hebdomadaire       — plus aucun envoi ;
--   • sauvegarde quotidienne    — plus aucune sauvegarde ;
--   • épreuve de restauration   — plus aucune vérification.
--
-- ⚠️ ET RIEN NE L'AURAIT DIT. `net.http_post` part sans attendre la réponse :
-- le 401 se serait perdu dans `net._http_response`. La route n'ayant jamais
-- tourné, elle n'aurait même pas ouvert de ligne dans `job_runs` — et une tâche
-- qui ne laisse aucune trace ne se distingue pas d'une tâche qui n'avait rien à
-- faire. C'est exactement le silence que cette plateforme existe pour rompre.
--
-- On corrige donc TROIS choses, parce que corriger l'en-tête ne suffirait pas :
--   1. la configuration vit dans une TABLE, posable sans superuser ;
--   2. l'appel porte le secret, et REFUSE de partir s'il ne l'a pas ;
--   3. l'absence prolongée de génération devient une alerte visible.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — LA CONFIGURATION, DANS UNE TABLE INATTEIGNABLE
--
-- ⚠️ PAS UN PARAMÈTRE POSTGRES, ET PAS `app_settings` NON PLUS.
--
-- Un paramètre personnalisé ne se pose durablement qu'avec SUPERUSER, que
-- Supabase n'accorde pas. Une table, elle, se remplit avec les droits ordinaires
-- du propriétaire.
--
-- `app_settings` aurait été le réflexe, mais elle est LISIBLE par les porteurs
-- de `settings.manage` : y ranger le secret partagé le montrerait à tout
-- administrateur. Cette table-ci ne porte AUCUNE policy et ses droits sont
-- retirés à tout le monde — PostgREST ne peut pas l'atteindre, et seule la
-- fonction SECURITY DEFINER ci-dessous la lit.
-- =============================================================================

create table if not exists public.cron_dispatch_config (
  key text primary key check (key in (
    'cron_secret',
    'generate_occurrences_url',
    'notifications_url'
  )),
  value text not null check (length(value) > 0),
  updated_at timestamptz not null default now()
);

comment on table public.cron_dispatch_config is
  'Adresses et secret partagé des tâches planifiées. Table SANS policy et sans '
  'droit accordé : inatteignable par PostgREST, lue uniquement par '
  'dispatch_cron_post en SECURITY DEFINER. Se remplit par « npm run cron:config », '
  'jamais par l''éditeur SQL — un secret collé dans une interface web reste dans '
  'son historique.';

alter table public.cron_dispatch_config enable row level security;

/*
 * ⚠️ AUCUNE POLICY N'EST CRÉÉE, ET C'EST LE DISPOSITIF. Avec la RLS active et
 * zéro policy, toute lecture passant par une session utilisateur rend zéro
 * ligne. Le retrait des droits ferme la porte une seconde fois.
 */
revoke all on table public.cron_dispatch_config from public;
revoke all on table public.cron_dispatch_config from anon, authenticated;

create or replace function public.dispatch_cron_post(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  target text;
  secret text;
begin
  select value into target from public.cron_dispatch_config where key = p_key;
  select value into secret from public.cron_dispatch_config where key = 'cron_secret';

  if target is null or target = '' then
    raise exception
      'Tâche planifiée : adresse « % » non configurée. Lancer « npm run cron:config ».',
      p_key;
  end if;

  /*
   * La longueur minimale est celle qu'impose la validation d'environnement
   * (CRON_SECRET, 32 caractères). La contrôler ici évite le cas le plus pénible :
   * un secret posé mais tronqué, qui produit un 401 identique à une absence de
   * secret, sans rien pour les distinguer.
   */
  if secret is null or length(secret) < 32 then
    raise exception
      'Tâche planifiée : secret absent ou trop court (% caractères, 32 attendus). '
      'L''appel serait rejeté en 401 sans laisser de trace.',
      coalesce(length(secret), 0);
  end if;

  perform net.http_post(
    url := target,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', secret
    )
  );
end;
$fn$;

comment on function public.dispatch_cron_post(text) is
  'Appel HTTP d''une tâche planifiée, AVEC le secret partagé. ⚠️ Lève plutôt que '
  'de poster sans lui : un 401 émis par net.http_post se perd dans '
  'net._http_response, tandis qu''une exception est consignée par pg_cron dans '
  'cron.job_run_details. Le silence devient une ligne rouge.';

/*
 * ⚠️ EXÉCUTION RETIRÉE À TOUT LE MONDE. La fonction lit le secret : l'exposer à
 * `authenticated` offrirait à n'importe quel porteur de session un moyen de
 * faire émettre un appel authentifié depuis la base.
 */
revoke all on function public.dispatch_cron_post(text) from public;
revoke all on function public.dispatch_cron_post(text) from anon, authenticated;

-- =============================================================================
-- SECTION 2 — DEUX TÂCHES RÉELLES, TROIS FANTÔMES SUPPRIMÉES
--
-- ⚠️ TROIS DES CINQ TÂCHES VISAIENT DES ROUTES QUI N'EXISTENT PAS. Même
-- authentifiées, elles auraient reçu un 404 :
--
--   • `conformia-weekly-digest` → le résumé hebdomadaire est DÉJÀ produit par
--     `runNotificationJob`, qui appelle `scheduleWeeklyDigest` à chaque cycle.
--     La tâche séparée faisait double emploi, et l'aurait envoyé deux fois le
--     jour venu si la route avait existé.
--
--   • `conformia-backup` et `conformia-restore-test` → la sauvegarde n'est pas
--     une route HTTP mais un SCRIPT (`npm run backup`, `npm run restore:test`).
--     Elle doit produire une archive sur un disque contrôlé par AGROESPACE ;
--     une route servie par l'application n'a accès ni à ce disque ni à
--     `pg_dump`. Ces deux-là relèvent de l'ordonnanceur du système
--     d'exploitation — voir `docs/deploiement.md`.
--
-- ⚠️ LES SUPPRIMER EST PLUS SÛR QUE LES LAISSER. Une tâche planifiée qui échoue
-- chaque nuit apprend à ignorer `cron.job_run_details` ; et tant qu'elle figure
-- dans la liste, on croit la sauvegarde automatisée alors qu'elle ne l'est pas.
-- C'est la pire des deux erreurs : celle qui rassure.
--
-- Les horaires des deux tâches conservées sont inchangés. Les heures sont en UTC
-- et l'Algérie est à UTC+1 toute l'année — 01 h 00 UTC vaut 02 h 00 à Alger.
-- =============================================================================

/*
 * ⚠️ LES DEUX EXTENSIONS SONT CRÉÉES ICI, ET C'EST INDISPENSABLE.
 *
 * `pg_cron` déclenche, `pg_net` émet l'appel HTTP. Sur une base Supabase neuve,
 * pg_cron est présent mais **pg_net ne l'est pas** : `create extension` est un
 * geste explicite que rien ne fait à votre place.
 *
 * Sans pg_net, les tâches se planifient très bien et échouent à chaque
 * déclenchement sur « schema net does not exist ». L'erreur n'apparaît que dans
 * `cron.job_run_details`, que personne n'ouvre — et l'on croit l'automatisation
 * en place parce que `cron.job` montre bien deux lignes.
 */
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  reelles text[] := array[
    -- nom de tâche,                  horaire,      clé de configuration
    'conformia-generate-occurrences', '0 1 * * *',  'generate_occurrences_url',
    'conformia-notifications',        '5 * * * *',  'notifications_url'
  ];
  fantomes text[] := array[
    'conformia-weekly-digest',
    'conformia-backup',
    'conformia-restore-test'
  ];
  i int;
  nom text;
begin
  foreach nom in array fantomes loop
    perform cron.unschedule(nom)
    where exists (select 1 from cron.job where jobname = nom);
  end loop;

  for i in 1 .. array_length(reelles, 1) by 3 loop
    perform cron.unschedule(reelles[i])
    where exists (select 1 from cron.job where jobname = reelles[i]);

    perform cron.schedule(
      reelles[i],
      reelles[i + 1],
      format('select public.dispatch_cron_post(%L)', reelles[i + 2])
    );
  end loop;
exception
  when others then
    /*
     * pg_cron et pg_net peuvent manquer d'une installation à l'autre. Leur
     * absence ne doit pas faire échouer la migration — mais elle DOIT se dire,
     * parce qu'une installation sans planificateur n'automatise rien.
     */
    raise notice
      'pg_cron/pg_net indisponible (%). Les deux tâches doivent alors être '
      'déclenchées par un ordonnanceur externe, avec l''en-tête x-cron-secret.',
      sqlerrm;
end;
$$;

-- =============================================================================
-- SECTION 3 — LE SILENCE DEVIENT VISIBLE
--
-- ⚠️ CORRIGER L'APPEL NE SUFFIT PAS. Si la planification retombe en panne —
-- adresse changée, secret tourné sans être reporté, pg_net désactivé — on
-- revient au même silence. La génération cesse, plus aucun dossier n'apparaît,
-- et personne ne s'en aperçoit avant qu'une échéance soit manquée.
--
-- `BACKUP_STALE` protège déjà les sauvegardes de la même façon. On ajoute son
-- équivalent pour la génération, qui est la fonction vitale de la plateforme.
-- =============================================================================

create or replace function public.dashboard_alerts()
returns table (code text, severity text, total int, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  me uuid := public.current_profile_id();
  allowed uuid[];
  null_domain_allowed boolean;
  today date := (now() at time zone 'Africa/Algiers')::date;
  next_year int := extract(year from (now() at time zone 'Africa/Algiers'))::int + 1;
  n int;
begin
  if not public.is_active_user() then
    return;
  end if;

  select coalesce(array_agg(d.id), array[]::uuid[]) into allowed
  from public.domains d
  where public.has_permission_in_domain('occurrence.read', d.id);

  -- Une obligation sans domaine reste possible : son accès se décide à part.
  null_domain_allowed := public.has_permission_in_domain('occurrence.read', null);

  -- Dossiers CRITICAL en retard.
  select count(*)::int into n
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.deleted_at is null
    and ot.criticality = 'CRITICAL'
    and oc.legal_due_date < today
    and not (oc.status = any (public.overdue_exempt_statuses()))
    and (ot.domain_id = any (allowed)
         or (ot.domain_id is null and null_domain_allowed)
         or oc.owner_id = me or oc.validator_id = me);
  if n > 0 then
    code := 'CRITICAL_OVERDUE'; severity := 'CRITICAL'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  -- Échéance sous 48 h, dossier non démarré.
  select count(*)::int into n
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.deleted_at is null
    and oc.status = 'TODO'
    and oc.legal_due_date between today and today + 2
    and (ot.domain_id = any (allowed)
         or (ot.domain_id is null and null_domain_allowed)
         or oc.owner_id = me or oc.validator_id = me);
  if n > 0 then
    code := 'IMMINENT_NOT_STARTED'; severity := 'HIGH'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  -- Validation en attente depuis plus de cinq jours.
  select count(*)::int into n
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where oc.deleted_at is null
    and oc.status = 'PENDING_VALIDATION'
    and oc.submitted_for_validation_at < now() - interval '5 days'
    and (ot.domain_id = any (allowed)
         or (ot.domain_id is null and null_domain_allowed)
         or oc.owner_id = me or oc.validator_id = me);
  if n > 0 then
    code := 'VALIDATION_STALE'; severity := 'HIGH'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  -- Aucune sauvegarde réussie depuis 36 h — « aucune, jamais » comprise.
  if public.has_permission('settings.manage')
     and not exists (
       select 1 from public.backup_runs b
       where b.status = 'SUCCEEDED' and b.finished_at > now() - interval '36 hours')
  then
    code := 'BACKUP_STALE'; severity := 'CRITICAL'; total := 1; detail := '{}'::jsonb;
    return next;
  end if;

  /*
   * ⚠️ GÉNÉRATION ARRÊTÉE — L'ALERTE AJOUTÉE PAR CETTE MIGRATION.
   *
   * La génération tourne chaque nuit. Deux nuits sans exécution n'est jamais
   * normal : c'est la planification qui est tombée. Et sa panne est MUETTE par
   * nature — plus aucun dossier n'apparaît, ce qui ressemble exactement à une
   * période calme.
   *
   * Le seuil est à 48 h et non 24 h : une seule nuit manquée peut tenir à un
   * redémarrage, et une alerte qui se déclenche pour une cause bénigne finit par
   * ne plus être lue.
   *
   * SKIPPED compte comme une exécution : le verrou était pris, donc une autre
   * instance tournait. FAILED ne compte pas — une tâche qui échoue chaque nuit
   * doit rester signalée.
   */
  if public.has_permission('settings.manage')
     and not exists (
       select 1 from public.job_runs j
       where j.job_name = 'generate-occurrences'
         and j.status in ('SUCCEEDED', 'PARTIAL', 'SKIPPED')
         and j.started_at > now() - interval '48 hours')
  then
    code := 'GENERATION_STALE';
    severity := 'CRITICAL';
    total := 1;
    detail := jsonb_build_object(
      'last_run',
      (select max(started_at) from public.job_runs where job_name = 'generate-occurrences'));
    return next;
  end if;

  /*
   * ⚠️ CALENDRIER DE L'ANNÉE SUIVANTE SANS AUCUNE FÊTE RELIGIEUSE.
   *
   * Les fêtes religieuses sont fixées par décret : leur absence n'est jamais un
   * état normal, toujours un oubli. Et un oubli qui ne coûte rien tant que
   * l'année n'a pas commencé, puis qui décale silencieusement chaque échéance
   * tombant un jour chômé.
   */
  if public.has_permission('referential.manage')
     and not exists (
       select 1 from public.holidays
       where not is_recurring
         and extract(year from holiday_date)::int = next_year)
  then
    code := 'HOLIDAYS_INCOMPLETE';
    severity := 'HIGH';
    total := next_year;
    detail := jsonb_build_object('year', next_year);
    return next;
  end if;

  -- Divergence d'intégrité documentaire non acquittée.
  select count(*)::int into n from public.document_integrity_alerts;
  if n > 0 then
    code := 'INTEGRITY_MISMATCH'; severity := 'CRITICAL'; total := n; detail := '{}'::jsonb;
    return next;
  end if;

  return;
end;
$fn$;

comment on function public.dashboard_alerts() is
  'Bandeau d''alertes, calculé sur les tables VIVES — une alerte différée de '
  'quinze minutes ne vaut rien. Chaque branche applique le cloisonnement de '
  'can_see_occurrence, mais reformulé pour être évalué une fois par domaine et '
  'non une fois par dossier : la forme naïve coûtait 2 479 ms sur 50 000 lignes. '
  '⚠️ GENERATION_STALE et BACKUP_STALE signalent des SILENCES : une tâche qui ne '
  'tourne plus ne produit aucune erreur, seulement une absence qui ressemble à '
  'une période calme.';

grant execute on function public.dashboard_alerts() to authenticated;

-- =============================================================================
-- SECTION 4 — CONTRÔLE DES DISPATCHES
--
-- ⚠️ Vue de diagnostic, pour répondre à « la tâche est-elle réellement partie,
-- et qu'a répondu l'application ? ». Sans elle, la réponse se cherche dans une
-- table interne de pg_net que personne ne pense à ouvrir.
-- =============================================================================

do $$
begin
  execute $v$
    create or replace view public.cron_dispatch_log
    with (security_invoker = true) as
    select
      r.id,
      r.created                          as dispatched_at,
      r.status_code,
      r.status_code between 200 and 299  as accepted,
      left(r.content, 500)               as response_excerpt
    from net._http_response r
  $v$;

  execute 'revoke all on public.cron_dispatch_log from anon';
  execute 'grant select on public.cron_dispatch_log to authenticated';

  execute $c$
    comment on view public.cron_dispatch_log is
      'Réponses reçues par les tâches planifiées. ⚠️ Un 401 partout signifie que '
      'le secret ne correspond pas à CRON_SECRET de l''application ; une colonne '
      'vide signifie que rien n''est parti du tout. Les deux se ressemblent vues '
      'de l''écran Traitements, et ne se distinguent que d''ici.'
  $c$;
exception
  when others then
    raise notice 'pg_net absent (%). Vue cron_dispatch_log non créée.', sqlerrm;
end;
$$;

-- =============================================================================
-- SECTION 5 — VÉRIFICATION
--
-- ⚠️ La migration ÉCHOUE si le secret reste atteignable. Une correction de
-- sécurité qu'on croit appliquée est pire que pas de correction.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dispatch_cron_post')
  then
    raise exception 'public.dispatch_cron_post est absente.';
  end if;

  if has_function_privilege('authenticated', 'public.dispatch_cron_post(text)', 'execute') then
    raise exception
      'public.dispatch_cron_post reste exécutable par authenticated : elle lit le secret.';
  end if;

  if has_table_privilege('authenticated', 'public.cron_dispatch_config', 'select') then
    raise exception 'cron_dispatch_config est lisible par authenticated : le secret fuirait.';
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'cron_dispatch_config') then
    raise exception
      'cron_dispatch_config porte une policy : elle doit rester sans aucune, donc vide pour tous.';
  end if;

  /*
   * ⚠️ SANS pg_net, TOUT CE QUI PRÉCÈDE EST DÉCORATIF. Les tâches se planifient,
   * se listent, rassurent — et échouent à chaque déclenchement. La migration
   * doit s'arrêter ici plutôt que de livrer une automatisation qui n'émet rien.
   */
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception
      'pg_net absente : les tâches planifiées ne peuvent émettre aucun appel HTTP.';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron absente : rien ne déclenchera les tâches.';
  end if;

  if (select count(*) from cron.job
      where jobname in ('conformia-generate-occurrences', 'conformia-notifications')) <> 2
  then
    raise exception 'Les deux tâches réelles ne sont pas toutes planifiées.';
  end if;

  if exists (select 1 from cron.job
             where jobname in ('conformia-weekly-digest', 'conformia-backup',
                               'conformia-restore-test')) then
    raise exception
      'Une tâche fantôme subsiste : elle viserait une route inexistante et échouerait en 404.';
  end if;
end;
$$;
