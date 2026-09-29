-- =============================================================================
-- 0003 — REGISTRES DE COMMERCE AGROESPACE
--
-- Liste confirmée par l'administration le 29/09/2026 :
--
--     58/00   principal
--     58/01   service
--     58/04   importation      expire le 27/11/2027
--     47/06   irrigation
--     01/07   adrar
--
-- Elle remplace le registre fictif « À COMPLÉTER » posé par 0018.
--
-- ⚠️ CE QUE LA SAISIE D'UN REGISTRE DÉCLENCHE, ET CE QU'ELLE NE DÉCLENCHE PAS.
--
-- Les 19 obligations de portée ENTITY — G50, IBS, CNAS, CASNOS, bilan — se
-- déclarent UNE SEULE FOIS pour l'entreprise : un seul NIF, une seule
-- déclaration. Ajouter des registres ne les multiplie pas.
--
-- Les 4 obligations de portée PER_REGISTER produisent un dossier PAR REGISTRE
-- ACTIF :
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
-- ⚠️ DEUX POINTS RESTENT OUVERTS, et ils sont de nature différente :
--
--   1. LES QUATRE DATES D'EXPIRATION MANQUANTES. Seul 58/04 en porte une. Ce
--      n'est pas un détail de confort : `AGR-SANIT` et `ETAB-CLASSE` sont
--      ancrées sur `EXPIRY_DATE`, et un registre sans date ne produit AUCUN
--      dossier de renouvellement — mesuré, zéro. Ce zéro ressemble exactement à
--      « rien à faire ».
--
--   2. SECONDAIRE ou ANNEXE ? La note ne le dit pas, et les quatre non-principaux
--      sont donc posés en SECONDAIRE. La distinction est INFORMATIVE : la
--      génération ne regarde que `status = 'ACTIF'`. La corriger à l'écran
--      Registres ne déplace aucun dossier.
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
-- CORRECTION DE TRANSCRIPTION : 58/02 → 58/01
--
-- ⚠️ UN RENOMMAGE, PAS UN REMPLACEMENT, ET LA DIFFÉRENCE COMPTE.
--
-- Le deuxième chiffre était illisible sur la note manuscrite ; il avait été lu
-- « 58/02 ». L'administration confirme 58/01. C'est le MÊME établissement : on
-- corrige son numéro en place, la ligne garde son identifiant, et les dossiers
-- déjà générés pour lui le suivent.
--
-- Insérer 58/01 et supprimer 58/02 aurait au contraire orphelin les dossiers
-- existants — ou, pire, échoué sur la clé étrangère en laissant les deux numéros
-- dans la liste.
-- -----------------------------------------------------------------------------

update public.commercial_registers
   set rc_number  = '58/01',
       updated_at = now()
 where entity_id = '00000000-0000-0000-0000-000000000001'
   and rc_number = '58/02'
   and not exists (
     select 1 from public.commercial_registers autre
     where autre.entity_id = '00000000-0000-0000-0000-000000000001'
       and autre.rc_number = '58/01');

-- -----------------------------------------------------------------------------
-- Les cinq registres
--
-- ⚠️ `register_type` : UN SEUL PRINCIPAL ACTIF est permis — un index unique
-- partiel l'impose (`commercial_registers_single_principal_idx`). 58/00 est
-- confirmé principal par l'administration.
--
-- Les wilayas sont déduites du préfixe, qui est le code de wilaya :
--     58 → El Meniaa      47 → Ghardaïa      01 → Adrar
-- -----------------------------------------------------------------------------

insert into public.commercial_registers
  (entity_id, rc_number, register_type, label, activity_label, wilaya, status, expires_at, notes)
values
  ('00000000-0000-0000-0000-000000000001', '58/00', 'PRINCIPAL',
   'Registre principal', 'Principal', 'El Meniaa', 'ACTIF', null,
   'Confirmé par l''administration le 29/09/2026. ⚠️ Date d''expiration à renseigner.'),

  ('00000000-0000-0000-0000-000000000001', '58/01', 'SECONDAIRE',
   'Service', 'Service', 'El Meniaa', 'ACTIF', null,
   'Confirmé par l''administration le 29/09/2026. ⚠️ Date d''expiration à renseigner.'),

  ('00000000-0000-0000-0000-000000000001', '58/04', 'SECONDAIRE',
   'Importation', 'Importation', 'El Meniaa', 'ACTIF', date '2027-11-27',
   'Confirmé par l''administration le 29/09/2026, expiration comprise.'),

  ('00000000-0000-0000-0000-000000000001', '47/06', 'SECONDAIRE',
   'Irrigation', 'Irrigation', 'Ghardaïa', 'ACTIF', null,
   'Confirmé par l''administration le 29/09/2026. ⚠️ Date d''expiration à renseigner.'),

  ('00000000-0000-0000-0000-000000000001', '01/07', 'SECONDAIRE',
   'Adrar', 'Adrar', 'Adrar', 'ACTIF', null,
   'Confirmé par l''administration le 29/09/2026. ⚠️ Date d''expiration à renseigner.')

on conflict (entity_id, rc_number) do update
  set register_type  = excluded.register_type,
      label          = excluded.label,
      activity_label = excluded.activity_label,
      wilaya         = excluded.wilaya,
      status         = excluded.status,
      /*
       * ⚠️ `coalesce` DANS CE SENS, ET C'EST LE POINT DÉLICAT DU FICHIER.
       *
       * Le seed REMPLIT une date d'expiration, il n'en efface jamais une. Quatre
       * des cinq registres arrivent ici avec `null` ; écrire `excluded.expires_at`
       * tel quel effacerait les dates que quelqu'un aurait saisies à l'écran
       * Registres, au prochain `npm run db:seed`.
       *
       * Et l'effacement serait MUET : les renouvellements cesseraient simplement
       * d'être générés, ce qui ressemble à « rien à renouveler ».
       */
      expires_at     = coalesce(excluded.expires_at, public.commercial_registers.expires_at),
      notes          = excluded.notes,
      updated_at     = now();

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
  ancien int;
  sans_expiration int;
begin
  select count(*) into actifs
  from public.commercial_registers
  where status = 'ACTIF' and deleted_at is null;

  select count(*) into principaux
  from public.commercial_registers
  where register_type = 'PRINCIPAL' and status = 'ACTIF' and deleted_at is null;

  select count(*) into ancien
  from public.commercial_registers
  where rc_number = '58/02';

  select count(*) into sans_expiration
  from public.commercial_registers
  where status = 'ACTIF' and deleted_at is null and expires_at is null;

  if actifs <> 5 then
    raise exception 'Registres actifs : % au lieu des 5 confirmés.', actifs;
  end if;

  if principaux <> 1 then
    raise exception 'Registres principaux actifs : %, un seul est permis.', principaux;
  end if;

  if ancien > 0 then
    raise exception
      'Le numéro 58/02 subsiste : le renommage vers 58/01 n''a pas eu lieu, et la '
      'liste porte un registre de trop.';
  end if;

  /*
   * ⚠️ UN AVERTISSEMENT, PAS UN REFUS. Faire échouer le seed sur une date
   * manquante empêcherait d'installer la plateforme tant que l'administration
   * n'a pas tout fourni — et l'on s'en passerait en retirant le contrôle. On
   * annonce le nombre exact, à chaque exécution, pour que l'attente reste
   * visible sans être bloquante.
   */
  if sans_expiration > 0 then
    raise notice
      'Registres AGROESPACE : 5 actifs, dont % SANS date d''expiration. '
      'À saisir à l''écran Registres dès réception. ⚠️ Elles ne changeront rien '
      'tant qu''AGR-SANIT et ETAB-CLASSE resteront ON_EVENT : ces obligations ne '
      'sont jamais générées d''office. Voir docs/go-live.md § B.2.',
      sans_expiration;
  else
    raise notice 'Registres AGROESPACE : 5 actifs, toutes les expirations renseignées.';
  end if;
end;
$$;

commit;
