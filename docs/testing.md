# Tests

Quatre suites. Chacune garantit quelque chose que les autres ne peuvent pas garantir,
et **aucune ne suffit seule**. Ce document dit laquelle répond à quelle question — et
ce qu'aucune ne couvre.

## Ce que chaque suite établit

| Suite                       | Commande           | Ce qu'elle établit                                          |
| --------------------------- | ------------------ | ----------------------------------------------------------- |
| Unitaire (Vitest)           | `npm test`         | Les modules PURS calculent juste                            |
| Propriété (fast-check)      | incluse ci-dessus  | Ce qui doit rester vrai POUR TOUTE entrée                   |
| Intégration (Vitest + `pg`) | `npm run test:rls` | La RLS, les triggers et les fonctions SQL refusent vraiment |
| Bout en bout (Playwright)   | `npm run test:e2e` | Les écrans, enchaînés, font ce qu'ils promettent            |

État au dernier relevé : **582 tests unitaires**, **120 tests de bout en bout** sur
deux moteurs, aucun ignoré.

## Unitaire — les modules purs

`tests/unit/`, plus les tests colocalisés dans `src/`.

Le rapport de couverture ne porte **que** sur les modules purs : `src/lib/`,
`src/config/`, `src/services/scheduling/`, la machine à états et le calcul de
complétude. Relevé : **94,9 % d'instructions, 88,6 % de branches**.

Seuils par fichier, tenus par `vitest.config.mts` :

| Module                                           | Seuil     | Pourquoi ce niveau                                                              |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------------------- |
| `services/scheduling/due-dates.ts`               | **100 %** | Une échéance fausse produit un dépôt en retard, donc une pénalité               |
| `services/workflow/state-machine.ts`             | **100 %** | Un refus mal traduit envoie l'utilisateur chercher un document qui n'existe pas |
| `services/occurrences/completeness.ts`           | **100 %** | Décide ce que l'écran déclare manquant                                          |
| `lib/dates.ts`, `lib/result.ts`, `lib/errors.ts` | 95 %      | Tout le reste en dépend                                                         |
| `services/scheduling/due-rule.ts`                | 95 %      | Portier du référentiel                                                          |
| Ensemble des modules retenus                     | 92 / 85   | Empêche qu'un module pur arrive sans test                                       |

### ⚠️ Pourquoi les services d'orchestration sont EXCLUS

`services/documents/upload.ts`, `services/export/*`, `services/dashboard/*` et leurs
voisins affichent 0 % dans ce rapport. Ce n'est pas un oubli.

Ces modules n'ont presque aucune logique propre : ils appellent une fonction SQL et
traduisent son résultat. Les couvrir en unitaire supposerait de **simuler le client
Supabase** — le test mesurerait alors la simulation, et passerait au vert le jour où
la policy réelle changerait. La règle vit dans la RLS et dans les fonctions SQL ; elle
s'éprouve donc contre une base réelle.

Ce que ces modules garantissent est vérifié par les deux autres suites. Le chiffre de
couverture unitaire ne décrit pas leur qualité, il décrit la nature du code.

## Propriété — ce qui doit rester vrai pour TOUTE entrée

`tests/unit/due-dates.properties.test.ts`, avec fast-check.

Les tests par l'exemple éprouvent les cas auxquels on a pensé. Les défauts de
calendrier vivent exactement là où l'on n'a pas pensé : un 31 dans un mois de 30
jours, un 29 février décalé d'un an, un férié collé au week-end **algérien** —
vendredi-samedi. Ici, la machine cherche le contre-exemple sur des milliers de
combinaisons et le réduit au plus petit cas reproductible.

Propriétés tenues :

- le calcul ne lève jamais — tout refus passe par un `Result` ;
- l'échéance légale ne tombe ni un week-end ni un férié quand la règle l'interdit ;
- le report va dans le sens déclaré, jamais dans l'autre ;
- `shiftReason` est renseigné **exactement** quand la date a bougé ;
- l'échéance interne n'est jamais postérieure à la légale ;
- le calcul est déterministe ;
- `addBusinessDays` n'atterrit jamais un jour chômé, et avancer puis reculer d'autant
  ramène au même jour ouvré.

⚠️ **Une propriété écrite d'abord était fausse.** « `resolveLeadDays` rend toujours une
marge strictement positive » : fast-check l'a réduite en vingt-huit tirages au
contre-exemple `["LOW", 0]`. La marge d'une criticité basse vaut zéro **par décision**.
C'est le test qui avait tort, pas le code — et c'est exactement le service que rend
cette suite.

## Intégration — la base refuse-t-elle vraiment ?

`tests/integration/`, contre la base locale, sous session utilisateur
(`set local role authenticated` + revendications JWT).

⚠️ **Sous session, jamais en `postgres`.** Un test qui interroge la base en
superutilisateur ne mesure aucune policy : il mesure une base sans RLS.

Couvre : matrice RLS rôle × table × opération, triggers d'audit et d'append-only,
génération d'occurrences, dépôt et intégrité documentaire, machine à états complète,
notifications, exports, sauvegardes, tableau de bord.

`rls.test.ts` échoue si **une seule** table apparaît sans RLS — c'est ce qui rend
tenable la promesse « 91 tables, 91 protégées ».

`authorization-model.test.ts` compare la **matrice rôle → permissions en entier**,
et non par sondage : c'est l'octroi _en trop_ qui est dangereux, et lui seul
échappe à un test par échantillon. Il vérifie aussi **structurellement** — sur
`pg_policies` et `pg_proc` — qu'aucune politique n'appelle une fonction
d'habilitation sans l'envelopper, et que les quinze fonctions d'habilitation
restent `STABLE PARALLEL SAFE`.

### L'isolation par entité — la règle qui rend la suite utilisable

⚠️ **La suite s'exécute sur une base AVEC le référentiel AGROESPACE chargé.**
C'est l'état de production ; tester sur une base vide, c'est éprouver une
situation qui n'existera jamais.

Cela n'a pas toujours été le cas, et le prix en était lourd : plusieurs tests
affirmaient sur des **comptages globaux** — `select count(*) from
obligation_occurrences` — c'est-à-dire sur l'état de la base plutôt que sur leur
propre comportement. Ils passaient sur une base vide, échouaient au chargement
des 23 obligations réelles, et **disposer d'une application utilisable et d'une
suite verte étaient deux états incompatibles**. La seule façon de les concilier
était de retirer le référentiel, donc de ne plus rien éprouver de réaliste.

#### Le mécanisme

`entity_id` existe sur toutes les tables métier depuis la migration 0001, avec
un défaut pointant l'entité AGROESPACE. La colonne avait été prévue pour un
cloisonnement multi-sites à venir ; elle donne l'isolation des tests **sans une
ligne de schéma en plus**.

Chaque fichier crée sa **propre entité**, y range tout ce qu'il fabrique, et
n'affirme que sur elle. Trois formes sont admises, et une seule idée — _rien de
ce qu'un fichier affirme ne doit dépendre de ce qu'il n'a pas produit_ :

| Forme                                  | Quand                                             | Comment                                                 |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `createTestScope()`                    | **tout nouveau fichier**                          | `tests/helpers/test-scope.ts`                           |
| constante `ENTITY` dans le jeu d'essai | fichiers antérieurs au helper                     | entité créée en tête du `SEED`, rattachement en queue   |
| état de référence                      | fichiers dont le SUJET est le référentiel partagé | relever l'état AVANT d'agir, n'affirmer que sur l'écart |

#### Écrire un nouveau test

```ts
import { createTestScope, destroyTestScope, type TestScope } from "../helpers/test-scope";

let scope: TestScope;
beforeAll(async () => {
  scope = await createTestScope();
}, 120_000);
afterAll(async () => {
  await destroyTestScope(scope);
}, 120_000);

it("…", async () => {
  const superviseur = await scope.createUserWithRole("SUPERVISEUR");
  const obligation = await scope.createObligation({ domain: "FISCAL" });
  const dossier = await scope.createOccurrence({ obligationId: obligation, periodKey: "2026-04" });

  await scope.asUser(superviseur, async (client) => {
    // …sous session utilisateur, RLS appliquée, transaction annulée à la fin.
  });
});
```

Les fabriques couvrent le modèle complet : obligation (portée `ENTITY` ou
`PER_REGISTER`), registre de commerce, occurrence, document, profil, rôle,
absence, délégation. `scope.asRole("SUPERVISEUR")` rend un client Supabase
**réellement authentifié** — il passe par `signInWithPassword`, donc par le vrai
jeton et la vraie chaîne PostgREST, là où un client `service_role` contournerait
les politiques.

`createTestScope()` **balaie au passage** les entités de test qu'une exécution
interrompue aurait laissées — plus vieilles de dix minutes, pour ne jamais
toucher à une exécution en cours. Sans cela, un `afterAll` qui n'aboutit pas
abandonnait son entité, et la seule façon de s'en défaire redevenait la
réinitialisation de la base — ce que ce mécanisme existe pour éviter.

#### Ce qui est interdit, et pourquoi

`tests/integration/suite-hygiene.test.ts` le fait respecter **mécaniquement**,
en nommant le fichier et la ligne. Il n'existe volontairement **aucune liste
d'exemption** : un fichier qui ne peut pas satisfaire ces règles est un fichier
dont les assertions dépendent de l'état initial de la base.

- ❌ **Compter une table métier entière.** `select count(*) from
obligation_occurrences` mesure la vacuité de la base, pas le cloisonnement.
- ❌ **Lire une table métier sans le moindre filtre.** Elle ramène ce que les
  autres ont créé.
- ❌ **Un fichier qui ne borne ses données à aucune entité.**

Deux choses restent **permises**, et le sont pour de bonnes raisons :

- ✅ **Un comptage global attendu à ZÉRO.** « cet administrateur ne voit aucun
  dossier, dans la base entière » est _plus fort_ qu'un comptage borné : cela ne
  peut devenir faux que si le cloisonnement cède — précisément ce qu'on veut
  apprendre.
- ✅ **Les tables de RÉFÉRENCE** — `roles`, `permissions`, `domains`,
  `status_transition_rules`. Leur nombre est une décision, pas un état ; c'est
  même ce que vérifie la matrice des rôles.

La garde se vérifie elle-même : un de ses tests lui soumet une entorse
fabriquée et exige qu'elle la nomme. Une garde qu'on n'a jamais vue échouer
n'est pas une garde — une expression rationnelle trop stricte ou un chemin qui
ne trouve aucun fichier en font un vert permanent qui ne protège rien.

#### ⚠️ Un défaut d'ENVIRONNEMENT à connaître : « the database system is in recovery mode »

Si la suite se met à échouer par grappes, sur des fichiers différents à chaque
exécution, avec l'erreur **« the database system is in recovery mode »**, le
coupable n'est pas le code : **le conteneur PostgreSQL local plante**.

Symptôme dans le journal du conteneur :

```
LOG: server process (PID …) was terminated by signal 11: Segmentation fault
DETAIL: Failed process was running: select * from public.exportable_occurrences($1::uuid)
LOG: all server processes terminated; reinitializing
```

Le défaut a été **isolé** : une fonction TÉMOIN créée pour l'occasion — un
`select n` de trois mots, sans droit d'exécution pour `authenticated` — fait
tomber le serveur dès qu'on l'appelle sous ce rôle. Autrement dit, **tout refus
de droit sur un appel de fonction** peut faire planter ce PostgreSQL, quel que
soit le contenu de la fonction. Aucune migration du projet n'y est pour quelque
chose, et plusieurs tests ATTENDENT légitimement un « permission denied » — ils
en sont les victimes désignées.

L'état n'apparaît qu'après un certain temps d'usage du conteneur ; il survit à
`supabase db reset`, qui recrée la base sans redémarrer le processus.

**Remède** — redémarrer la pile, pas seulement la base :

```bash
npx supabase stop && npx supabase start
```

Pour vérifier après coup qu'aucun plantage n'a eu lieu pendant une exécution :

```bash
docker logs supabase_db_conformia 2>&1 | grep -c "Segmentation fault"
```

Zéro est la seule réponse acceptable. Un résultat non nul invalide l'exécution
ENTIÈRE : les échecs qu'elle rapporte sont des dommages collatéraux, et les
succès n'ont pas plus de valeur.

#### Lancer la suite

```bash
npm run test:integration          # sur la base telle qu'elle est
npm run test:integration:fresh    # db reset + db:seed + tests — l'état de référence
npm run test:integration:slow     # les seuls tests @slow
```

La suite doit passer **deux fois de suite sans réinitialisation** : c'est la
preuve que chaque fichier nettoie derrière lui.

### Les tests marqués `@slow`

Un test dont le nom porte `@slow` construit un volume réaliste avant de mesurer :
`dashboard-performance.test.ts` charge **50 000 dossiers** puis chronomètre les
écrans. Il fait partie de `npm run test:rls` et n'en est pas séparé — un budget
de performance qu'on ne lance pas est un budget qu'on ne tient pas.

Le marqueur sert à les **choisir** quand on ne veut qu'eux, ou à les écarter
d'une boucle de développement serrée :

```bash
npx vitest run --config vitest.integration.mts -t "@slow"     # ceux-là seuls
npx vitest run --config vitest.integration.mts -t "^(?!.*@slow)"  # tous les autres
```

⚠️ **Le budget porte sur DEUX grandeurs, et la seconde compte plus.** La file de
validation doit tenir sous **200 ms** _et_ sous **10 000 accès tampon**. Le temps
dépend de la machine ; les accès tampon, non. Une politique dont un appel cesse
d'être enveloppé dans `(select ...)` refait exploser le nombre de blocs lus bien
avant que le chronomètre ne s'en émeuve sur une machine rapide.

⚠️ Le chargement se termine par un `VACUUM ANALYZE`. Ce n'est pas un confort : le
nettoyage de fin de fichier laisse 50 000 versions mortes derrière lui, et un
second lancement mesurait alors le ballonnement au lieu du coût de la requête —
18 535 accès au deuxième passage contre moins de 10 000 au premier, sur un code
identique.

### L'envoi de courriels — vraiment envoyés, vraiment reçus

`tests/integration/notification-delivery.test.ts` fait tourner `runNotificationJob`
et va **relever la boîte**. Mailpit — la boîte aux lettres locale de Supabase,
interface sur `54324`, SMTP sur `54325` — reçoit de vrais messages et les rend
interrogeables par API. `tests/helpers/mailpit.ts` encapsule cet accès.

⚠️ **Aucun `vi.mock` du fournisseur.** Un mock vérifie qu'on a appelé une
fonction ; il ne vérifie ni que le message part, ni qu'il porte le bon
destinataire, ni que le corps HTML tient debout, ni que le texte brut existe. Or
c'est exactement ce qui casse. Avant ce fichier, `runNotificationJob` n'était
appelé par aucun test, les deux fournisseurs n'étaient jamais instanciés et les
onze gabarits n'étaient jamais rendus par le chemin qui les rend en production.

#### Les deux fournisseurs, les mêmes scénarios

Le fichier exécute son cœur de scénarios **deux fois**, une par valeur de
`app_settings.email_provider` :

| Réglage  | Chemin réellement parcouru                                             |
| -------- | ---------------------------------------------------------------------- |
| `smtp`   | `SmtpProvider` → nodemailer → SMTP → Mailpit                           |
| `resend` | `ResendProvider` → SDK `resend` → HTTP → relais local → SMTP → Mailpit |

Le relais est `tests/helpers/resend-shim.ts` : un serveur HTTP qui implémente
`POST /emails` et remet le message à Mailpit. Le SDK le trouve seul, par la
variable `RESEND_BASE_URL` qu'il lit à la construction du client — **aucune ligne
de `resend.ts` ni de la fabrique n'a été modifiée pour le test**. Ce qui est
éprouvé est donc l'interchangeabilité du code de production, et non celle d'une
variante écrite pour l'occasion.

Le relais sait aussi **refuser** une adresse (422, comme Resend pour une adresse
invalide) et **répondre de travers** (200 sans identifiant). C'est ce qui permet
d'éprouver les reprises, l'échec définitif et le filet de `ResendProvider` sans
simuler quoi que ce soit de notre côté.

⚠️ Une règle ESLint interdit désormais d'importer `resend` ou `nodemailer`
ailleurs que dans `providers/{resend,smtp}.ts`. Sans elle, la promesse « changer
de fournisseur ne touche aucun autre fichier » tenait à la seule discipline.

#### Ce que la suite établit

Volume et destinataires conformes à l'audience ; **déduplication** — deux cycles,
un seul message, et le test échoue si l'on retire `notifications_rule_dedup_key` ;
silence sur un dossier déposé, archivé ou sans objet ; **regroupement horaire** ;
chaîne standard J+1 / J+3 / J+7 et chaîne accélérée `CRITICAL` J+0 / J+2 ;
**déroutement vers le suppléant** d'un absent, mention comprise, l'in-app restant
à l'absent ; reprises à temporisation croissante et alerte aux administrateurs
après épuisement ; cinquante destinataires dont un invalide, quarante-neuf
servis ; panne totale du fournisseur — les notifications in-app subsistent — puis
reprise au cycle suivant ; canaux dormants écartés à la source.

#### Couverture

```bash
npm run test:integration:coverage   # seuils sur resend.ts et smtp.ts
npm test -- --coverage              # seuils sur src/emails/**
```

⚠️ **La couverture des fournisseurs se mesure dans la suite d'intégration**, pas
dans l'unitaire : leur seul comportement intéressant est ce qu'ils font d'un vrai
serveur. Celle des gabarits se mesure dans l'unitaire, où `renderEmail` est une
fonction pure.

#### Trois filtres perdus, et ce qu'ils enseignent

La réécriture de `due_notification_candidates` en 0022 — pour y ajouter le
déroutement — est repartie de la version de 0014 et en a **perdu quatre
garanties** : la préférence de canal du destinataire, le contrôle de
`deactivated_at`, l'écart des profils sans adresse, et la révocation de
`execute` à `authenticated`. Une seule était couverte par un test ; c'est elle
qui a dénoncé la régression, dès que la suite de diffusion a existé. `0023` les
rétablit, et les trois premières ont désormais leur scénario.

⚠️ **Une fonction SQL réécrite en entier ne dit pas ce qu'elle a cessé de faire.**
Relire un `create or replace` de cent lignes ne fait pas apparaître la clause
absente. Quand une migration réécrit une fonction existante, comparer la liste
de ses clauses `where` avec la version précédente coûte deux minutes.

## Bout en bout — les écrans, enchaînés

`e2e/`, Playwright, contre un **build de production**.

⚠️ Contre le build de production, pas le mode développement : l'accessibilité, la CSP
et le découpage des bundles ne se vérifient que sur le rendu réel.

### Les huit parcours critiques

`e2e/critical-journeys.spec.ts` tourne sur **Chromium ET Firefox**. Ce n'est pas de la
redondance : les deux moteurs divergent sur l'hydratation, la sérialisation des dates
et l'instant exact où une navigation en remplace une autre. Un parcours qui passe sur
l'un et casse sur l'autre est un défaut réel — et c'est exactement ce que le reste de
la suite ne peut pas voir.

1. Un ADMIN enrôle son second facteur par l'interface, puis s'en sert pour entrer.
2. Cycle complet : dépôt, soumission, validation, dépôt auprès de l'organisme.
3. Le préparateur ne peut pas valider son propre dossier.
4. Un agent RH n'atteint pas un dossier fiscal — **même par URL directe** — et la
   réponse est indiscernable de celle d'un identifiant inexistant.
5. Un ADMIN n'atteint aucune occurrence ni aucun document.
6. Une rectificative naît d'un dossier archivé, l'original reste intact.
7. Cycle d'une pièce : dépôt, remplacement, téléchargement par URL **signée**.
8. Une notification produite en base apparaît dans le centre et sur la cloche.

### L'arabe

`e2e/arabic.spec.ts` — cinq parcours, sur Chromium.

⚠️ **Ce fichier a trouvé un vrai défaut** : les catalogues étaient tenus clé pour clé,
1416 contre 1416, et l'arabe restait **inatteignable** — le sélecteur de langue était
figé sur le français, et `requestLocale` étant vide, toute l'application rendait en
français même sous `/ar/`. Une comparaison de clés n'aurait rien vu : les deux
fichiers étaient parfaits.

Il vérifie donc ce qui ne se déduit d'aucune comparaison : le menu propose réellement
les deux langues, le choix survit à la navigation suivante (cookie, pas état local),
`dir="rtl"` est posé, les écrans rendent de l'arabe, **la mise en page ne déborde pas
horizontalement**, et l'on peut revenir au français.

⚠️ Le changement de langue s'y fait **au clavier**. Ce n'est pas un contournement :
un clic de souris sur l'entrée d'un sous-menu Radix est intercepté dans un navigateur
piloté, et le geste au clavier éprouve en plus l'accessibilité du sélecteur.

### Les écrans qui étaient des coquilles

`e2e/completed-screens.spec.ts` — « Mon profil », le sommaire d'Administration et les
règles de notification rendaient un marque-place « Cette section n'est pas encore
construite ». Le fichier vérifie qu'ils portent des **données réelles**, pas seulement
un titre — une page qui affiche son en-tête et rien d'autre passerait un test
d'existence tout en restant vide.

Il porte aussi le garde-fou de régression : aucun écran atteignable ne doit rendre de
marque-place. Un marque-place est confortable à poser et facile à oublier ; il a l'air
d'une fonctionnalité et rien ne le signale.

### Durcissement

`e2e/security.spec.ts` : en-têtes présents, nonce **différent à chaque réponse**,
**zéro violation CSP** sur les écrans de travail, une jauge à zéro s'affiche vide, et
les routes handler éprouvées dans les trois situations — sans session, avec une
session insuffisante, avec la bonne.

### Accessibilité

`@axe-core/playwright` sur chaque écran principal. Les violations trouvées ont été
corrigées, jamais mises en liste d'exception.

## Tests statiques — ce qu'aucune exécution ne montre

Trois vérifications lisent le code lui-même :

| Test                           | Ce qu'il empêche                                             |
| ------------------------------ | ------------------------------------------------------------ |
| `server-action-guards.test.ts` | Une Server Action sans garde de permission                   |
| `rls.test.ts`                  | Une table sans RLS                                           |
| `logical-properties.test.ts`   | Une classe Tailwind **physique** (`ml-`, `pr-`, `text-left`) |

Le troisième prépare le passage en arabe : les propriétés logiques (`ms-`, `pe-`,
`text-start`) se retournent seules. La dette serait invisible jusqu'au jour où elle
coûterait une relecture complète de l'interface.

⚠️ Chacun de ces tests porte une liste de **dispenses avec motif écrit**, et un
contrôle qui échoue si une dispense devient inutile. Une dérogation qu'on oublie de
retirer est une règle qui s'éteint.

## Ce qu'aucune suite ne couvre

Dit ici pour que personne ne le découvre en production :

- **Le rendu navigateur mesuré** — LCP, INP, CLS. `npm run load-test` mesure le
  serveur (~100 ms par page seul, p95 2,0 s à cinquante sessions simultanées, 0 échec
  sur 200 requêtes) ; il ne lance aucun navigateur.
- **La restauration en conditions réelles.** `npm run restore:test` restaure dans une
  base jetable — c'est déjà beaucoup plus que rien, ce n'est pas un exercice de
  bascule.
- **La montée en charge au-delà de cinquante sessions.**

## Une intermittence élucidée, une tolérance assumée

### Filtres et tri : la cause a fini par se laisser voir

Trois tests ont échoué au fil des exécutions — `obligations.spec.ts:142`,
`occurrences.spec.ts:225`, `occurrences.spec.ts:210` — toujours de la même façon :
l'URL ne recevait pas ce qu'on lui demandait. Longtemps traité comme une flakiness
liée à la charge, c'était un **vrai défaut**, et il touchait les utilisateurs.

Le relevé a fini par le montrer sans ambiguïté : la requête de navigation part, le
routeur l'**abandonne** (`net::ERR_ABORTED`), et la transition React qui la portait
ne se termine alors **jamais**. `pending` reste vrai indéfiniment ; or les contrôles
sont désactivés pendant qu'une navigation est en cours. Mesuré : champ de recherche
grisé et URL figée **huit secondes** après la frappe, sans reprise.

Quatre formes ont été essayées, chacune fausse pour une raison propre :

| Forme                                  | Pourquoi elle échoue                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| Relance à cadence fixe                 | Se double elle-même : chaque essai interrompt le précédent          |
| Garde sur `pending` seul               | Une navigation perdue laisse `pending` figé → **blocage définitif** |
| Borne en NOMBRE d'essais               | Épuise son quota en deux secondes, quand il faudrait insister       |
| Condition lue dans le corps de l'effet | L'effet ne se réexécute pas : `Date.now()` n'est pas une dépendance |

La forme retenue combine les quatre leçons : borne en **temps** (vingt secondes),
attente **doublante**, `pending` lu par **référence** dans la minuterie, et
réarmement à chaque battement. Condition d'arrêt factuelle : l'URL porte-t-elle ce
qu'on a demandé ?

Depuis, **deux exécutions complètes consécutives passent, 135 sur 135**.

⚠️ Ce qui reste vrai : le mécanisme compense un comportement de Next.js qu'il ne
corrige pas. Si un écran neuf présente le symptôme, la cause est là, pas dans l'écran.

### Windows épuise ses ports éphémères : `net::ERR_NO_BUFFER_SPACE`

⚠️ **Ce n'est pas un défaut de l'application, et il ne faut pas le chercher dedans.**

Le symptôme : un test de bout en bout échoue sur `page.goto: net::ERR_NO_BUFFER_SPACE`,
souvent après une centaine de tests, jamais deux fois au même endroit. Relancé seul,
le même test passe.

La cause est système. Windows conserve chaque socket fermée en `TIME_WAIT` pendant
quatre minutes et n'ouvre par défaut qu'une plage de ports dynamiques étroite. La
suite en consomme beaucoup : cent trente-neuf tests, chacun avec ses requêtes HTTP,
sa session et sa réserve de connexions PostgreSQL. Au-delà d'un certain débit, la
pile réseau refuse d'en ouvrir une de plus.

**Ce qui a été fait**, dans `playwright.config.ts` : une **reprise** sous Windows
(`retries: 1`). Une seconde tentative repart sur des ports libérés ; un échec
applicatif, lui, échoue les deux fois — la reprise ne masque donc aucun défaut réel.

⚠️ **Cette reprise absorbe aussi l'intermittence Firefox** décrite plus bas. Deux
exécutions complètes consécutives donnent désormais « 139 passés, 1 instable » là où
l'une des deux échouait. Un test rapporté **instable** n'est pas un test vert : il
signale qu'il a fallu s'y reprendre. Le rapport le nomme, et il faut le lire.

⚠️ **Ce qu'il ne faut PAS faire : augmenter le nombre de travailleurs.** La suite
tourne déjà sur un seul (`workers: 1`, `fullyParallel: false`), et c'était déjà le
cas quand l'incident est survenu. En mettre deux doublerait le débit de sockets —
exactement ce qui manque. Le réglage porte un commentaire en ce sens, pour que
personne ne le relance à la hausse en croyant gagner du temps.

Si le symptôme devenait fréquent, le remède est côté système et non côté suite :
élargir la plage dynamique et raccourcir le `TIME_WAIT`
(`netsh int ipv4 set dynamicport tcp start=10000 num=55000`).

### Firefox et les navigations interrompues

Firefox signale `NS_BINDING_ABORTED` dès qu'une navigation en remplace une autre ;
Chromium absorbe le même cas sans rien dire. Le helper `visit()` tolère cette erreur
précise et **seulement celle-là**, parce que la navigation aboutit : ce qui l'établit
est la page obtenue, vérifiée par les assertions qui suivent.

## Avant d'annoncer « terminé »

```bash
npm run typecheck && npm run lint && npm test && npm run test:rls && npm run test:e2e
```

Les cinq passent, ou ce n'est pas terminé.
