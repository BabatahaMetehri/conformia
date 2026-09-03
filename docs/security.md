# Sécurité

Les documents suivis ici sont des déclarations fiscales, des données sociales et de
la correspondance administrative. L'ordre de priorité est arrêté et **non
négociable** (CLAUDE.md §1) : confidentialité, puis traçabilité, puis intégrité, puis
confort — jamais l'inverse.

## Modèle d'accès

### Trois dimensions, pas une

Un accès est accordé quand les trois se rencontrent :

1. **Le rôle** porte la permission (`role_permissions`).
2. **Le domaine** est atteignable (`user_roles.domain_id` ; `NULL` = tous les domaines).
3. **La ligne** passe la policy RLS de sa table.

Une seule des trois qui refuse suffit. C'est ce qui rend inoffensive une erreur
d'affichage : un bouton rendu à tort n'ouvre rien.

### Matrice rôle → permissions

> Arrêtée par la migration **0019**, où elle est écrite **une seule fois**, en
> `VALUES`. La base y est réconciliée : ce qui n'est pas dans la matrice est
> **retiré**, et la migration échoue si le résultat diffère de ce qui est déclaré.
> `tests/integration/authorization-model.test.ts` la compare **en entier** — pas
> par sondage, parce que c'est l'octroi _en trop_ qui est dangereux et que lui
> seul échappe à un test par échantillon.

`✓` accordée · `—` refusée · `ᶠ` limité au domaine FISCAL

| Permission            | ADMIN | DIRECTION | RESPONSABLE | SUPPLEANT | SUPERVISEUR | AUDITOR | EXTERNAL |
| --------------------- | :---: | :-------: | :---------: | :-------: | :---------: | :-----: | :------: |
| `obligation.read`     |   ✓   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    ✓ᶠ    |
| `referential.manage`  |   ✓   |     ✓     |      —      |     —     |      —      |    —    |    —     |
| `register.manage`     |   ✓   |     ✓     |      —      |     —     |      —      |    —    |    —     |
| `occurrence.read`     |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    ✓ᶠ    |
| `occurrence.write`    |   —   |     —     |      ✓      |     ✓     |      ✓      |    —    |    —     |
| `occurrence.assign`   |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `occurrence.submit`   |   —   |     —     |      ✓      |     ✓     |      ✓      |    —    |    —     |
| `occurrence.validate` |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `occurrence.mark_na`  |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `occurrence.unlock`   |   —   |     ✓     |      —      |     —     |      —      |    —    |    —     |
| `document.read`       |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    ✓ᶠ    |
| `document.upload`     |   —   |     —     |      ✓      |     ✓     |      ✓      |    —    |    ✓ᶠ    |
| `document.delete`     |   —   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `absence.manage`      |   ✓   |     ✓     |      —      |     —     |      ✓      |    —    |    —     |
| `audit.read`          |   ✓   |     ✓     |      —      |     —     |      —      |    ✓    |    —     |
| `user.manage`         |   ✓   |     —     |      —      |     —     |      —      |    —    |    —     |
| `role.manage`         |   ✓   |     —     |      —      |     —     |      —      |    —    |    —     |
| `settings.manage`     |   ✓   |     —     |      —      |     —     |      —      |    —    |    —     |
| `dashboard.view_all`  |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    —     |
| `export.generate`     |   —   |     ✓     |      ✓      |     ✓     |      ✓      |    ✓    |    —     |

**Portée.** RESPONSABLE, SUPPLEANT, SUPERVISEUR et DIRECTION sont **globaux** :
une seule personne suit l'ensemble des dossiers, tous domaines et tous registres.
Le mécanisme est par attribution (`user_roles.domain_id is null`), et aucun de ces
quatre rôles ne porte de domaine par défaut. Une attribution restreinte à un
domaine reste néanmoins possible — c'est par elle que la suite RLS _démontre_ le
cloisonnement, et l'interdire aurait supprimé le moyen de le prouver.

**Les cinq rôles par service** — `COMPTA_MANAGER`, `COMPTA_AGENT`, `RH_MANAGER`,
`RH_AGENT`, `REGLEMENTAIRE` — sont **désactivés** depuis 0018, pas supprimés :
`user_roles` et `audit_log` portent leurs identifiants, et l'historique doit
rester lisible. Un rôle inactif n'est plus attribuable ; il reste lisible.

#### Quatre décisions à ne pas « corriger »

- **`register.manage` est distincte de `referential.manage`.** Le référentiel
  décrit des obligations, les registres décrivent l'entreprise. Radier un registre
  **éteint la génération** de tous les dossiers qui en dépendent — ce n'est pas le
  même pouvoir que corriger le libellé d'une obligation.
- **SUPERVISEUR détient `occurrence.write`.** Il peut donc préparer en cas de
  nécessité, et la séparation des pouvoirs l'empêchera alors de valider **ce
  dossier-là** — c'est la DIRECTION qui validera. Le contrôle porte sur l'**acte**,
  pas sur le rôle.
- **DIRECTION n'a ni `user.manage` ni `role.manage`.** Le pouvoir métier ne
  s'attribue pas ses propres droits.
- **RESPONSABLE et SUPPLEANT sont rigoureusement identiques.** Ce qui les
  distingue est la **trace** (`occurrence_transitions.acted_as`), pas le droit. Une
  déclaration d'absence n'accorde et ne retire **aucun** droit : `is_absent_on()`
  n'est appelée par aucune politique, et un test le vérifie structurellement.

### Séparation des pouvoirs : le contrôle porte sur l'acte

Depuis 0019, la validation est refusée à quiconque a **préparé** le dossier.
Trois faits l'établissent, et le rôle porté n'en fait pas partie :

1. la personne en est le **responsable** (`owner_id`) ;
2. elle en est le **suppléant** (`deputy_id`) ;
3. elle y a **agi à ce titre** — une transition portant `acted_as` à `RESPONSABLE`
   ou `SUPPLEANT`. Changer de fonction n'efface pas ce qu'on a préparé.

Deux soupapes, inchangées : `app_settings.allow_self_validation` pour l'exception
générale, `obligation_types.allow_self_validation` pour la dérogation par
obligation.

La règle vit dans `self_validation_blocked()`, appliquée par le trigger
`trg_occurrences_25_separation_of_duties` — **c'est lui qui garantit**. La file de
validation et la barre d'actions ne font que ne pas proposer ce qu'il refusera.

### ⚠️ Pourquoi ADMIN n'a NI `occurrence.read` NI `document.read`

C'est la décision la plus contre-intuitive du modèle, et la plus importante.

Un administrateur technique gère des comptes, des rôles, des réglages et un
référentiel. Il n'a **aucune raison métier** de lire une déclaration de TVA ou un
bulletin de paie. Lui accorder ces permissions « parce qu'il est administrateur »
reviendrait à faire de la personne qui installe le logiciel la personne la mieux
informée de l'entreprise.

Les trois objections habituelles, et leurs réponses :

- **« Il en a besoin pour dépanner. »** Non : un incident se diagnostique avec
  `audit_log` — qui a fait quoi, quand, sur quelle entité — et avec l'identifiant de
  corrélation. Le CONTENU du dossier n'aide en rien à comprendre pourquoi une
  transition a été refusée.
- **« Il peut de toute façon lire la base. »** Avec un accès direct au serveur,
  oui — et c'est justement pourquoi cet accès est une procédure exceptionnelle, tracée,
  et non le fonctionnement quotidien d'un compte applicatif. La différence entre « ce
  serait techniquement possible » et « c'est accordé par défaut » est toute la
  différence en cas d'incident.
- **« Ça complique le support. »** Un peu. C'est le prix, il est bas, et il est
  assumé : la Direction et l'auditeur ont, eux, la lecture qui leur revient.

Ce cloisonnement est **éprouvé**, pas seulement écrit :
`e2e/critical-journeys.spec.ts` — parcours 5 — vérifie qu'un ADMIN connecté n'atteint
aucune occurrence, ni par la liste, ni par URL directe, ni par la route de
téléchargement.

## Row Level Security

**91 tables, 91 avec RLS activée.** Aucune exception, vérifiée par
`tests/integration/rls.test.ts` — qui échoue si une table apparaît sans policy.

Deux principes tiennent l'ensemble :

- **Une ligne interdite est indiscernable d'une ligne absente.** La RLS ne rend rien,
  et l'interface rend le même écran « Page introuvable » pour un dossier hors domaine
  et pour un identifiant inventé. Distinguer les deux permettrait d'énumérer les
  dossiers des autres domaines par simple différence de message. Vérifié par le
  parcours 4, qui compare les deux réponses.
- **Pas de policy `USING (true)`.** Une table sans besoin de restriction —
  `permissions`, `roles` — porte une policy explicite de lecture, jamais une porte
  ouverte.

⚠️ **Une limite connue, mesurée.** `obligation_occurrences_select` appelle des
fonctions `security definer` que PostgreSQL n'inline pas. Une tentative de
factorisation a fait passer un compteur de **92 ms à plus de 30 s**. Les corps sont
donc volontairement dupliqués, et un test de parité empêche qu'ils divergent. Voir
[decisions.md](./decisions.md).

## Documents

- **Bucket privé** (`compliance-documents`). Aucune URL publique n'existe.
- **URL signées de 300 s**, émises par `/api/documents/[id]/download` après
  authentification, vérification de permission ET accès à l'occurrence.
- **La journalisation précède l'émission**, dans la même transaction : si la trace ne
  peut pas s'écrire, aucune URL n'est délivrée. Une lecture invisible vaut moins
  qu'une lecture refusée.
- **Le chemin de stockage ne sort jamais** : ni dans la réponse, ni dans un en-tête.
- **Empreinte SHA-256 au dépôt**, versionnement, jamais d'écrasement en place.
- **Extensions bannies** : `svg`, `html`, `htm` compris — un SVG est un document XML
  qui peut porter un `<script>` et s'exécuterait avec nos cookies.

## Authentification

- **Mot de passe** : 12 caractères minimum, **aucune** exigence de composition, aucun
  renouvellement forcé. L'expiration périodique produit des variantes prévisibles où
  seul le dernier caractère change. Vérification contre les bases de mots de passe
  compromis assurée par Supabase.
- **Second facteur TOTP EXIGÉ** pour `ADMIN` et `DIRECTION` (`mfa_required_for()`), et
  généralisable par le réglage `require_mfa_all_users`.
  ⚠️ **`[auth.mfa.totp]` doit être activé côté Supabase.** Laissé à `false`, GoTrue
  refuse tout enrôlement et **tout compte administrateur est définitivement verrouillé
  hors de l'application**. Constaté sur la pile locale ; le réglage est désormais posé
  dans `supabase/config.toml` avec son avertissement.
- **Limitation des tentatives** : `is_auth_throttled()` compte les échecs par adresse
  électronique ET par IP sur 15 minutes. Un blocage est tracé comme un échec — une
  salve arrêtée est exactement ce qu'un auditeur doit pouvoir retrouver.
- **Réponse identique** sur adresse inconnue et mot de passe incorrect : sinon le
  formulaire devient un énumérateur de comptes.
- **Liste blanche d'adresses IP** applicable au seul rôle `ADMIN`.

## En-têtes HTTP

Posés par le middleware sur **chaque** réponse, vérifiés par `e2e/security.spec.ts` :

| En-tête                     | Valeur                                                   |
| --------------------------- | -------------------------------------------------------- |
| `Content-Security-Policy`   | `script-src` avec nonce par requête + `'strict-dynamic'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`           |
| `X-Frame-Options`           | `DENY`                                                   |
| `X-Content-Type-Options`    | `nosniff`                                                |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                        |
| `Permissions-Policy`        | caméra, micro, position, paiement, USB : tous refusés    |

### ⚠️ `style-src 'unsafe-inline'` — décision mesurée

`script-src` reste strict : nonce régénéré à chaque réponse (vérifié par un test),
`'strict-dynamic'`, **aucun** `'unsafe-inline'`.

`style-src`, lui, admet `'unsafe-inline'`. Avec un nonce, la politique bloque les
**attributs** `style="…"` rendus par le serveur — un nonce ne s'attache pas à un
attribut, et React sérialise `style={{…}}` exactement ainsi. Mesuré sur un dossier à
« 0 sur 2 » : `transform: translateX(-100%)` refusé, valeur calculée retombée à
`none`, **barre de complétude affichée pleine**. Chaque jauge de l'application
annonçait « complet » quelle que soit la réalité.

Ce que la tolérance coûte : une injection CSS devient possible _si_ une faille
d'injection existe par ailleurs. Elle n'exécute aucun script. Ce que le refus
coûtait : une information fausse, sur un outil de conformité, à l'endroit exact où
elle compte. Un test (`e2e/security.spec.ts`) relève désormais **zéro violation CSP**
sur les écrans de travail et vérifie qu'une jauge à zéro s'affiche vide.

## Limitation de débit des écritures

Posée dans le middleware, sur l'en-tête `next-action` : **toutes** les Server Actions
y passent, les soixante et une, sans qu'aucune ne soit modifiée — et surtout sans
qu'aucune ne soit oubliée.

- **60 écritures par minute et par utilisateur.** Calibré sur l'usage humain : l'écran
  le plus dense dépasse rarement la dizaine.
- **Le compteur vit en base** (`rate_limit_hits` + `consume_rate_limit()`). Un
  compteur en mémoire repart à zéro à chaque déploiement et ignore les autres
  instances : il ne limite rien tout en donnant l'impression du contraire.
- **Les lectures ne sont pas comptées.**
- ⚠️ **Les écritures anonymes non plus, et c'est délibéré.** Sans session, le seul
  sujet est l'adresse IP — or tout un bureau partage la sienne. Mesuré : une borne
  par IP a refusé la moitié des ouvertures de session de la suite de bout en bout,
  qui se connecte depuis une adresse unique. En production, c'est l'équipe bloquée à
  neuf heures. La connexion — seule écriture atteignable sans session — garde sa
  protection propre, par courriel ET par IP.
- **Échec ouvert** : si la base ne répond pas, l'écriture passe. Une limitation de
  débit protège de l'excès, pas de l'intrusion ; la faire échouer fermé
  transformerait un incident de base en indisponibilité totale.

## Expiration par inactivité

Trente minutes sans requête, et la session est fermée : redirection vers la connexion,
avec le chemin d'origine conservé pour y revenir après.

- Le marqueur est un cookie `httpOnly` ne portant **qu'un horodatage**, réécrit à
  chaque requête. Aucun script de page ne peut prolonger une session.
- Toute navigation compte comme activité, y compris le préchargement d'un lien — qui
  ne se produit que dans un onglet ouvert devant quelqu'un.

⚠️ **CE QUE CETTE MESURE PROTÈGE, ET CE QU'ELLE NE PROTÈGE PAS.** Elle ferme un poste
abandonné dans un bureau partagé — le risque réel de cette plateforme. Elle n'arrête
**pas** un vol de cookie : qui détient le cookie de session détient aussi celui-ci et
peut le réécrire. Prétendre le contraire serait se raconter une histoire ; c'est la
durée de vie du jeton Supabase et la révocation qui répondent à ce risque-là.

Trente minutes est un compromis assumé. Plus court, l'outil devient hostile : préparer
un dossier suppose de lire des pièces hors écran, de téléphoner à un organisme, de
chercher un justificatif. Plus long, un poste abandonné le reste jusqu'au lendemain.

## Clé `service_role`

Trois barrières, de la plus fiable à la moins fiable :

1. `import "server-only"` — casse le build si le module atteint un bundle client.
2. ESLint `no-restricted-imports` — interdit l'import hors de `src/server/jobs/`.
3. Garde d'exécution — marqueur `_job-context` posé par chaque job.

Usages autorisés, liste **fermée** : génération planifiée, notifications, purge de
rétention, sauvegardes, vérification d'intégrité, sonde de santé. Les routes qui en
ont besoin passent par un **import dynamique** du job, ce qui garde le module hors de
leur graphe statique — `/api/cron/generate` et `/api/health` suivent ce montage.

## Ce qui reste ouvert

- **Cinq vulnérabilités signalées par `npm audit`** — trois `high`, deux `moderate`.
  Aucune n'a de correctif applicable sans version majeure :

  | Paquet            | Gravité  | Atteignable ici ?                                                          | Correctif proposé          |
  | ----------------- | -------- | -------------------------------------------------------------------------- | -------------------------- |
  | `postcss`         | high     | Non — ne traite que nos feuilles, au moment du build, sans source distante | `next@16` (majeure)        |
  | `sharp` (libvips) | high     | Non — dépendance de `next/image`, employé nulle part, aucun motif distant  | `next@16` (majeure)        |
  | `next`            | high     | Agrégat des deux précédentes                                               | `next@16` (majeure)        |
  | `uuid` (v3/v5/v6) | moderate | Non — transitive d'`exceljs`, atteinte seulement en passant un tampon      | `exceljs@3` (rétrograde !) |
  | `exceljs`         | moderate | Idem                                                                       | `exceljs@3` (rétrograde !) |

  ⚠️ Le correctif proposé pour `exceljs` est une **version antérieure** à celle
  installée : npm propose ici de reculer, pas d'avancer. À reprendre à la publication
  d'un correctif réel. La montée en `next@16` est à traiter dans une fenêtre de
  maintenance dédiée — cf. [decisions.md](./decisions.md) §10.

- **`gitleaks` n'est pas installé** sur ce poste. Un relevé équivalent a été fait à la
  main sur les 479 fichiers suivis et sur l'historique : aucun jeton, aucune clé
  privée, aucune chaîne `eyJ…`. `.env*` est ignoré par git. L'outil reste à câbler en
  intégration continue.
- **Le second facteur n'est exigé que d'`ADMIN` et `DIRECTION`.** Le réglage
  `require_mfa_all_users` permet de le généraliser sans développement ; la décision
  revient à la Direction.
