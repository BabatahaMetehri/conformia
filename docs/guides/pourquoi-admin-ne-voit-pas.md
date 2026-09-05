# « Pourquoi l'administrateur ne voit-il pas les documents ? »

Cette question sera posée. Elle ressemblera à un défaut. Elle n'en est pas un —
c'est la décision la plus importante du modèle d'accès, et elle se défend très
bien à condition d'être préparée.

⚠️ **À lire avant la première session de formation.** Une réponse improvisée est
toujours moins convaincante qu'une réponse préparée.

---

## La réponse courte, à donner telle quelle

> L'administrateur gère les **comptes**, les **rôles** et les **réglages**. Il ne
> lit pas les déclarations fiscales de l'entreprise, ni les bulletins de paie, ni
> les correspondances avec l'administration. Ce n'est pas un oubli : c'est fait
> exprès, et c'est vérifié à chaque livraison.

Puis, si l'on demande pourquoi :

> Parce que sinon, la personne qui installe le logiciel serait la mieux informée
> de l'entreprise.

Cette phrase suffit presque toujours. Elle déplace la question de « c'est une
gêne » vers « c'est une protection », et personne ne défend l'inverse une fois
qu'il est dit à voix haute.

---

## Ce que voit réellement chaque rôle

|                             | Dossiers | Documents | Référentiel | Comptes |
| --------------------------- | :------: | :-------: | :---------: | :-----: |
| **Administrateur**          |    —     |     —     |      ✓      |    ✓    |
| **Direction**               |    ✓     |     ✓     |      ✓      |    —    |
| **Responsable / Suppléant** |    ✓     |     ✓     |   lecture   |    —    |
| **Superviseur**             |    ✓     |     ✓     |   lecture   |    —    |

L'administrateur voit le **Référentiel** et les **Registres** : ce sont les
objets qui **décrivent** les obligations. Il ne voit pas ce qui les **remplit**.
La distinction tient en une phrase, et c'est celle qu'il faut retenir.

Symétriquement, la Direction administre le référentiel mais n'ouvre aucun compte :
le pouvoir métier ne s'attribue pas ses propres droits.

---

## Les trois objections, et leurs réponses

**« J'en ai besoin pour dépanner. »**

Non. Un incident se diagnostique avec le **journal d'audit** — qui a fait quoi,
quand, sur quelle entité, avec quel identifiant de corrélation — auquel
l'administrateur a pleinement accès. Le contenu du dossier n'aide en rien à
comprendre pourquoi une transition a été refusée. En pratique, aucun incident de
ce projet n'a demandé de lire une pièce.

**« De toute façon je peux lire la base. »**

Avec un accès direct au serveur, oui — et c'est précisément pour cela que cet
accès est une procédure **exceptionnelle et tracée**, et non le fonctionnement
quotidien d'un compte applicatif. La différence entre « ce serait techniquement
possible » et « c'est accordé par défaut » est toute la différence le jour où il
faut expliquer qui a vu quoi.

**« Ça complique le support. »**

Un peu, et c'est le prix. Il est bas : la Direction et l'auditeur ont la lecture
qui leur revient, et le journal d'audit répond aux questions de support.

---

## Ce qu'il faut faire si le besoin est réel

Si vous devez **aussi** consulter les dossiers, la réponse n'est pas d'élargir
`ADMIN` : c'est de **cumuler les rôles** sur votre compte.

Administration → Utilisateurs → votre compte → ajouter `SUPERVISEUR` ou
`DIRECTION`.

Les permissions s'additionnent, et le journal d'audit continue de distinguer
**au titre de quel rôle** chaque action a été faite. Vous gardez donc les deux
casquettes, et l'historique dit laquelle vous portiez.

⚠️ **Ce qu'il ne faut pas faire :** ajouter `occurrence.read` au rôle `ADMIN`.
Cela ne toucherait pas un compte mais **le rôle**, donc tous les administrateurs
présents et futurs, et romprait la séparation pour tout le monde — silencieusement.
