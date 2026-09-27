-- =============================================================================
-- 0028 — CONSERVATION PAR EXERCICE : TROIS ANS EN LIGNE, LE RESTE EN ARCHIVE
--
-- ⚠️ CE QUI OCCUPE LA PLACE N'EST PAS CE QU'ON CROIT.
--
-- Une année d'activité produit quelques centaines de lignes de dossiers —
-- quelques dizaines de kilo-octets. Ce qui pèse, ce sont les PIÈCES JOINTES :
-- déclarations scannées, accusés, correspondance. Elles ne sont pas dans la base
-- mais dans le stockage objet, et `documents` n'en garde que la fiche : chemin,
-- empreinte, taille, auteur.
--
-- La conservation se joue donc sur le STOCKAGE, pas sur les lignes. Cette
-- migration outille exactement cela.
--
-- ⚠️ ET LES LIGNES, ELLES, NE SONT PAS SUPPRIMÉES. CLAUDE.md l'interdit sans
-- exception, et la raison tient ici plus qu'ailleurs : la fiche d'un document
-- porte son empreinte SHA-256 et son historique d'accès. La garder après avoir
-- retiré le fichier permet de dire « cette pièce a existé, voici sa signature,
-- elle est dans l'archive de tel jour ». La supprimer ferait disparaître la
-- preuve en même temps que l'objet — c'est-à-dire exactement ce qu'une
-- plateforme de conformité ne doit jamais faire.
--
-- ⚠️ TROIS ANS EN LIGNE N'EST PAS TROIS ANS DE CONSERVATION. Les obligations
-- comptables algériennes se conservent bien plus longtemps — `retention_years`
-- vaut dix par défaut sur chaque type d'obligation, et cette migration n'y
-- touche pas. Ce qui est borné à trois ans, c'est ce qui reste IMMÉDIATEMENT
-- CONSULTABLE. Au-delà, la pièce existe toujours : elle est dans une archive
-- chiffrée, et se remet en ligne en la restaurant.
-- =============================================================================

begin;

-- =============================================================================
-- SECTION 1 — LE RÉGLAGE
-- =============================================================================

insert into public.app_settings (key, value, description, value_type)
values (
  'retention_live_years',
  to_jsonb(3),
  'Nombre d''exercices clos gardés IMMÉDIATEMENT consultables, en plus de '
  'l''exercice courant. Au-delà, les pièces sont archivées hors ligne — leurs '
  'fiches, empreintes et traces d''accès restent en base.',
  'integer')
on conflict (key) do nothing;

-- =============================================================================
-- SECTION 2 — LA MARQUE D'ARCHIVAGE
--
-- ⚠️ DEUX COLONNES, ET LA SECONDE EST LA PLUS IMPORTANTE. Savoir qu'une pièce
-- est hors ligne ne sert à rien si l'on ne sait pas DANS QUELLE ARCHIVE elle se
-- trouve. Sans le lien vers la sauvegarde, retrouver un justificatif de 2023
-- supposerait de restaurer les archives une par une jusqu'à tomber dessus.
-- =============================================================================

alter table public.documents
  add column if not exists archived_offline_at timestamptz,
  add column if not exists archived_in_backup_id bigint references public.backup_runs(id);

comment on column public.documents.archived_offline_at is
  'Date à laquelle le FICHIER a été retiré du stockage après archivage. La fiche, '
  'elle, reste : empreinte, taille, auteur, historique d''accès. Nul si la pièce '
  'est toujours consultable en ligne.';
comment on column public.documents.archived_in_backup_id is
  'Archive contenant le fichier. ⚠️ Sans ce lien, retrouver une pièce ancienne '
  'supposerait de restaurer les archives une par une.';

create index if not exists documents_archived_offline_idx
  on public.documents (archived_in_backup_id)
  where archived_offline_at is not null;

-- =============================================================================
-- SECTION 3 — L'INVENTAIRE PAR EXERCICE
--
-- ⚠️ ON NE PURGE PAS CE QU'ON N'A PAS REGARDÉ. Cette vue répond, avant toute
-- décision : quelles années sont en ligne, combien de dossiers et de pièces
-- portent-elles, quel volume, et lesquelles dépassent la fenêtre de conservation.
-- =============================================================================

create or replace view public.exercise_inventory
with (security_invoker = true) as
with borne as (
  select
    extract(year from (now() at time zone 'Africa/Algiers'))::int as courante,
    coalesce(
      (select (value #>> '{}')::int from public.app_settings where key = 'retention_live_years'),
      3) as annees_en_ligne
)
select
  left(oc.period_key, 4)::int                                    as exercice,
  count(distinct oc.id)::int                                     as dossiers,
  count(d.id) filter (where d.deleted_at is null)::int           as pieces,
  count(d.id) filter (
    where d.deleted_at is null and d.archived_offline_at is null)::int as pieces_en_ligne,
  coalesce(sum(d.size_bytes) filter (
    where d.deleted_at is null and d.archived_offline_at is null), 0)::bigint as octets_en_ligne,
  -- Un exercice est « hors fenêtre » dès qu'il est plus vieux que la fenêtre.
  (left(oc.period_key, 4)::int < b.courante - b.annees_en_ligne)  as hors_fenetre,
  bool_and(d.archived_offline_at is not null)
    filter (where d.deleted_at is null)                          as entierement_archive
from public.obligation_occurrences oc
cross join borne b
left join public.documents d
  on d.occurrence_id = oc.id
where oc.deleted_at is null
  and oc.period_key ~ '^[0-9]{4}'
group by left(oc.period_key, 4)::int, b.courante, b.annees_en_ligne
order by 1 desc;

comment on view public.exercise_inventory is
  'Inventaire par exercice : dossiers, pièces, volume encore en ligne, et '
  'dépassement de la fenêtre de conservation. ⚠️ `octets_en_ligne` ne compte que '
  'les pièces dont le fichier est TOUJOURS dans le stockage : c''est la seule '
  'mesure qui dit ce qu''un archivage libérerait réellement.';

grant select on public.exercise_inventory to authenticated;

-- =============================================================================
-- SECTION 4 — MARQUER UN EXERCICE ARCHIVÉ
--
-- ⚠️ CETTE FONCTION NE SUPPRIME AUCUN FICHIER. Elle enregistre qu'ils l'ont été,
-- et REFUSE de le faire si l'archive invoquée n'est pas digne de confiance. Le
-- retrait des objets appartient au script d'exploitation, qui a seul accès au
-- stockage ; la base garde la mémoire et pose les conditions.
--
-- Trois conditions, et il faut les trois :
--   1. l'archive a RÉUSSI et elle est CHIFFRÉE ;
--   2. elle a été RELUE — une archive jamais restaurée n'est pas une archive,
--      c'est un fichier dont on espère qu'il s'ouvre ;
--   3. elle est POSTÉRIEURE à la dernière pièce de l'exercice, sans quoi elle ne
--      contient pas ce qu'on s'apprête à retirer.
--
-- La troisième est celle qu'on oublie, et c'est la seule dont l'oubli détruit
-- des données.
-- =============================================================================

create or replace function public.mark_exercise_archived(
  p_year int,
  p_backup_run_id bigint
)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  archive public.backup_runs%rowtype;
  derniere timestamptz;
  touchees int;
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Archivage refusé : settings.manage requis.' using errcode = '42501';
  end if;

  select * into archive from public.backup_runs where id = p_backup_run_id;
  if not found then
    raise exception 'Archive % introuvable.', p_backup_run_id;
  end if;

  if archive.status <> 'SUCCEEDED' then
    raise exception 'Archive % : statut %, une archive incomplète ne protège rien.',
      p_backup_run_id, archive.status;
  end if;

  if not coalesce(archive.encrypted, false) then
    raise exception
      'Archive % non chiffrée : elle contient des déclarations fiscales et des données sociales.',
      p_backup_run_id;
  end if;

  if not exists (
    select 1 from public.restore_tests rt
    where rt.backup_run_id = p_backup_run_id and rt.status = 'PASSED')
  then
    raise exception
      'Archive % jamais relue. Lancer « npm run restore:test » : une archive non '
      'restaurée est un fichier dont on espère qu''il s''ouvre.',
      p_backup_run_id;
  end if;

  select max(d.uploaded_at) into derniere
  from public.documents d
  join public.obligation_occurrences oc on oc.id = d.occurrence_id
  where left(oc.period_key, 4) = p_year::text
    and d.deleted_at is null;

  if derniere is not null and archive.finished_at < derniere then
    raise exception
      'Archive % close le %, alors que l''exercice % a reçu une pièce le %. '
      'Elle ne contient pas tout ce qui serait retiré.',
      p_backup_run_id, archive.finished_at, p_year, derniere;
  end if;

  update public.documents d
     set archived_offline_at = now(),
         archived_in_backup_id = p_backup_run_id
    from public.obligation_occurrences oc
   where oc.id = d.occurrence_id
     and left(oc.period_key, 4) = p_year::text
     and d.deleted_at is null
     and d.archived_offline_at is null;

  get diagnostics touchees = row_count;
  return touchees;
end;
$fn$;

comment on function public.mark_exercise_archived(int, bigint) is
  'Enregistre qu''un exercice a été archivé hors ligne. ⚠️ NE SUPPRIME RIEN — le '
  'retrait des objets appartient au script d''exploitation. Elle REFUSE une '
  'archive non chiffrée, jamais relue, ou antérieure à la dernière pièce de '
  'l''exercice : cette dernière condition est celle qu''on oublie, et la seule '
  'dont l''oubli détruit des données.';

revoke all on function public.mark_exercise_archived(int, bigint) from public, anon;
grant execute on function public.mark_exercise_archived(int, bigint) to authenticated;

-- =============================================================================
-- SECTION 5 — VÉRIFICATION
-- =============================================================================

do $$
begin
  if not exists (select 1 from public.app_settings where key = 'retention_live_years') then
    raise exception 'Réglage retention_live_years absent.';
  end if;

  if (select count(*) from public.exercise_inventory) is null then
    raise exception 'exercise_inventory ne répond pas.';
  end if;

  if has_function_privilege('anon', 'public.mark_exercise_archived(int, bigint)', 'execute') then
    raise exception 'mark_exercise_archived est appelable en anonyme.';
  end if;
end;
$$;

commit;
