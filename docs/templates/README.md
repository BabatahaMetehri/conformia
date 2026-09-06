# Gabarits d'import

## `jours-feries.csv`

Calendrier des jours chômés, à importer depuis **Administration → Référentiels**.

Format : `date,libellé,récurrent` — la date en `AAAA-MM-JJ`. Une ligne d'en-tête
est tolérée. `récurrent` accepte `true`, `1` ou `oui`.

### Les deux natures de jours fériés, et pourquoi elles ne se mélangent pas

**Les cinq fêtes CIVILES** — 1er janvier, Yennayer, 1er mai, 5 juillet,
1er novembre — reviennent au même jour du même mois. Elles sont marquées
`true` : saisies **une fois**, elles valent pour toutes les années. Elles sont
déjà en base ; elles figurent dans le gabarit pour qu'il soit complet, et les
réimporter ne fait rien de plus que les réécrire à l'identique.

**Les fêtes RELIGIEUSES** — Aïd el-Fitr, Aïd el-Adha, Awal Moharem, Achoura,
Mawlid Ennabaoui — suivent le calendrier hégirien et sont fixées **chaque année
par décret**. Elles sont marquées `false` : elles appartiennent à une année et à
une seule.

⚠️ **Ne jamais marquer une fête religieuse `true`.** Elle serait projetée sur
toutes les années à la même date grégorienne — ce qui est faux par construction —
et ferait croire au contrôle de couverture que l'année est saisie, éteignant
l'alerte qui existe précisément pour signaler qu'elle ne l'est pas.

### Les dates religieuses ne sont pas fournies, et c'est délibéré

Les lignes religieuses du gabarit portent `AAAA-MM-JJ` à la place de la date.
Ce n'est pas un oubli : **aucune formule ne peut les calculer**, et une date
devinée serait pire que pas de date du tout — elle ne produirait aucune erreur
visible, seulement une échéance fausse qui a l'air juste.

Le placeholder est **refusé par l'import** tant qu'il n'est pas remplacé : la
ligne est comptée comme illisible et affichée avant l'écriture. C'est le sens
d'erreur voulu — une ligne rejetée se voit, une date inventée non.

Les dates s'obtiennent auprès du cabinet comptable ou du Journal officiel. Le
nombre de jours par fête (un ou deux) est lui aussi fixé par décret : ajuster les
lignes en conséquence plutôt que de supposer.

### Après l'import

L'écran annonce, **avant** d'écrire, combien d'échéances seraient déplacées.
Seuls les dossiers `TODO` bougent — ceux déjà commencés, validés, transmis ou
archivés ne sont jamais déplacés. Pour contrôler la couverture obtenue :

```sql
select * from public.holiday_calendar_coverage;
```
