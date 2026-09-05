# Guide — Administrateur

> Deux pages. Vous tenez les **comptes**, les **rôles**, les **réglages** et le
> **référentiel**. Vous ne voyez **aucun dossier** ni **aucun document** — lisez
> pourquoi avant de le prendre pour un défaut : `pourquoi-admin-ne-voit-pas.md`.

---

## Ce que vous voyez, et ce que vous ne voyez pas

```
  Mes tâches          ✓     Échéancier         ✗
  Référentiel         ✓     Documents          ✗
  Registres           ✓     À valider          ✗
  Absences            ✓     Tableau de bord    ✗
  Administration      ✓
  Journal d'audit     ✓
```

Vous administrez **ce qui décrit** les obligations. Vous ne lisez pas **ce qui
les remplit**. La distinction tient en une phrase, et c'est celle à retenir —
c'est aussi la réponse à donner quand on vous posera la question.

⚠️ Si vous devez **aussi** consulter les dossiers : ne modifiez pas le rôle
`ADMIN`, **ajoutez-vous un second rôle** (`SUPERVISEUR` ou `DIRECTION`) sur votre
compte. Les permissions s'additionnent et l'audit distingue au titre de quoi vous
avez agi. Élargir `ADMIN` toucherait tous les administrateurs, présents et
futurs, sans que personne ne le voie.

---

## Ouvrir un compte

**Administration → Utilisateurs → Inviter.**

Une invitation envoie un lien à usage unique ; la personne choisit **son propre**
mot de passe.

⚠️ **Vous ne fixez jamais le mot de passe de quelqu'un d'autre.** L'application
ne le permet pas, et c'est le bon régime : un mot de passe transmis par courriel
est un mot de passe qui reste dans une boîte pendant des années.

Le rôle se choisit à l'invitation :

| Rôle          | Pour qui                                                   |
| ------------- | ---------------------------------------------------------- |
| `RESPONSABLE` | Prépare les dossiers                                       |
| `SUPPLEANT`   | Prend le relais — **mêmes droits**, seule la trace diffère |
| `SUPERVISEUR` | Contrôle et valide                                         |
| `DIRECTION`   | Valide en second niveau, tient le référentiel              |
| `AUDITOR`     | Lecture seule — **expire au bout de 90 jours**             |
| `EXTERNAL`    | Intervenant externe — **expire au bout de 365 jours**      |

⚠️ Les deux derniers **exigent** une date d'expiration : la base refuse
l'attribution sans elle. Un accès accordé pour une mission ne doit pas survivre à
la mission.

---

## Le second facteur

MFA **obligatoire** pour `ADMIN` et `DIRECTION` : le middleware bloque la session
tant qu'il n'est pas enrôlé. Ce n'est pas contournable, y compris pour vous.

Si quelqu'un perd son téléphone : **Administration → Utilisateurs → Réinitialiser
la MFA**. La personne réenrôle à sa prochaine connexion. ⚠️ Vérifiez son identité
autrement que par courriel avant de le faire : c'est la porte que l'on force en
premier.

---

## Surveiller que la plateforme tourne

**Administration → Travaux planifiés.** Chaque tâche, sa dernière exécution, son
verdict.

⚠️ **Ce qu'il faut regarder n'est pas l'échec, c'est le SILENCE.** Une tâche qui
échoue le dit ; une tâche qui ne tourne plus ne dit rien. Une dernière exécution
qui date de plus de vingt-six heures est le vrai signal.

Trois alertes arrivent aussi dans votre cloche :

- **sauvegarde périmée** — aucune sauvegarde réussie depuis 36 heures ;
- **intégrité** — l'empreinte d'un document ne correspond plus. ⚠️ **Ne supprimez
  rien** : la divergence est elle-même une preuve ;
- **échec d'envoi définitif** — un courriel a épuisé ses tentatives.

---

## Le calendrier des jours fériés — votre rendez-vous annuel

**Administration → Référentiels → Jours fériés.**

⚠️ **Les fêtes religieuses sont fixées par décret** : elles ne se calculent pas,
elles se saisissent, chaque année. Sans elles, une échéance tombant un jour chômé
est traitée comme un jour ouvré.

⚠️ **La mention « récurrent » est informative** : elle ne reporte pas la date sur
l'année suivante. Chaque année doit être saisie, y compris les fêtes civiles à
date fixe.

Chaque 1er décembre, l'outil crée dans **vos** tâches un dossier « Mise à jour du
calendrier des jours fériés N+1 ». C'est votre rappel : il ne dépend pas de votre
mémoire.

---

## Ce que vous ne pouvez pas faire, et c'est normal

- **Lire un dossier ou un document.** Voir plus haut.
- **Créer une délégation pour quelqu'un d'autre.** Vous pouvez en **révoquer**
  une, jamais en consentir une à la place d'un tiers.
- **Modifier le journal d'audit.** Personne ne le peut, y compris vous. Il est
  en écriture seule, par construction de la base.
- **Supprimer une obligation ou un registre.** On **désactive** ; l'historique
  doit rester lisible.
