# Architecture

Ce document explique **pourquoi** le code est disposé ainsi. Les règles elles-mêmes
sont dans [CLAUDE.md](../CLAUDE.md), qui fait autorité ; ce qui suit les motive et
donne les contreparties.

## L'idée qui structure tout

**La base de données est l'autorité, pas l'application.**

Ce n'est pas une préférence de style. La plateforme suit des obligations fiscales et
sociales : une donnée lue par la mauvaise personne, une transition d'état accordée à
tort, une écriture sans trace ne sont pas des défauts d'affichage — ce sont des
manquements. Or une garde applicative se contourne par n'importe quel chemin qui ne
passe pas par elle : un script, une console, un écran qu'on a oublié de protéger, un
appel direct à PostgREST.

Les garanties tiennent donc **en base** :

| Garantie                        | Où elle vit                                         |
| ------------------------------- | --------------------------------------------------- |
| Cloisonnement par domaine       | RLS sur chaque table, sans exception (91/91)        |
| Transitions d'état autorisées   | `status_transition_rules` + `evaluate_transition()` |
| Séparation préparateur/valideur | `apply_occurrence_transition()`                     |
| Complétude d'un dossier         | `occurrence_missing_items()`                        |
| Traçabilité                     | trigger `audit_trigger()`, `audit_log` append-only  |
| Calcul d'échéance               | ⚠️ exception — en TypeScript, voir plus bas         |

L'application, elle, **explique**. Elle grise un bouton, nomme la pièce manquante,
propose la bonne action. Si elle se trompe, l'utilisateur est mal guidé ; il n'obtient
jamais un droit qu'il n'a pas.

### L'exception assumée : le calcul d'échéance

`src/services/scheduling/due-dates.ts` est en TypeScript, pas en SQL. C'est la seule
règle métier hors de la base, et la raison est l'écran de prévisualisation : le
référentiel montre les six prochaines échéances **pendant la saisie**, avant tout
enregistrement. Une implémentation SQL exigerait un aller-retour par frappe.

La contrepartie est explicite : ce module est le seul du projet à porter un seuil de
couverture de **100 %**, branches comprises, et il est en plus éprouvé par des tests
de propriété (`tests/unit/due-dates.properties.test.ts`). Une échéance fausse produit
un dépôt hors délai, donc une pénalité réelle.

## Les couches, et ce qu'elles refusent

```
app/       routage, RSC, layouts
  ↓
features/  UI métier — cloisonnée par domaine
  ↓
services/  règles, orchestration, Result<T, AppError>
  ↓
data/      accès Supabase, une fonction = une requête
  ↓
db/        SQL : tables, RLS, fonctions, triggers
```

Trois interdits, tenus **par ESLint** (`import/no-restricted-paths`) et non par la
discipline :

1. **Aucune dépendance ascendante.** `services/` ignore React ; `data/` ignore les
   services.
2. **Aucune dépendance latérale entre features.** `features/documents` n'importe rien
   de `features/occurrences`. Le partage passe par la couche du dessous — c'est
   pourquoi `useDirectUpload` vit dans `components/shared` et reçoit ses Server
   Actions **en paramètre** plutôt que de les importer.
3. **Aucun composant n'instancie un client Supabase.** Le seul module autorisé est
   `src/lib/supabase/*`.

La règle 3 a une conséquence qu'on découvre en la violant : une tentative d'importer
`@/data/queries/jobs` depuis un composant de `features/` fait **échouer le build**, pas
seulement le lint. C'est voulu — une frontière qui ne casse rien n'est pas une
frontière.

## `Result<T, AppError>` plutôt que des exceptions

Toute fonction de service rend un `Result`. Les exceptions sont réservées aux bugs de
programmation.

```ts
type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };
```

Ce que cela achète : l'appelant **ne peut pas oublier** le cas d'échec, le compilateur
l'y oblige. Ce que cela coûte : plus de lignes. Le compromis est arrêté parce qu'un
`try/catch` manquant dans un job de génération arrête la production de TOUTES les
occurrences de la nuit, pas seulement celle qui pose problème.

`AppError` porte un **code** (union littérale) et une **clé i18n**, jamais un message
rédigé : le texte appartient aux catalogues, l'erreur au domaine. `toClientError()`
nettoie les détails avant l'envoi au navigateur — chemins de fichiers, piles, causes
restent côté serveur (`src/lib/errors.ts`, éprouvé par un test dédié).

## Les règles réglementaires sont des DONNÉES

Périodicité, calcul d'échéance, pièces requises, seuils, entité responsable : en base.
Ajouter une obligation ne demande **aucun déploiement**.

```ts
if (obligation.code === "G50") { ... }   // ❌ jamais, nulle part
```

Conséquence concrète : `due_rule` est une colonne `jsonb` validée par Zod
(`DueRuleSchema`), pas un `switch`. Une règle nouvelle qui ne s'exprime pas avec le
modèle en place fait étendre le **modèle**, jamais le code par cas particulier.

## Le middleware : ce qu'il protège, et ce qu'il ne protège pas

`src/middleware.ts` s'exécute avant chaque route. Il porte, dans cet ordre :

1. le nonce CSP et les en-têtes de sécurité ;
2. l'**identifiant de corrélation** (`x-request-id`), qui descend jusqu'à
   `audit_log.request_id` ;
3. le rafraîchissement de session ;
4. la **limitation de débit des écritures** (60/minute/utilisateur) ;
5. les portes : compte désactivé, liste blanche d'adresses pour ADMIN, second facteur
   exigé.

⚠️ **Il ne protège pas la donnée.** Un utilisateur qui contournerait toutes ces
redirections ne verrait toujours aucune ligne : la RLS s'applique en base. Le
middleware protège l'expérience et la surface HTTP.

## Rendu : serveur par défaut

Server Components partout où il n'y a pas d'interaction. `"use client"` se justifie
au cas par cas — un formulaire, une table triable, une file d'envoi. Le bundle
partagé mesure **102 kB** gzippés (budget : 200 kB), mesuré par `npm run build`.

Deux pièges rencontrés, tous deux documentés au point où ils mordent :

- **Une fonction ne franchit pas la frontière RSC.** Passer un formateur de date en
  prop lève « Functions cannot be passed directly to Client Components ». On passe la
  donnée, le client formate.
- **`router.refresh()` enchaîné sur une Server Action est annulé.** Voir
  `src/hooks/use-query-navigation.ts` et `occurrence-checklist.tsx` : la correction
  qui tient ne repose pas sur un délai mais sur une **condition d'arrêt factuelle** —
  redemander tant que la page n'a pas vu le changement.

## Où trouver quoi

| Question                                | Fichier                                            |
| --------------------------------------- | -------------------------------------------------- |
| Qui a le droit de quoi                  | [security.md](./security.md)                       |
| Que contient la base                    | [data-model.md](./data-model.md)                   |
| Pourquoi tel choix plutôt que tel autre | [decisions.md](./decisions.md)                     |
| Que faire quand ça casse                | [runbook.md](./runbook.md)                         |
| Ce que les tests garantissent           | [testing.md](./testing.md)                         |
| Ce que coûtent les requêtes             | [query-plans.md](./query-plans.md)                 |
| Sauvegardes et restauration             | [backup-strategy.md](./backup-strategy.md)         |
| Changer d'hébergeur                     | [hosting-portability.md](./hosting-portability.md) |
