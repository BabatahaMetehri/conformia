/**
 * Remplaçant de `server-only` pour la suite d'intégration.
 *
 * ⚠️ Le vrai module lève à l'import dès qu'il est chargé hors d'un composant
 * serveur — c'est sa raison d'être, et il ne faut surtout pas la retirer du code
 * de production. Mais la suite d'intégration éprouve les SERVICES eux-mêmes, en
 * Node, hors de tout rendu React : elle a besoin de les importer.
 *
 * Ce remplaçant est donc limité au lanceur de tests, déclaré dans
 * `vitest.integration.mts`. Il ne relâche aucune garantie de production : la
 * barrière qui compte est celle du build Next.js, qui échoue si un module
 * `server-only` atteint un bundle client.
 */
export {};
