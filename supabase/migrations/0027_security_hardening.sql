-- =============================================================================
-- 0027 — DURCISSEMENT : CE QUE LA RLS NE COUVRE PAS
--
-- ⚠️ CETTE MIGRATION NE CORRIGE PAS LA RLS, QUI EST SAINE. Vérifié sur le schéma
-- complet : zéro table sans RLS, zéro policy `using (true)`, zéro fonction
-- SECURITY DEFINER sans `search_path` figé, zéro bucket public, et aucune
-- lecture anonyme ne rend la moindre ligne.
--
-- Elle ferme deux portes que la RLS ne garde pas.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — LA SONDE DE SANTÉ N'EST PLUS PUBLIQUE
--
-- ⚠️ L'INTENTION ÉTAIT ÉCRITE, LE DROIT NE L'A JAMAIS SUIVIE.
-- `src/server/jobs/health-check.ts` affirme : « `health_snapshot()` est réservée
-- au rôle de service ». Elle ne l'était pas. Mesuré avec la seule clé publique,
-- sans aucune session :
--
--     POST /rest/v1/rpc/health_snapshot  →  200
--     {"database": true, "last_backup_at": …, "documents_total": …,
--      "failed_jobs_24h": …}
--
-- Ce n'est pas une donnée métier, et c'est pour cela que la fuite passait
-- inaperçue. Elle renseigne pourtant un attaquant sur la taille de
-- l'installation, sur l'état des tâches, et surtout sur la DATE DE LA DERNIÈRE
-- SAUVEGARDE — c'est-à-dire sur le moment où une destruction coûterait le plus.
--
-- La sonde est appelée par `createSupabaseAdminClient()`, donc sous le rôle de
-- service : lui retirer `anon` et `authenticated` ne change rien à son usage
-- légitime. `/api/health` continue de répondre, et son détail reste gardé par
-- `x-cron-secret` comme avant.
-- =============================================================================

revoke all on function public.health_snapshot() from anon, authenticated;

comment on function public.health_snapshot() is
  'État d''exploitation : base, stockage, sauvegardes, tâches. ⚠️ RÉSERVÉE AU '
  'RÔLE DE SERVICE, et le droit le dit désormais autant que le commentaire. '
  'Elle doit répondre quand l''authentification est en panne, d''où l''absence de '
  'contrôle de session À L''INTÉRIEUR — c''est le droit d''exécution qui garde la '
  'porte, et lui seul.';

-- =============================================================================
-- SECTION 2 — TRUNCATE RETIRÉ, PARCE QUE LA RLS NE L'ARRÊTE PAS
--
-- ⚠️ TRUNCATE N'EST PAS SOUMIS AUX POLICIES. `delete` passe par la RLS et ne
-- supprime que les lignes visibles ; `truncate` vide la table entière sans rien
-- consulter. Le droit était accordé à `anon` et `authenticated` sur 103 tables —
-- héritage du `grant all` que Supabase pose par défaut sur le schéma public.
--
-- Il n'est pas exploitable aujourd'hui : PostgREST n'expose que SELECT, INSERT,
-- UPDATE, DELETE et les fonctions. Aucun chemin applicatif n'émet de TRUNCATE.
-- Mais c'est précisément le genre de droit dont on découvre l'usage le jour où
-- un nouveau composant ouvre une connexion SQL directe — et il n'existe aucune
-- raison de le conserver.
--
-- ⚠️ ON NE RETIRE QUE `TRUNCATE`, `REFERENCES` ET `TRIGGER`. Retirer aussi
-- SELECT/INSERT/UPDATE/DELETE à `anon` serait tentant — aucune policy ne le vise,
-- donc il ne lit rien — mais ce serait déplacer la garde de la RLS vers les
-- droits, et faire échouer en « permission denied » ce qui échoue aujourd'hui en
-- « zéro ligne ». La RLS reste l'autorité ; on lui retire seulement ce qu'elle
-- ne sait pas arbitrer.
-- =============================================================================

do $$
declare
  t record;
begin
  /*
   * ⚠️ `relkind` PLUTÔT QUE `pg_tables`. Il faut couvrir les tables ordinaires
   * (r), les partitionnées (p) — `audit_log` en est une — et les vues
   * matérialisées (m), qui se truncatent aussi. Les vues simples n'en ont pas
   * besoin : on ne truncate pas une vue.
   */
  for t in
    select n.nspname as sch, c.relname as rel
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
  loop
    execute format(
      'revoke truncate, references, trigger on table %I.%I from anon, authenticated',
      t.sch, t.rel);
  end loop;
end;
$$;

/*
 * ⚠️ ET POUR LES TABLES À VENIR. Sans cette ligne, la prochaine migration qui
 * crée une table recevrait de nouveau le `grant all` par défaut, et le
 * durcissement ne vaudrait que pour l'existant — la pire forme de correction,
 * celle qu'on croit acquise.
 */
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- =============================================================================
-- SECTION 3 — VÉRIFICATION
--
-- ⚠️ La migration ÉCHOUE si une porte reste ouverte. Un durcissement qu'on croit
-- appliqué est pire qu'un durcissement absent : il fait cesser de vérifier.
-- =============================================================================

do $$
declare
  restants int;
begin
  if has_function_privilege('anon', 'public.health_snapshot()', 'execute')
     or has_function_privilege('authenticated', 'public.health_snapshot()', 'execute')
  then
    raise exception 'health_snapshot reste appelable sans le rôle de service.';
  end if;

  /*
   * Le contrôle ne regarde que les relations réellement truncatables. Compter
   * les vues ferait échouer la migration sur un droit sans effet — un contrôle
   * qui crie au loup finit par être contourné plutôt que compris.
   */
  select count(*)::int into restants
  from information_schema.role_table_grants g
  join pg_class c on c.relname = g.table_name
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
  where g.table_schema = 'public'
    and g.grantee in ('anon', 'authenticated')
    and g.privilege_type = 'TRUNCATE'
    and c.relkind in ('r', 'p', 'm');

  if restants > 0 then
    raise exception
      'TRUNCATE subsiste sur % table(s) : la RLS ne l''arrête pas.', restants;
  end if;
end;
$$;
