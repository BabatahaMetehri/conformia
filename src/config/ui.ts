/**
 * Constantes de la coquille applicative.
 *
 * Isolées de `constants.ts`, qui porte le vocabulaire métier : un nom de cookie
 * d'affichage n'a rien à faire à côté des statuts d'occurrence.
 */

/** Préférence de repli de la barre latérale. Lue au rendu serveur. */
export const SIDEBAR_COOKIE = "conformia.sidebar";

/** Un an : une préférence d'affichage n'a pas de raison d'expirer plus tôt. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Anti-rebond de la recherche globale, en millisecondes.
 *
 * 250 ms : au-dessous, une frappe normale déclenche une requête par touche ; au-
 * dessus, la palette paraît collante. La valeur n'est pas configurable — elle
 * relève de la perception, pas du paramétrage.
 */
export const SEARCH_DEBOUNCE_MS = 250;
