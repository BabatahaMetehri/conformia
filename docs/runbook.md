# Manuel d'exploitation

À lire quand quelque chose ne va pas, ou avant d'y toucher.

## Vérifier l'état en dix secondes

```bash
curl -s http://localhost:3000/api/health | jq
```

Trois verdicts possibles :

| `status`   | Signification                                    | Code HTTP |
| ---------- | ------------------------------------------------ | --------- |
| `ok`       | Tout répond, tout a tourné récemment             | 200       |
| `degraded` | La plateforme sert, mais une tâche est en retard | 200       |
| `down`     | Base ou stockage injoignable                     | **503**   |

Le détail (dates, ancienneté, compteurs) n'est rendu qu'avec l'en-tête
`x-cron-secret` : « la dernière sauvegarde date de six jours » n'est pas une phrase à
publier.

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/health | jq .detail
```

L'écran **Administration → Travaux planifiés** (`/fr/admin/jobs`) dit la même chose en
plus lisible, avec l'historique des exécutions.

### ⚠️ Ce sur quoi une surveillance externe NE DOIT PAS être pointée

Si une sonde externe est mise en place un jour, elle interroge **`/api/health`**, et
rien d'autre.

En particulier : **ne pas pointer une sonde sur l'URL d'une fiche** —
`/fr/echeancier/<identifiant>`, `/fr/documents/<identifiant>` — pour détecter la
disparition d'une ressource. Ces écrans rendent l'état « introuvable » avec un
statut **200**, délibérément : voir `docs/decisions.md` § 15. Une sonde qui compte
les codes de statut y verrait toujours un succès, y compris après la suppression de
la fiche — elle rassurerait au lieu d'alerter, ce qui est pire qu'une absence de
sonde.

Une fiche exige de surcroît une session valide : sans elle, la réponse est une
redirection 307 vers la connexion, et la sonde mesurerait l'authentification, pas la
disponibilité.

## Les symptômes, et ce qu'ils veulent dire

### « Les échéances du mois n'apparaissent pas »

La génération n'a pas tourné. Vérifier :

```sql
select job_name, status, started_at, finished_at, processed_count, error_count
from public.job_runs where job_name = 'generate-occurrences'
order by started_at desc limit 5;
```

- **Aucune ligne** → le planificateur ne déclenche plus. Vérifier `pg_cron` :
  `select * from cron.job;`
- **Statut `RUNNING` figé** → un processus interrompu. Le verrou consultatif se libère
  à la fin de la session ; redémarrer la tâche suffit normalement.
- **Statut `PARTIAL`** → certaines obligations ont échoué, les autres ont abouti.
  `details` porte lesquelles. C'est délibéré : dire « réussi » masquerait les
  obligations non traitées, dire « échoué » masquerait les autres.

Relance manuelle :

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/generate
```

⚠️ **La relance est idempotente.** Elle ne crée pas de doublon : la clé
`(entité, obligation, période)` est unique.

### « Les rappels ne partent plus »

```sql
select count(*) from public.notifications where sent_at is null and scheduled_for <= now();
```

Un nombre qui grimpe = le distributeur ne tourne plus. Même diagnostic que ci-dessus
avec `job_name = 'process-notifications'`. Relance :

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/notifications
```

⚠️ **Un échec d'envoi n'interrompt jamais le lot** : la notification est marquée en
échec, `retry_count` augmente, et le traitement continue. Une adresse invalide ne doit
pas priver quarante personnes de leur rappel.

### « Un utilisateur ne voit pas un dossier qu'il devrait voir »

Dans l'ordre, sans en sauter :

1. **Son rôle porte-t-il la permission ?** → `/fr/admin/roles`
2. **Son rôle couvre-t-il le domaine ?** `user_roles.domain_id` — `NULL` = tous.
3. **Le rôle est-il actif ?** `revoked_at is null` et `expires_at` non dépassé.
4. **La RLS rend-elle la ligne ?** À vérifier SOUS SA SESSION, jamais en `postgres` :

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"<son-uuid>","role":"authenticated"}', true);
set local role authenticated;
select id, period_key, status from public.obligation_occurrences where id = '<dossier>';
rollback;
```

Zéro ligne ici = la RLS refuse, et c'est la réponse. Le problème est alors dans
l'affectation, pas dans l'application.

### « Un administrateur est bloqué sur l'écran d'enrôlement »

C'est le fonctionnement prévu : `ADMIN` et `DIRECTION` ne passent pas sans second
facteur. Deux causes réelles :

1. **TOTP désactivé côté Supabase.** Symptôme : l'écran affiche « Une erreur
   inattendue est survenue » au lieu du QR. Vérifier `[auth.mfa.totp]` —
   `enroll_enabled` ET `verify_enabled` à `true`. C'est la panne la plus sévère du
   système : elle verrouille tous les comptes d'administration.
2. **Facteur perdu** (téléphone changé). Réinitialisation par un autre porteur de
   `user.manage` : `/fr/admin/users` → réinitialiser le second facteur. L'action est
   tracée (`MFA_RESET`) et exige un motif.

⚠️ **Si plus AUCUN administrateur ne peut entrer**, la sortie de secours passe par la
base :

```sql
-- Retire l'exigence le temps de rétablir un facteur. À REMETTRE ensuite.
update public.app_settings set value = 'false' where key = 'require_mfa_all_users';
delete from auth.mfa_factors where user_id = '<uuid de l administrateur>';
```

### « L'écran ne se met pas à jour après une action »

Défaut connu et corrigé, mais dont la forme peut réapparaître ailleurs :
`router.refresh()` enchaîné sur une Server Action **est annulé** par le navigateur.
La correction retenue ne repose pas sur un délai mais sur une condition d'arrêt
factuelle — redemander la page tant qu'elle n'a pas vu le changement, en nombre borné.
Voir `src/hooks/use-query-navigation.ts` et `occurrence-checklist.tsx`.

Si un nouvel écran présente le symptôme, chercher un `router.refresh()` ou un
`router.replace()` appelé dans la foulée d'une action.

### « Trop de requêtes » (429)

L'utilisateur a dépassé 60 écritures en une minute. Dans l'usage réel, cela signale
presque toujours un onglet resté ouvert sur une action qui se relance seule. Vérifier :

```sql
select subject, count(*) from public.rate_limit_hits
where occurred_at > now() - interval '5 minutes'
group by subject order by count(*) desc limit 5;
```

## Sauvegardes

Procédure complète : [backup-strategy.md](./backup-strategy.md) et
[restore-procedure.md](./restore-procedure.md).

⚠️ **L'alerte qui compte** : aucune sauvegarde réussie depuis 36 heures déclenche une
notification aux administrateurs (`notify_admins_of_stale_backup`). Tant que personne
n'alimente `backup_runs`, cette alerte est allumée **en permanence** — c'est voulu :
un dispositif de sauvegarde absent ne doit pas ressembler à un dispositif silencieux.

Épreuve de restauration mensuelle : `npm run restore:test`. C'est **la seule chose qui
transforme « on a des sauvegardes » en fait** ; le reste dit qu'un fichier existe.

### Durée de restauration — à remplir après la première restauration réelle

⚠️ **Une durée inconnue est une durée qu'on découvrira le jour de l'incident**,
devant quelqu'un qui attend une réponse. Le chiffre ci-dessous se mesure une fois,
puis se vérifie à chaque épreuve mensuelle.

| Mesuré le   | Volume base | Volume pièces | Durée totale | Par qui |
| ----------- | ----------- | ------------- | ------------ | ------- |
| _à remplir_ |             |               |              |         |

Ce qu'il faut chronométrer : **de la décision de restaurer à l'application qui
répond**, pas la seule commande. Le téléchargement de l'archive depuis le NAS et
la remise en route en font partie — ce sont eux qui surprennent.

⚠️ Reporter aussi cette durée dans le plan de retour arrière
(`docs/go-live.md`, section G) : c'est là qu'on la cherchera.

## Diagnostiquer avec l'audit

Toute écriture métier laisse une ligne. Depuis la migration 0016, elle porte
l'**identifiant de corrélation** de la requête.

```sql
-- Tout ce qu'une même requête a produit
select occurred_at, action, entity_table, entity_id_ref, actor_email
from public.audit_log where request_id = '<uuid>' order by occurred_at;

-- Tout ce qu'une personne a fait aujourd'hui
select occurred_at, action, entity_table, entity_id_ref
from public.audit_log
where actor_email = 'x@agroespace.dz' and occurred_at > current_date
order by occurred_at desc;
```

L'identifiant est aussi rendu dans l'en-tête `x-request-id` de chaque réponse : un
utilisateur qui signale un incident peut le donner, et le journal serveur, la ligne
d'audit et sa capture d'écran se rejoignent sans enquête.

⚠️ `audit_log` est **append-only**, garanti par trigger. Aucun `UPDATE`, aucun
`DELETE`, y compris en `postgres` sans désactiver explicitement le trigger.

## Mesurer avant d'optimiser

```bash
npm run db:plans      # docs/query-plans.md, sous session utilisateur (RLS appliquée)
npm run load-test     # 50 sessions simultanées
```

⚠️ Un plan relevé en `postgres` ne dit rien d'utile : les fonctions `security definer`
de la RLS ne s'inlinent pas, et l'écart atteint un à deux ordres de grandeur.

Référence mesurée sur le poste de développement (une instance Node, base locale) :

| Mesure                        | Valeur    |
| ----------------------------- | --------- |
| Page, un utilisateur seul     | ~100 ms   |
| Page, 50 sessions simultanées | p95 2,0 s |
| Débit                         | ~31 req/s |
| Échecs sur 200 requêtes       | 0         |

La médiane à 1,6 s sous rafale n'est **pas** une latence par requête : c'est la file
d'attente d'un processus unique servant cinquante demandes arrivées ensemble. Le coût
serveur par page reste d'environ 30 ms.

## Avant toute annonce de mise en production

```bash
npm run typecheck && npm run lint && npm test && npm run test:rls && npm run test:e2e
```

Et vérifier :

- [ ] `[auth.mfa.totp]` activé sur le projet hébergé ;
- [ ] `CRON_SECRET`, `BACKUP_ENCRYPTION_KEY` posés, et **la clé de chiffrement stockée
      ailleurs que les sauvegardes** ;
- [ ] une première sauvegarde réussie, et une épreuve de restauration passée ;
- [ ] `/api/health` interrogé par la supervision de l'hébergeur.
