# Décisions

Chaque entrée dit **ce qui a été décidé**, **ce que cela coûte** et **ce qui la
ferait reconsidérer**. Une décision dont on ne sait pas dire le prix n'a pas été prise,
elle a été subie.

## Écarts assumés

Certaines entrées ne décrivent pas un choix d'architecture mais un **écart connu**,
mesuré, dont on a décidé qu'il ne valait pas son correctif. Les taire les
transformerait en dette invisible ; les corriger coûterait plus que ce qu'ils
coûtent. Elles portent la mention en tête. À ce jour : § 15 (statut 404).

---

## 1 · La base est l'autorité, l'application explique

**Décidé.** Cloisonnement, transitions, complétude et traçabilité vivent en SQL. Le
code applicatif grise des boutons et nomme ce qui manque.

**Pourquoi.** Une garde applicative se contourne par tout chemin qui ne passe pas par
elle. Les données suivies sont des déclarations fiscales et sociales.

**Coût.** Écrire du SQL, tester avec une base réelle, accepter que la couverture
unitaire des services d'orchestration reste basse.

**Reconsidérer si.** Jamais pour du confort. Éventuellement si la plateforme cessait
d'être multi-domaines — mais alors le produit aurait changé de nature.

---

## 2 · ADMIN n'a ni `occurrence.read` ni `document.read`

**Décidé.** L'administrateur technique gère comptes, rôles, réglages et référentiel.
Il ne lit aucun dossier ni aucune pièce.

**Pourquoi.** Sinon la personne qui installe le logiciel devient la mieux informée de
l'entreprise. Un incident se diagnostique avec `audit_log` et l'identifiant de
corrélation, pas avec le contenu d'une déclaration.

**Coût.** Le support est un peu moins direct. Une question sur un dossier passe par
quelqu'un du domaine.

**Reconsidérer si.** La Direction l'exige explicitement — et alors en le traçant comme
une décision, pas comme une commodité. Détail complet dans [security.md](./security.md).

---

## 3 · `style-src 'unsafe-inline'`, `script-src` strict

**Décidé.** La CSP garde un nonce par requête et `'strict-dynamic'` sur `script-src`.
`style-src` admet `'unsafe-inline'`.

**Pourquoi.** Mesuré : avec un nonce, les attributs `style="…"` rendus par le serveur
sont refusés — un nonce ne s'attache pas à un attribut. Sur un dossier « 0 sur 2 », la
barre de complétude s'affichait **pleine**. Toutes les jauges annonçaient « complet ».

**Coût.** Une injection CSS devient possible _si_ une faille d'injection existe par
ailleurs. Aucun script ne s'exécute pour autant.

**Reconsidérer si.** Les jauges passent à un rendu qui n'emploie aucun attribut de
style — un `<rect>` SVG en pourcentage, par exemple. Le nonce redeviendrait alors
posable sans rien casser.

---

## 4 · Les corps des fonctions RLS sont dupliqués

**Décidé.** `session_gates()` et ses voisines répètent leur logique au lieu de
déléguer à une variante `_for(p_user)`.

**Pourquoi.** Mesuré : la factorisation a fait passer `pending_validation_count()` de
**92 ms à plus de 30 s**. `security definer` + `set search_path` empêchent PostgreSQL
d'inliner, et l'appel devient une barrière d'optimisation dans une policy évaluée par
ligne.

**Coût.** Deux corps à tenir synchronisés. Un test de parité les compare.

**Reconsidérer si.** PostgreSQL apprend à inliner ces fonctions. À vérifier par la
mesure, pas par la note de version.

---

## 5 · Le calcul d'échéance est en TypeScript

**Décidé.** Seule règle métier hors de la base.

**Pourquoi.** L'écran de référentiel prévisualise six échéances **pendant la saisie**.
En SQL, ce serait un aller-retour par frappe.

**Coût.** Une règle qui n'est pas gardée par la base. Compensé par le seul seuil de
couverture à **100 %** du projet, des tests de propriété (fast-check), et le fait
qu'une échéance fausse produit une date visible — pas une fuite.

**Reconsidérer si.** La prévisualisation disparaît, ou si une règle réglementaire
devient assez complexe pour mériter d'être appliquée à l'écriture.

---

## 6 · Aucune colonne de montant

**Décidé.** La plateforme suit la démarche, pas les chiffres.

**Pourquoi.** Un montant appelle un rapprochement, donc une exactitude comptable, donc
une seconde source de vérité à tenir avec la comptabilité.

**Coût.** Les rapports ne chiffrent pas l'exposition financière.

**Reconsidérer si.** La Direction le demande — et alors en décidant d'abord **qui**
fait foi, de la comptabilité ou d'ici.

---

## 7 · La limitation de débit est posée dans le middleware

**Décidé.** Une borne unique sur l'en-tête `next-action`, 60 écritures par minute et
par utilisateur, compteur en base.

**Pourquoi.** C'est le seul point par lequel passent les soixante et une Server
Actions. Une garde recopiée soixante et une fois est une garde qu'on oublie une fois.

**Coût.** Un appel de base supplémentaire sur chaque écriture. Les lectures n'en
paient rien.

**Reconsidérer si.** Un usage légitime dépasse le seuil — un import en masse, par
exemple. Le seuil est alors à relever pour ce chemin, pas à supprimer.

---

## 8 · Les écritures anonymes ne sont pas limitées par IP

**Décidé.** Sans session, aucune borne de débit. La connexion garde la sienne, par
courriel ET par IP.

**Pourquoi.** Mesuré : une borne par IP a refusé la moitié des ouvertures de session
de la suite de bout en bout, qui se connecte depuis une adresse unique. Un bureau
derrière un accès partagé subit exactement la même chose : vingt personnes comptées
comme une seule.

**Coût.** Une salve anonyme sur une action non authentifiée n'est pas bornée. La seule
action de ce type est la connexion, déjà protégée.

**Reconsidérer si.** Une écriture anonyme est ajoutée — formulaire public, webhook. Il
faudrait alors une borne propre à ce chemin.

---

## 9 · Les navigations sont RELANCÉES, pas retardées

**Décidé.** `useQueryNavigation` et l'onglet « Dossier » redemandent la page tant
qu'elle n'a pas vu le changement, avec un temps d'attente qui double, borné.

**Pourquoi.** Mesuré sur une quinzaine d'exécutions : `router.refresh()` ou
`router.replace()` enchaîné sur la fin d'une Server Action est **annulé** par le
navigateur (`net::ERR_ABORTED`). Selon la vitesse de la machine, l'écran se met à jour
ou reste figé. Trois formes ont été essayées et mesurées intermittentes — dont
`startTransition(async () => { await run(); router.refresh(); })`.

**Coût.** Quelques requêtes de plus dans le cas dégradé. QUATRE formes plus simples
ont été essayées et mesurées fausses :

1. cadence fixe — elle doublait sa propre navigation en vol ;
2. garde sur `pending` seul — une navigation abandonnée laisse `pending` figé à vrai
   POUR TOUJOURS, et la relance n'était alors jamais émise : blocage définitif, champ
   grisé, URL figée ;
3. borne en NOMBRE d'essais — quota épuisé en deux secondes, précisément quand la
   machine chargée aurait eu besoin qu'on insiste ;
4. condition lue dans le corps de l'effet — l'effet ne se réexécute pas, `Date.now()`
   n'étant pas une dépendance.

La forme retenue combine les quatre leçons : borne en DURÉE (vingt secondes), attente
doublante, `pending` lu par RÉFÉRENCE dans la minuterie, et réarmement à chaque
battement. Une borne en nombre vaut la même chose sur une machine au repos et sur une
machine saturée ; une borne en temps s'adapte.

**Reconsidérer si.** Next.js corrige l'annulation. La condition d'arrêt étant
factuelle — l'URL porte-t-elle ce qu'on a demandé — le code resterait correct, il
cesserait simplement de relancer.

---

## 10 · Next.js 15, pas 16

**Décidé.** Rester sur la version pinée par CLAUDE.md §2, malgré trois vulnérabilités
`high` corrigées en 16.

**Pourquoi.** Exposition vérifiée nulle : `next/image` n'est employé nulle part, aucun
motif d'image distante n'est déclaré, `postcss` ne traite que nos feuilles au build.
Une montée de version majeure décidée seule, en fin de phase, coûterait plus que ce
qu'elle corrige.

**Coût.** `npm audit` reste rouge, et il faut savoir pourquoi pour ne pas s'y habituer.

**Reconsidérer si.** Une des trois vulnérabilités devient atteignable — l'ajout d'un
`next/image` suffirait — ou à la première fenêtre de maintenance planifiée.

---

## 11 · `zustand` est déclaré mais inutilisé

**Constaté** par `depcheck`, pas décidé.

CLAUDE.md §2 le retient pour l'état d'interface éphémère, « usage minimal ». Aucun
écran n'en a eu besoin : l'état vit dans l'URL (partageable) ou dans un `useState`
local. La dépendance reste installée parce qu'elle fait partie de la pile approuvée ;
la retirer est une décision de charte, pas de code.

**À trancher** à la prochaine revue de dépendances.

---

## 12 · Couverture : seuils sur les modules purs seulement

**Décidé.** Seuils par fichier sur le calcul, la validation, la machine à états, les
dates, `Result` et les erreurs. Les services qui orchestrent la base en sont exclus.

**Pourquoi.** Les couvrir supposerait de simuler le client Supabase : le test
mesurerait la simulation, pas la règle — et la règle vit dans la RLS et les fonctions
SQL. Ces modules sont éprouvés par `vitest.integration.mts` (base réelle) et par
Playwright (application réelle), dont la couverture ne se lit pas dans ce rapport.

**Coût.** Le chiffre global du rapport unitaire ne décrit pas tout le projet. D'où
[testing.md](./testing.md), qui dit ce que chaque suite garantit.

**Reconsidérer si.** Un service d'orchestration prend une décision qui n'est pas
gardée en base. Il faudrait alors la déplacer, ou le tester pour de bon.

---

## 13 · La locale voyage par en-tête, posé par notre middleware

**Décidé.** `src/middleware.ts` pose `x-app-locale`, et `getRequestConfig` le lit
avant de se replier sur `requestLocale`.

**Pourquoi.** next-intl alimente `requestLocale` depuis SON middleware, que ce projet
ne monte pas — le sien porte la session, la CSP, la corrélation et la limitation de
débit. `requestLocale` restait donc vide et `resolveLocale(undefined)` retombait sur
le français : **toute l'application rendait en français, quelle que soit l'URL**, et
les 1416 clés du catalogue arabe n'ont jamais été lues.

Le défaut était invisible : `lang` et `dir` viennent de `params` et basculaient
correctement en `ar`/`rtl`. La page avait TOUT l'air d'être en arabe, sauf le texte.

`setRequestLocale` a été essayé d'abord et ne suffit pas : la page peut résoudre ses
traductions avant que la disposition ne l'ait appelé. L'en-tête, lui, est posé avant
tout rendu et ne dépend d'aucun ordre d'exécution.

**Coût.** Un en-tête de plus, et une dépendance à notre middleware — assumée : il est
déjà le point de passage obligé de chaque requête.

**Reconsidérer si.** `next/root-params` se stabilise. Il remplacerait à la fois cet
en-tête et les deux dispenses de dépréciation qui l'accompagnent.

---

## 14 · Les règles de notification sont exposées, pas modifiables

**Décidé.** `/admin/notifications` affiche rappels et escalades en lecture. Les
politiques d'écriture existent en base, réservées à `settings.manage` ; aucun
formulaire ne les emploie.

**Pourquoi.** Une règle éteinte par mégarde ne casse rien de visible : elle supprime
des rappels, et le défaut ne se découvre qu'à la première échéance manquée. À
l'inverse, ne rien montrer oblige à ouvrir la base pour répondre à « la règle
existe-t-elle ? » — la première question posée quand une alerte n'arrive pas.

**Coût.** Changer un jalon demande une migration, donc un déploiement. C'est plus lent
qu'un clic, et c'est le but.

**Reconsidérer si.** Le besoin d'ajuster un jalon devient courant. Il faudrait alors
un formulaire AVEC confirmation explicite et trace d'audit — pas un simple
interrupteur.
---

## 15 · Une fiche introuvable répond 200, pas 404

> **Écart assumé.** Ce qui suit n'est pas un choix d'architecture : c'est un défaut
> connu qu'on garde, avec son prix chiffré.

**Décidé.** `notFound()` sur une fiche — occurrence, document, obligation, registre —
rend l'écran « ressource introuvable » avec un statut HTTP **200**. On le laisse tel
quel, et on ne déplace pas le contrôle d'existence dans le middleware.

**Pourquoi.** L'exigence réelle n'était pas le code de statut : c'était
l'**indistinguabilité** entre « la ressource n'existe pas » et « vous n'y avez pas
droit ». Distinguer les deux transformerait chaque fiche en oracle : on devine un
identifiant, on lit la différence, et on apprend quels dossiers existent dans les
domaines qu'on n'a pas le droit de voir. La liste des obligations d'une entreprise
en dit long sur ses ennuis.

Cette propriété-là est établie et **testée** — même statut, corps rendu identique,
temps de réponse comparable (`e2e/security.spec.ts`). Aucune information ne fuit.
L'objectif de sécurité est atteint.

Ce qui reste est une imprécision de sémantique HTTP, dont les conséquences réelles
se comptent :

| Conséquence redoutée | Ici                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Référencement        | Application privée, derrière authentification. Aucun moteur n'y entre.                                      |
| Consommateurs d'API  | Il n'y en a pas.                                                                                            |
| Cache                | Pages dynamiques authentifiées, jamais mises en cache partagé.                                              |
| Surveillance externe | Une sonde pointée sur l'URL d'une fiche compterait mal. Ce cas ne se présente pas — voir `docs/runbook.md`. |

**La cause, mesurée.** `notFound()` ne fixe le code que s'il est levé AVANT que la
réponse ne commence à s'écrire. L'attrape-tout de la zone authentifiée y parvient :
c'est un composant synchrone, il lève avant tout. Une fiche, elle, doit d'abord lire
la session puis la base pour savoir si la ressource existe et si l'appelant y a
droit ; sur une route rendue dynamiquement, ces attentes suffisent à engager la
réponse. Vérifié : retirer les `loading.tsx` du segment ET de son parent n'y change
rien, il n'existe aucune autre frontière de suspension dans la coquille, et
`notFound()` depuis `generateMetadata` échoue aussi — Next 15 diffuse les
métadonnées.

**Coût.** Le correctif étanche demanderait de porter le contrôle dans le middleware,
donc **une lecture de base par requête**. C'est précisément le motif qu'on vient de
retirer des politiques RLS au prix de plusieurs heures de travail. Le réintroduire
pour une exactitude cosmétique serait un mauvais échange : on paierait à chaque
requête de chaque écran pour un chiffre que personne ne lit.

**Reconsidérer si.** L'application s'ouvre à des consommateurs d'API, ou une
surveillance externe doit distinguer « disparu » de « en panne » sur une ressource
précise. Le premier cas changerait la nature du produit ; le second se règle avec
`/api/health`, sans toucher au rendu.
