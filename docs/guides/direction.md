# Guide — Direction

> Deux pages. Vous voyez **tout le contenu métier**, vous validez en second
> niveau, vous tenez le référentiel. Vous n'ouvrez pas de comptes — c'est
> l'administrateur, et c'est délibéré.

---

## Le tableau de bord répond à une question

> **« Où en sommes-nous, et qu'est-ce qui va nous coûter cher ? »**

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│    EN RETARD    │  À VALIDER      │   CETTE SEMAINE │   CONFORMITÉ    │
│        2        │        4        │        7        │      94 %       │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

⚠️ **« En retard » se lit sur l'échéance INTERNE**, pas l'échéance légale. Un
dossier en retard ici n'est pas encore en retard vis-à-vis de l'administration :
il a mangé sa marge. C'est un avertissement, pas une pénalité — et c'est
exactement le moment où il est encore temps.

Le taux de conformité compte les dossiers déposés dans les délais sur l'ensemble
des dossiers échus. Il ne compte pas les dossiers à venir : un taux qui monterait
mécaniquement avec le temps ne dirait rien.

---

## Votre rôle dans le circuit

**Second niveau de validation.** Certaines obligations exigent deux validations :
le superviseur donne la première, vous donnez la seconde. Écran **À valider**.

**Le recours quand la séparation des pouvoirs bloque.** Si le superviseur a
lui-même préparé un dossier, il ne peut pas le valider. C'est vous qui validez —
c'est prévu, ce n'est pas un contournement.

**Déverrouiller un dossier archivé.** Vous seule pouvez rouvrir une archive, pour
y verser un justificatif ancien par exemple. ⚠️ **Un motif écrit est obligatoire**
et reste dans l'historique : une archive rouverte sans raison lisible ferait
perdre à l'archive ce qui lui donne sa valeur.

---

## Le référentiel, c'est vous

Écran **Référentiel**. Vous pouvez ajouter une obligation, corriger une échéance,
changer une périodicité — sans passer par l'administrateur.

C'est voulu : le référentiel est du **contenu métier**, pas de la configuration
technique. Un texte change, une échéance bouge ; c'est une décision de
conformité, pas une opération informatique.

⚠️ **Avant d'enregistrer, regardez les six prochaines dates** que l'écran
calcule. C'est là qu'une règle fausse se voit — et une échéance fausse ne produit
aucune erreur visible, seulement un rappel au mauvais moment et une pénalité au
bon.

Après modification d'une règle, l'outil vous propose de **recalculer les dossiers
futurs**, en vous disant combien sont concernés. Les dossiers passés ne bougent
jamais.

---

## La question encore ouverte, à trancher avec le cabinet comptable

**CASNOS se dédouble**, et le référentiel n'en suit aujourd'hui qu'une moitié :

- le **paiement** de la cotisation, au **30 juin** — confirmé, c'est la ligne
  présente dans le référentiel ;
- une **déclaration** préalable, fin janvier ou fin février selon les sources —
  ⚠️ **date non confirmée, obligation volontairement non créée**.

La créer avec une date devinée serait pire que son absence : une échéance fausse
ne produit aucune erreur visible, seulement un rappel au mauvais moment — et
l'équipe prendrait l'habitude de s'y fier. Dès que la date est confirmée :
**Référentiel → Nouvelle obligation**, trois minutes.

_(CNAS-DAS est corrigée : 31 janvier, et non 31 mars comme retenu au départ.)_

## Ce que vous ne voyez pas, et pourquoi

**Utilisateurs** et **Rôles** ne sont pas dans votre menu. Le pouvoir métier ne
s'attribue pas ses propres droits : c'est la contrepartie du fait que
l'administrateur, lui, ne voit aucun dossier.

Vous avez en revanche le **Journal d'audit** : qui a fait quoi, quand, sur quel
dossier, avec l'état avant et après. Rien n'y est modifiable ni effaçable, par
personne — y compris par l'administrateur.

---

## Les trois questions qui reviennent

**« Pourquoi l'administrateur ne voit-il pas les dossiers ? »**
Pour que la personne qui installe le logiciel ne soit pas la mieux informée de
l'entreprise. Détail dans `pourquoi-admin-ne-voit-pas.md`.

**« Un dossier est en retard mais la déclaration a été déposée. »**
Le dépôt n'a pas été enregistré dans l'outil. C'est le seul cas où l'indicateur
ment — et il ment parce qu'on ne lui a rien dit.

**« Puis-je exporter pour le commissaire aux comptes ? »**
Oui : écran **Rapports**. Tableau de suivi, taux de conformité, ou archive
complète d'un dossier avec ses pièces et un manifeste d'empreintes.
