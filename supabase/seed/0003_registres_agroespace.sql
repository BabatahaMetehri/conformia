-- =============================================================================
-- 0003 — REGISTRES DE COMMERCE AGROESPACE
--
-- Transcription de la liste fournie par l'administration (note manuscrite du
-- 27 septembre 2026). Elle remplace le registre fictif « À COMPLÉTER » posé par
-- 0018 pour que l'installation ne parte pas sans aucun établissement.
--
-- ⚠️ CE QUE LA SAISIE D'UN REGISTRE DÉCLENCHE, ET CE QU'ELLE NE DÉCLENCHE PAS.
--
-- Les 19 obligations de portée ENTITY — G50, IBS, CNAS, CASNOS, bilan — se
-- déclarent UNE SEULE FOIS pour l'entreprise : un seul NIF, une seule
-- déclaration. Ajouter des registres ne les multiplie pas.
--
-- Les 4 obligations de portée PER_REGISTER, en revanche, produisent un dossier
-- PAR REGISTRE ACTIF :
--
--     AGR-SANIT     agrément sanitaire / autorisation d'exploitation
--     CTRL-TECH     contrôles techniques (électricité, incendie, pression)
--     ETAB-CLASSE   autorisation d'établissement classé
--     RC-MAJ        mise à jour / renouvellement du registre
--
-- Cinq registres actifs valent donc 20 dossiers par cycle sur ces quatre-là, au
-- lieu de 4. ⚠️ Un registre saisi en trop est une colonne de dossiers en trop,
-- tous les ans — et chacun réclamera une pièce que personne ne pourra fournir.
-- Ne laisser ACTIF que ce qui est réellement exploité.
--
-- ⚠️ TROIS POINTS RESTENT À CONFIRMER, ET ILS SONT MARQUÉS « À CONFIRMER »
-- ci-dessous. Tant qu'ils le sont, ce fichier décrit ce qui a été LU sur la
-- note, pas ce qui a été vérifié :
--
--   1. le numéro du deuxième registre d'El Meniaa (chiffre illisible) ;
--   2. lequel des cinq est le registre PRINCIPAL ;
--   3. les dates de délivrance et d'expiration, absentes de la note.
--
-- La date d'expiration n'est pas un détail de confort : c'est elle que lit le
-- calcul d'échéance de RC-MAJ. Sans elle, l'obligation de renouvellement ne
-- produit aucun dossier — silencieusement.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Le registre fictif d'amorçage s'en va.
--
-- Suppression PHYSIQUE et non `deleted_at` : il n'a jamais porté de dossier, et
-- ce n'est pas une donnée métier mais un bouchon d'installation. La règle du
-- « jamais de suppression physique » protège l'historique réel ; il n'y en a
-- aucun ici.
-- -----------------------------------------------------------------------------

delete from public.commercial_registers cr
where cr.rc_number = 'À COMPLÉTER'
  and not exists (
    select 1 from public.obligation_occurrences oc
    where oc.commercial_register_id = cr.id);

-- -----------------------------------------------------------------------------
-- Les cinq registres
--
-- ⚠️ `register_type` : UN SEUL PRINCIPAL ACTIF est permis — un index unique
-- partiel l'impose (`commercial_registers_single_principal_idx`). 58/00 est
-- retenu comme principal parce que c'est le plus ancien numéro de la liste,
-- ce qui est une DÉDUCTION et non une information de la note. Si le principal
-- est un autre, échanger les deux valeurs `register_type` avant d'appliquer :
-- l'index refusera deux principaux actifs.
--
-- Les wilayas sont déduites du préfixe, qui est le code de wilaya :
--     58 → El Meniaa      01 → Adrar      47 → Ghardaïa
-- -----------------------------------------------------------------------------

insert into public.commercial_registers
  (entity_id, rc_number, register_type, label, wilaya, status, notes)
values
  ('00000000-0000-0000-0000-000000000001', '58/00', 'PRINCIPAL',
   'El Meniaa — registre 58/00', 'El Meniaa', 'ACTIF',
   'Transcrit de la note d''administration du 27/09/2026. Type PRINCIPAL déduit, à confirmer.'),

  -- ⚠️ À CONFIRMER : deuxième chiffre illisible sur la note. Lu « 58/02 »,
  -- pourrait être 58/03. Corriger AVANT la première génération : le numéro d'un
  -- registre figure sur les dossiers qu'il produit.
  ('00000000-0000-0000-0000-000000000001', '58/02', 'SECONDAIRE',
   'El Meniaa — registre 58/02', 'El Meniaa', 'ACTIF',
   '⚠️ Numéro À CONFIRMER : deuxième chiffre illisible sur la note manuscrite.'),

  ('00000000-0000-0000-0000-000000000001', '58/04', 'SECONDAIRE',
   'El Meniaa — registre 58/04', 'El Meniaa', 'ACTIF',
   'Transcrit de la note d''administration du 27/09/2026.'),

  ('00000000-0000-0000-0000-000000000001', '01/07', 'SECONDAIRE',
   'Adrar — registre 01/07', 'Adrar', 'ACTIF',
   'Transcrit de la note d''administration du 27/09/2026.'),

  ('00000000-0000-0000-0000-000000000001', '47/06', 'SECONDAIRE',
   'Ghardaïa — registre 47/06', 'Ghardaïa', 'ACTIF',
   'Transcrit de la note d''administration du 27/09/2026.')

on conflict (entity_id, rc_number) do update
  set register_type = excluded.register_type,
      label         = excluded.label,
      wilaya        = excluded.wilaya,
      status        = excluded.status,
      notes         = excluded.notes,
      updated_at    = now();

-- -----------------------------------------------------------------------------
-- Contrôle
--
-- ⚠️ Le seed ÉCHOUE plutôt que de laisser une liste incomplète. Un registre
-- manquant ne produit aucune erreur à l'usage : seulement des dossiers qui
-- n'existent pas, pour un établissement dont personne ne se souvient qu'il
-- devait en avoir.
-- -----------------------------------------------------------------------------

do $$
declare
  actifs int;
  principaux int;
begin
  select count(*) into actifs
  from public.commercial_registers
  where status = 'ACTIF' and deleted_at is null;

  select count(*) into principaux
  from public.commercial_registers
  where register_type = 'PRINCIPAL' and status = 'ACTIF' and deleted_at is null;

  if actifs <> 5 then
    raise exception 'Registres actifs : % au lieu des 5 de la note.', actifs;
  end if;

  if principaux <> 1 then
    raise exception 'Registres principaux actifs : %, un seul est permis.', principaux;
  end if;

  raise notice
    'Registres AGROESPACE : 5 actifs. ⚠️ Restent à renseigner les dates '
    'd''expiration — sans elles, RC-MAJ ne produit aucun dossier de '
    'renouvellement, et son silence ressemble à une absence d''échéance.';
end;
$$;

commit;
