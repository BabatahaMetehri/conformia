/**
 * Réglages d'exploitation du module de notification.
 *
 * ⚠️ Ce fichier ne contient AUCUNE règle métier. Les jalons (J-30, J-15, J-7,
 * J-1, J+1, J+3, J+7) et les paliers d'escalade vivent en base, dans
 * `notification_rules` et `escalation_policies` — ajouter un jalon ne doit
 * demander aucun déploiement (CLAUDE.md §3.5). Ce qui suit relève du transport :
 * combien de messages par lot, combien de tentatives, à quel rythme.
 */

/**
 * Taille d'un lot d'envoi.
 *
 * Cinquante est un compromis mesuré, pas un chiffre rond : assez grand pour que
 * le volume estimé (~300 messages par mois) parte en une exécution, assez petit
 * pour qu'un incident fournisseur au milieu du lot laisse la majorité des lignes
 * intactes et rejouables.
 */
export const EMAIL_BATCH_SIZE = 50;

/**
 * Tentatives d'envoi par message, temporisation exponentielle comprise.
 *
 * Au-delà, le message est en échec DÉFINITIF et sort de la file. Réessayer sans
 * fin une adresse morte noierait les envois suivants dans un lot saturé de
 * messages qui ne partiront jamais.
 */
export const MAX_EMAIL_ATTEMPTS = 3;

/**
 * Base de la temporisation exponentielle, en millisecondes : 1 s, puis 2 s,
 * puis 4 s. Volontairement court — un lot horaire ne peut pas passer vingt
 * minutes à attendre, et un fournisseur indisponible depuis une seconde le
 * restera probablement à la minute suivante. Le vrai filet est la reprise au
 * cycle suivant, pas l'obstination dans le cycle courant.
 */
export const EMAIL_RETRY_BASE_MS = 1_000;

/**
 * Débit maximal soutenu vers le fournisseur.
 *
 * Resend limite à 2 messages par seconde sur son offre gratuite. On vise en
 * dessous : se faire limiter produit un échec indistinguable d'une panne, donc
 * une tentative consommée pour rien.
 */
export const EMAIL_RATE_LIMIT_PER_SECOND = 2;

/** Intervalle minimal entre deux envois, dérivé du débit ci-dessus. */
export const EMAIL_MIN_INTERVAL_MS = Math.ceil(1_000 / EMAIL_RATE_LIMIT_PER_SECOND);

/**
 * Fenêtre de regroupement.
 *
 * Les alertes d'un même destinataire tombant dans la même heure partent en UN
 * seul message. L'heure n'est pas un réglage arbitraire : c'est la période du
 * planificateur, donc la plus petite fenêtre dans laquelle deux alertes peuvent
 * se retrouver côte à côte.
 */
export const GROUPING_WINDOW_MS = 60 * 60 * 1_000;

/** Horizon du flux calendrier, en mois. */
export const CALENDAR_FEED_MONTHS = 12;

/**
 * Rappel porté par chaque événement du flux, en jours avant l'échéance interne.
 * Aligné sur le jalon J-7, qui est le dernier moment où un dossier non commencé
 * peut encore l'être sans travail en urgence.
 */
export const CALENDAR_ALARM_DAYS_BEFORE = 7;

/** Nombre d'occurrences détaillées dans un résumé avant de renvoyer à l'écran. */
export const DIGEST_MAX_ROWS_PER_SECTION = 15;

/**
 * Âge maximal d'une sauvegarde réussie avant alerte, en heures.
 *
 * ⚠️ 36 et non 24 : la sauvegarde tourne à 03 h 00, et une exécution qui prend du
 * retard ou échoue une seule fois ne doit pas réveiller la Direction. Trente-six
 * heures laissent passer un incident isolé et rattrapé, et signalent deux
 * échecs consécutifs — c'est-à-dire un vrai problème.
 */
export const BACKUP_STALE_AFTER_HOURS = 36;
