-- =============================================================================
-- RÉFÉRENTIEL AGROESPACE — 23 obligations, 4 domaines
-- =============================================================================
--
-- ⚠️ Les dates de ce référentiel sont des valeurs de départ à faire confirmer
-- par le cabinet comptable. État de la vérification :
--   CNAS-DAS    : CONFIRMÉ au 31 janvier (la valeur de départ, 31 mars, était fausse)
--   CASNOS      : paiement au 30 juin CONFIRMÉ. Une DÉCLARATION le précède,
--                 janvier ou février selon les sources — date NON confirmée,
--                 obligation volontairement non créée. Dernière question ouverte.
--   IBS-ACOMPTE : 20/03, 20/06, 20/11 retenus, non confirmés
-- Toutes ces valeurs sont modifiables dans l'interface, avec prévisualisation
-- immédiate des six prochaines échéances calculées.
--
-- =============================================================================
--
-- RÉ-EXÉCUTABLE. Chaque insertion porte un `on conflict do nothing` sur sa clé
-- naturelle. Rejouer ce fichier ne crée aucun doublon et ne modifie AUCUNE
-- valeur déjà en place : un référentiel ajusté par le cabinet ne doit pas être
-- réécrit par un `db:seed` lancé pour une autre raison.
--
-- Conséquence à connaître, et voulue : corriger une valeur ici ne suffira PAS à
-- la propager sur une base déjà semée. C'est le bon compromis — l'inverse
-- écraserait silencieusement le travail de quelqu'un.
--
-- =============================================================================

-- =============================================================================
-- 1. DOMAINES
--    Déjà posés par la migration 0001 ; répétés ici pour que ce fichier soit
--    lisible seul et exécutable sur une base partiellement remplie.
-- =============================================================================

insert into public.domains (code, label) values
  ('FISCAL',        'Fiscal'),
  ('SOCIAL',        'Social'),
  ('REGLEMENTAIRE', 'Réglementaire'),
  ('JURIDIQUE',     'Juridique')
on conflict (code) do nothing;

-- =============================================================================
-- 2. ORGANISMES DESTINATAIRES
-- =============================================================================

insert into public.authorities (code, name, portal_url, notes) values
  ('DGI',        'Direction générale des impôts',            'https://www.mfdgi.gov.dz',
   'Déclarations fiscales, télédéclaration via Jibaya''tic.'),
  ('CNAS',       'Caisse nationale des assurances sociales des travailleurs salariés',
   'https://www.cnas.dz', 'Déclarations de cotisations et mouvements de personnel.'),
  ('CASNOS',     'Caisse nationale de sécurité sociale des non-salariés',
   'https://www.casnos.com.dz', 'Cotisation du gérant non salarié.'),
  ('CNRC',       'Centre national du registre du commerce', 'https://sidjilcom.cnrc.dz',
   'Registre du commerce et dépôt des comptes sociaux.'),
  ('MADR',       'Ministère de l''Agriculture et du Développement rural', null,
   'Homologations et autorisations relatives aux intrants agricoles.'),
  ('ENV',        'Direction de l''Environnement de wilaya', null,
   'Établissements classés, études d''impact.'),
  ('INSP-TRAV',  'Inspection du travail', null,
   'Déclarations d''effectifs, contrôles du droit du travail.'),
  ('MED-TRAV',   'Organisme de médecine du travail', null,
   'Visites périodiques et aptitudes.'),
  ('BOAL',       'Bulletin officiel des annonces légales', null,
   'Publications légales.'),
  ('ORG-AGREE',  'Organismes de contrôle agréés', null,
   'Contrôles techniques réglementaires et analyses de laboratoire.'),
  ('ASSUREUR',   'Compagnie d''assurance', null,
   'Polices obligatoires : responsabilité civile, incendie, flotte.')
on conflict (code) do nothing;

-- =============================================================================
-- 3. SERVICES
-- =============================================================================

insert into public.departments (code, name) values
  ('DIRECTION',     'Direction générale'),
  ('COMPTABILITE',  'Comptabilité et finances'),
  ('RH',            'Ressources humaines'),
  ('REGLEMENTAIRE', 'Affaires réglementaires')
on conflict (entity_id, code) do nothing;

-- =============================================================================
-- 4. OBLIGATIONS — 23 lignes
--
-- ⚠️ VINGT-TROIS, pas vingt-deux. L'énoncé annonce « 22 obligations » mais en
-- énumère 23 : FISCAL 6, SOCIAL 6, RÉGLEMENTAIRE 6, JURIDIQUE 5. L'énumération
-- fait foi — c'est elle qui porte les règles. Sept sont ON_EVENT
-- (CNAS-MVT, ENGRAIS-AUT, AGR-SANIT, ETAB-CLASSE, RC-MAJ, BOAL, DIVERS) et ne
-- produisent aucune occurrence automatique ; seize sont générables.
--
-- ⚠️ AUCUNE règle d'échéance n'est écrite dans le code : tout est dans
-- `due_rule`. Ajouter une obligation reste une ligne de référentiel.
--
-- `generation_horizon_months` conserve son défaut de 18 mois : c'est l'horizon
-- que le générateur produira.
-- =============================================================================

insert into public.obligation_types (
  code, name, domain_id, authority_id, periodicity, due_rule,
  internal_lead_days, criticality, validation_levels, requires_proof,
  legal_basis, effective_from, scope
)
select
  v.code, v.name,
  (select id from public.domains where code = v.domain_code),
  (select id from public.authorities where code = v.authority_code),
  v.periodicity::public.periodicity,
  v.due_rule::jsonb,
  v.lead_days,
  v.criticality::public.criticality,
  v.validation_levels,
  v.requires_proof,
  v.legal_basis,
  date '2024-01-01',
  /*
   * ⚠️ PORTÉE DÉDUITE DU CODE, et non ajoutée à chacun des vingt-trois tuples.
   *
   * Quatre obligations sur vingt-trois se déclarent PAR REGISTRE : l'extrait du
   * registre lui-même, l'agrément sanitaire, l'établissement classé et les
   * contrôles techniques. Toutes les autres — G50, IBS, CNAS, CASNOS comprises —
   * se déclarent une seule fois pour l'entreprise entière.
   *
   * ⚠️ ENGRAIS-AUT reste ENTITY : l'homologation porte sur le PRODUIT, pas sur
   * l'établissement. À basculer depuis l'écran du référentiel si la réalité
   * administrative diffère, sans migration.
   *
   * ⚠️ Cette liste figure AUSSI dans la migration 0018, qui corrige les bases
   * déjà peuplées. Ce n'est pas une règle métier en double : ici on POSE la
   * valeur à la création, là-bas on RATTRAPE l'existant. Une migration est un
   * fait daté ; elle ne peut pas déléguer à un fichier qui évoluera après elle.
   */
  case
    when v.code in ('RC-MAJ', 'AGR-SANIT', 'ETAB-CLASSE', 'CTRL-TECH') then 'PER_REGISTER'
    else 'ENTITY'
  end
from (values

-- ── DOMAINE FISCAL — DGI ────────────────────────────────────────────────────

  ('G50', 'Déclaration mensuelle G50 (TVA, IRG/salaires, retenues à la source)',
   'FISCAL', 'DGI', 'MONTHLY',
   '{"anchor":"PERIOD_END","offset_days":20,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   7, 'CRITICAL', 2, true,
   'Code des impôts directs et taxes assimilées ; code des taxes sur le chiffre d''affaires.'),

  /*
   * ⚠️ RÈGLE CORRIGÉE PAR RAPPORT À L'ÉNONCÉ, ET IL FAUT LE SAVOIR.
   *
   * L'énoncé demande `{"anchor":"FIXED_DATE", "occurrences":[…]}` avec une
   * périodicité CUSTOM. Cette combinaison est REFUSÉE par les deux validateurs
   * du projet, pour trois raisons cumulées :
   *   • `FIXED_DATE` exige `fixed_month` et `fixed_day`, absents ici ;
   *   • `FIXED_DATE` n'est admis qu'avec ANNUAL ou BIENNIAL ;
   *   • `CUSTOM` n'admet que les ancres de période (PERIOD_START, PERIOD_END).
   * La contrainte `obligation_types_due_rule_valid` aurait rejeté l'insertion.
   *
   * L'INTENTION — trois acomptes par an, aux 20/03, 20/06 et 20/11 — est
   * exprimée ci-dessous dans la forme que le moteur accepte : une périodicité
   * CUSTOM dont chaque `occurrence` est une période d'UN JOUR, ancrée sur son
   * début, sans décalage. Le résultat calculé est exactement celui attendu.
   */
  ('IBS-ACOMPTE', 'Acomptes provisionnels IBS',
   'FISCAL', 'DGI', 'CUSTOM',
   '{"anchor":"PERIOD_START","offset_days":0,"occurrences":[{"month":3,"day":20},{"month":6,"day":20},{"month":11,"day":20}],"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   5, 'HIGH', 1, true,
   'Acomptes provisionnels de l''impôt sur les bénéfices des sociétés.'),

  ('IBS-BILAN', 'Bilan, liasse fiscale et déclaration annuelle IBS',
   'FISCAL', 'DGI', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":4,"fixed_day":30,"year_offset":1,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   15, 'CRITICAL', 2, true,
   'Déclaration annuelle des résultats ; liasse fiscale.'),

  ('DAS-FISC', 'Déclaration annuelle des traitements et salaires',
   'FISCAL', 'DGI', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":4,"fixed_day":30,"year_offset":1,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   7, 'HIGH', 1, true,
   'Déclaration annuelle des traitements, salaires et rémunérations versés.'),

  ('TAXE-FONC', 'Taxe foncière et taxe d''assainissement',
   'FISCAL', 'DGI', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":3,"fixed_day":31,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   3, 'MEDIUM', 1, true,
   'Taxe foncière sur les propriétés bâties ; taxe d''enlèvement des ordures ménagères.'),

  /*
   * Ancre sur l'EXPIRATION du titre, avec un décalage NÉGATIF : le
   * renouvellement se prépare 30 jours avant que l'attestation ne tombe. Les
   * deux reports sont en PREVIOUS_BUSINESS_DAY — repousser une échéance
   * préparatoire au-delà du terme la viderait de son sens.
   */
  ('ATT-FISC', 'Renouvellement de l''attestation de mise à jour fiscale',
   'FISCAL', 'DGI', 'ANNUAL',
   '{"anchor":"EXPIRY_DATE","offset_days":-30,"weekend_shift":"PREVIOUS_BUSINESS_DAY","holiday_shift":"PREVIOUS_BUSINESS_DAY"}',
   5, 'MEDIUM', 1, true,
   'Attestation de mise à jour fiscale, exigée pour les marchés et les crédits.'),

-- ── DOMAINE SOCIAL ──────────────────────────────────────────────────────────

  ('CNAS-DTS', 'Déclaration trimestrielle des salaires et cotisations CNAS',
   'SOCIAL', 'CNAS', 'QUARTERLY',
   '{"anchor":"PERIOD_END","offset_days":30,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   7, 'CRITICAL', 2, true,
   'Loi n° 83-14 relative aux obligations des assujettis en matière de sécurité sociale.'),

  -- CONFIRMÉ : 31 janvier, et non 31 mars. La valeur de départ était fausse de
  -- deux mois — dans le sens qui coûte, celui qui fait croire qu'il reste du temps.
  ('CNAS-DAS', 'Déclaration annuelle des salaires (DAS)',
   'SOCIAL', 'CNAS', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":1,"fixed_day":31,"year_offset":1,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   15, 'CRITICAL', 2, true,
   'Déclaration annuelle des salaires, à déposer le 31 janvier de l''année suivante.'),

  /*
   * ⚠️ CASNOS SE DÉDOUBLE : une DÉCLARATION, puis un PAIEMENT.
   *
   * Le 30 juin porte le PAIEMENT de la cotisation — c'est confirmé, et c'est ce
   * que cette ligne suit. Une DÉCLARATION la précède, en janvier ou en février
   * selon les sources ; sa date n'est pas établie, et elle n'est donc PAS créée
   * ici. Inventer une échéance réglementaire produirait un rappel au mauvais
   * moment et une pénalité au bon.
   *
   * Voir `docs/go-live.md`, section « Les échéances à confirmer » : c'est la
   * dernière question ouverte du référentiel.
   */
  ('CASNOS', 'Paiement de la cotisation annuelle CASNOS (gérant non salarié)',
   'SOCIAL', 'CASNOS', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":6,"fixed_day":30,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   7, 'HIGH', 1, true,
   'Paiement de la cotisation des travailleurs non salariés, au 30 juin. ⚠️ Une déclaration préalable existe (janvier ou février) : date non confirmée, obligation non créée.'),

  ('CNAS-MVT', 'Déclaration de mouvement de personnel (embauche, départ)',
   'SOCIAL', 'CNAS', 'ON_EVENT',
   '{"anchor":"EVENT_DATE","offset_days":10,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   3, 'HIGH', 1, true,
   'Déclaration d''affiliation ou de radiation dans les dix jours du mouvement.'),

  ('MED-TRAV', 'Visites médicales du travail périodiques',
   'SOCIAL', 'MED-TRAV', 'ANNUAL',
   '{"anchor":"PERIOD_END","offset_days":0,"weekend_shift":"PREVIOUS_BUSINESS_DAY","holiday_shift":"PREVIOUS_BUSINESS_DAY"}',
   15, 'MEDIUM', 1, true,
   'Loi n° 88-07 relative à l''hygiène, à la sécurité et à la médecine du travail.'),

  ('BILAN-SOC', 'Déclaration annuelle d''effectifs / bilan social',
   'SOCIAL', 'INSP-TRAV', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":1,"fixed_day":31,"year_offset":1,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   5, 'MEDIUM', 1, true,
   'Déclaration annuelle des effectifs auprès de l''inspection du travail.'),

-- ── DOMAINE RÉGLEMENTAIRE ───────────────────────────────────────────────────

  ('ENGRAIS-AUT', 'Renouvellement des autorisations et homologations d''engrais',
   'REGLEMENTAIRE', 'MADR', 'ON_EVENT',
   '{"anchor":"EXPIRY_DATE","offset_days":-90,"weekend_shift":"PREVIOUS_BUSINESS_DAY","holiday_shift":"PREVIOUS_BUSINESS_DAY"}',
   30, 'CRITICAL', 2, true,
   'Homologation des produits fertilisants et amendements.'),

  ('AGR-SANIT', 'Renouvellement de l''agrément sanitaire / autorisation d''exploitation',
   'REGLEMENTAIRE', 'MADR', 'ON_EVENT',
   '{"anchor":"EXPIRY_DATE","offset_days":-60,"weekend_shift":"PREVIOUS_BUSINESS_DAY","holiday_shift":"PREVIOUS_BUSINESS_DAY"}',
   30, 'HIGH', 1, true,
   'Agrément sanitaire des établissements de production.'),

  ('ETAB-CLASSE', 'Autorisation d''exploitation d''établissement classé',
   'REGLEMENTAIRE', 'ENV', 'ON_EVENT',
   '{"anchor":"EXPIRY_DATE","offset_days":-90,"weekend_shift":"PREVIOUS_BUSINESS_DAY","holiday_shift":"PREVIOUS_BUSINESS_DAY"}',
   30, 'HIGH', 1, true,
   'Réglementation des installations classées pour la protection de l''environnement.'),

  ('CTRL-TECH', 'Contrôles techniques réglementaires (électricité, incendie, pression)',
   'REGLEMENTAIRE', 'ORG-AGREE', 'ANNUAL',
   '{"anchor":"PERIOD_END","offset_days":0,"weekend_shift":"PREVIOUS_BUSINESS_DAY","holiday_shift":"PREVIOUS_BUSINESS_DAY"}',
   15, 'HIGH', 1, true,
   'Vérifications périodiques obligatoires des installations.'),

  ('ANALYSE-LOT', 'Analyses de conformité des lots (laboratoire agréé)',
   'REGLEMENTAIRE', 'ORG-AGREE', 'QUARTERLY',
   '{"anchor":"PERIOD_END","offset_days":15,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   5, 'MEDIUM', 1, true,
   'Contrôle de conformité des lots produits.'),

  ('ASSUR', 'Renouvellement des assurances obligatoires (RC, incendie, flotte)',
   'REGLEMENTAIRE', 'ASSUREUR', 'ANNUAL',
   '{"anchor":"EXPIRY_DATE","offset_days":-30,"weekend_shift":"PREVIOUS_BUSINESS_DAY","holiday_shift":"PREVIOUS_BUSINESS_DAY"}',
   15, 'HIGH', 1, true,
   'Assurances obligatoires : responsabilité civile, incendie, flotte automobile.'),

-- ── DOMAINE JURIDIQUE ───────────────────────────────────────────────────────

  ('AGO', 'Assemblée générale ordinaire d''approbation des comptes',
   'JURIDIQUE', 'CNRC', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":6,"fixed_day":30,"year_offset":1,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   30, 'CRITICAL', 1, true,
   'Code de commerce : approbation annuelle des comptes par l''assemblée.'),

  ('CPT-SOCIAUX', 'Dépôt des comptes sociaux au CNRC',
   'JURIDIQUE', 'CNRC', 'ANNUAL',
   '{"anchor":"FIXED_DATE","fixed_month":7,"fixed_day":31,"year_offset":1,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   15, 'CRITICAL', 2, true,
   'Dépôt des comptes sociaux au registre du commerce, dans le mois de l''assemblée.'),

  ('RC-MAJ', 'Mise à jour ou renouvellement du registre du commerce',
   'JURIDIQUE', 'CNRC', 'ON_EVENT',
   '{"anchor":"EVENT_DATE","offset_days":30,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   10, 'HIGH', 1, true,
   'Modification statutaire, changement d''activité, transfert de siège.'),

  ('BOAL', 'Publication d''annonce légale',
   'JURIDIQUE', 'BOAL', 'ON_EVENT',
   '{"anchor":"EVENT_DATE","offset_days":30,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   5, 'LOW', 1, true,
   'Publicité légale des décisions sociales.'),

  ('DIVERS', 'Demande ou démarche administrative ponctuelle',
   'JURIDIQUE', null, 'ON_EVENT',
   '{"anchor":"EVENT_DATE","offset_days":30,"weekend_shift":"NEXT_BUSINESS_DAY","holiday_shift":"NEXT_BUSINESS_DAY"}',
   0, 'LOW', 1, false,
   'Fourre-tout assumé : toute démarche sans obligation périodique dédiée.')

) as v(code, name, domain_code, authority_code, periodicity, due_rule,
       lead_days, criticality, validation_levels, requires_proof, legal_basis)
on conflict (entity_id, code) do nothing;

-- =============================================================================
-- 5. DÉPENDANCES
--
-- ⚠️ Posées APRÈS l'insertion : `depends_on_obligation_type_id` pointe vers la
-- même table, et une auto-référence ne peut pas se résoudre dans le même INSERT.
--
-- Chaîne : CPT-SOCIAUX → AGO → IBS-BILAN. On ne dépose pas les comptes sociaux
-- avant que l'assemblée ne les ait approuvés, et l'assemblée ne peut approuver
-- que des comptes déjà arrêtés.
--
-- ⚠️ La dépendance INFORME, elle ne BLOQUE PAS : la fiche d'occurrence affiche
-- un bandeau signalant que l'obligation dont elle dépend n'est pas close, et
-- rien de plus. Une chaîne bloquante immobiliserait un dépôt légal pour une
-- raison interne, ce qui coûterait plus cher que le désordre qu'elle évite.
-- =============================================================================

update public.obligation_types
set depends_on_obligation_type_id = (select id from public.obligation_types where code = 'IBS-BILAN')
where code = 'AGO' and depends_on_obligation_type_id is null;

update public.obligation_types
set depends_on_obligation_type_id = (select id from public.obligation_types where code = 'AGO')
where code = 'CPT-SOCIAUX' and depends_on_obligation_type_id is null;

-- =============================================================================
-- 6. PIÈCES REQUISES
--
-- ⚠️ `order_index` est la clé d'unicité avec l'obligation : c'est elle qui rend
-- ce bloc ré-exécutable. Elle fixe aussi l'ordre d'affichage de la liste de
-- contrôle, donc l'ordre dans lequel l'agent constitue son dossier.
-- =============================================================================

insert into public.obligation_required_documents
  (obligation_type_id, label, is_mandatory, document_kind, order_index)
select
  (select id from public.obligation_types where code = v.obligation_code),
  v.label, v.is_mandatory, v.document_kind, v.order_index
from (values

  -- G50
  ('G50', 'Déclaration G50 remplie',            true,  'JUSTIFICATIF',  1),
  ('G50', 'Justificatif de paiement',           true,  'JUSTIFICATIF',  2),
  ('G50', 'Accusé de télédéclaration',          true,  'PREUVE_DEPOT',  3),
  ('G50', 'Journal des ventes',                 false, 'ANNEXE',        4),

  -- CNAS-DTS
  ('CNAS-DTS', 'Bordereau de déclaration',          true, 'JUSTIFICATIF', 1),
  ('CNAS-DTS', 'État nominatif des salaires',       true, 'JUSTIFICATIF', 2),
  ('CNAS-DTS', 'Justificatif de versement',         true, 'JUSTIFICATIF', 3),
  ('CNAS-DTS', 'Accusé de dépôt',                   true, 'PREUVE_DEPOT', 4),

  -- IBS-BILAN
  ('IBS-BILAN', 'Bilan comptable',                       true,  'JUSTIFICATIF', 1),
  ('IBS-BILAN', 'Compte de résultat',                    true,  'JUSTIFICATIF', 2),
  ('IBS-BILAN', 'Liasse fiscale complète',               true,  'JUSTIFICATIF', 3),
  ('IBS-BILAN', 'Rapport du commissaire aux comptes',    false, 'ANNEXE',       4),
  ('IBS-BILAN', 'Accusé de dépôt',                       true,  'PREUVE_DEPOT', 5),

  -- CNAS-DAS
  ('CNAS-DAS', 'État récapitulatif annuel', true, 'JUSTIFICATIF', 1),
  ('CNAS-DAS', 'États nominatifs',          true, 'JUSTIFICATIF', 2),
  ('CNAS-DAS', 'Accusé de dépôt',           true, 'PREUVE_DEPOT', 3),

  -- ENGRAIS-AUT
  ('ENGRAIS-AUT', 'Demande de renouvellement',        true, 'JUSTIFICATIF', 1),
  ('ENGRAIS-AUT', 'Fiches techniques produits',       true, 'JUSTIFICATIF', 2),
  ('ENGRAIS-AUT', 'Analyses de laboratoire',          true, 'JUSTIFICATIF', 3),
  ('ENGRAIS-AUT', 'Autorisation précédente',          true, 'JUSTIFICATIF', 4),
  ('ENGRAIS-AUT', 'Justificatif de redevance',        true, 'JUSTIFICATIF', 5),
  ('ENGRAIS-AUT', 'Nouvelle autorisation délivrée',   true, 'PREUVE_DEPOT', 6),

  -- CPT-SOCIAUX
  ('CPT-SOCIAUX', 'PV d''assemblée générale', true, 'JUSTIFICATIF', 1),
  ('CPT-SOCIAUX', 'Comptes sociaux',          true, 'JUSTIFICATIF', 2),
  ('CPT-SOCIAUX', 'Rapport de gestion',       true, 'JUSTIFICATIF', 3),
  ('CPT-SOCIAUX', 'Récépissé CNRC',           true, 'PREUVE_DEPOT', 4)

) as v(obligation_code, label, is_mandatory, document_kind, order_index)
on conflict (obligation_type_id, order_index) do nothing;

/*
 * Les seize autres obligations reçoivent le minimum : un dossier et une preuve.
 *
 * ⚠️ Écrit en SELECT plutôt qu'en liste : ces deux lignes sont les mêmes pour
 * toutes, et les énumérer trente-deux fois inviterait à en oublier une le jour
 * où une obligation s'ajoute. La clause `not exists` garde le bloc
 * ré-exécutable ET l'empêche d'écraser une liste déjà détaillée à la main.
 */
insert into public.obligation_required_documents
  (obligation_type_id, label, is_mandatory, document_kind, order_index)
select ot.id, 'Dossier constitué', true, 'JUSTIFICATIF', 1
from public.obligation_types ot
-- ⚠️ Portée EXPLICITE : un seed ne touche que les obligations qu'il déclare.
-- Un `not in (…)` aurait aussi attrapé `SYS-HOLIDAYS`, créée par la tâche de
-- maintenance du calendrier, qui n'a rien à faire ici.
where true
  and ot.code in (
    'IBS-ACOMPTE', 'DAS-FISC', 'TAXE-FONC', 'ATT-FISC',
    'CASNOS', 'CNAS-MVT', 'MED-TRAV', 'BILAN-SOC',
    'AGR-SANIT', 'ETAB-CLASSE', 'CTRL-TECH', 'ANALYSE-LOT', 'ASSUR',
    'AGO', 'RC-MAJ', 'BOAL', 'DIVERS'
  )
  and not exists (
    select 1 from public.obligation_required_documents rd
    where rd.obligation_type_id = ot.id
  )
on conflict (obligation_type_id, order_index) do nothing;

-- La preuve de dépôt n'est posée que là où elle sera EXIGÉE : `requires_proof`
-- conditionne le passage au statut « déposé », et réclamer une pièce qui ne
-- bloque rien apprend à ignorer les listes de contrôle.
insert into public.obligation_required_documents
  (obligation_type_id, label, is_mandatory, document_kind, order_index)
select ot.id, 'Preuve de dépôt', true, 'PREUVE_DEPOT', 2
from public.obligation_types ot
where true
  and ot.code in (
    'IBS-ACOMPTE', 'DAS-FISC', 'TAXE-FONC', 'ATT-FISC',
    'CASNOS', 'CNAS-MVT', 'MED-TRAV', 'BILAN-SOC',
    'AGR-SANIT', 'ETAB-CLASSE', 'CTRL-TECH', 'ANALYSE-LOT', 'ASSUR',
    'AGO', 'RC-MAJ', 'BOAL', 'DIVERS'
  )
  and ot.requires_proof
  and not exists (
    select 1 from public.obligation_required_documents rd
    where rd.obligation_type_id = ot.id and rd.order_index = 2
  )
on conflict (obligation_type_id, order_index) do nothing;

-- =============================================================================
-- 7. JOURS FÉRIÉS
--
-- ⚠️ FÊTES CIVILES À DATE FIXE UNIQUEMENT, injectées comme récurrentes.
--
-- Les fêtes RELIGIEUSES — Aïd el-Fitr, Aïd el-Adha, Awal Moharem, Achoura,
-- Mawlid Ennabaoui — suivent le calendrier hégirien et sont fixées CHAQUE ANNÉE
-- PAR DÉCRET. Elles ne peuvent donc pas être calculées : les calculer
-- reviendrait à inventer une règle réglementaire, et les figer serait pire
-- puisque l'erreur passerait inaperçue.
--
-- Elles sont saisies à la main par l'administrateur, dans
-- /admin/referentials. Le système lui-même le lui rappelle : la tâche
-- `holiday-calendar-reminder` crée chaque 1er décembre une occurrence
-- « Mise à jour du calendrier des jours fériés N+1 ».
--
-- L'année portée par `holiday_date` n'a pas d'importance pour une ligne
-- récurrente : seuls le mois et le jour font foi.
-- =============================================================================

insert into public.holidays (holiday_date, label, is_recurring, source) values
  (date '2026-01-01', 'Nouvel an',                     true, 'Fête civile à date fixe'),
  (date '2026-01-12', 'Yennayer — nouvel an amazigh',  true, 'Fête civile à date fixe'),
  (date '2026-05-01', 'Fête du Travail',               true, 'Fête civile à date fixe'),
  (date '2026-07-05', 'Fête de l''Indépendance',       true, 'Fête civile à date fixe'),
  (date '2026-11-01', 'Anniversaire de la Révolution', true, 'Fête civile à date fixe')
on conflict (holiday_date) do nothing;
