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
- **L'envoi réel de courriels.** Les fournisseurs sont éprouvés par leur interface,
  pas par une remise effective.
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

### Firefox et les navigations interrompues

Firefox signale `NS_BINDING_ABORTED` dès qu'une navigation en remplace une autre ;
Chromium absorbe le même cas sans rien dire. Le helper `visit()` tolère cette erreur
précise et **seulement celle-là**, parce que la navigation aboutit : ce qui l'établit
est la page obtenue, vérifiée par les assertions qui suivent.

## Avant d'annoncer « terminé »

```bash
npm run typecheck && npm run lint && npm test && npm run test:rls && npm run test:e2e
```

Les quatre passent, ou ce n'est pas terminé.
