/**
 * Garde-fou commun aux scripts qui FABRIQUENT des données.
 *
 * ⚠️ UN SCRIPT DE DÉVELOPPEMENT NE DOIT PAS POUVOIR VISER LA PRODUCTION PAR
 * ACCIDENT. Le chemin de l'accident est toujours le même : un terminal resté
 * ouvert, un `.env.local` remplacé, une variable exportée pour un autre besoin,
 * et la commande tapée de mémoire. Rien dans la ligne de commande ne dit alors
 * ce que `DATABASE_URL` contient.
 *
 * Deux verrous, et il faut les deux :
 *
 *   1. `NODE_ENV=production` — refus immédiat. C'est la déclaration
 *      d'intention : un environnement qui se dit de production n'accueille pas
 *      de comptes fabriqués ni de jeu d'essai.
 *   2. Une base NON LOCALE — refus également. Le premier verrou ne suffit pas :
 *      `NODE_ENV` n'est souvent pas posé du tout sur un poste, et son absence
 *      ne prouve rien. L'adresse de la base, elle, dit où l'on écrit.
 *
 * ⚠️ AUCUNE DÉROGATION PAR VARIABLE D'ENVIRONNEMENT. Un `FORCE=1` serait tapé la
 * première fois qu'un refus gênerait, puis conservé dans un alias. Un
 * garde-fou qu'on peut désactiver depuis le même terminal que celui qui a
 * causé l'erreur ne garde rien. La seule façon de passer outre est de modifier
 * ce fichier — donc de le relire.
 */

/** Adresses qu'on tient pour locales. Rien d'autre n'est accepté. */
const LOCAL = /(?:127\.0\.0\.1|::1|\blocalhost\b|host\.docker\.internal)/;

/**
 * @param {string} intitule Ce que le script fabrique, pour le message de refus.
 * @param {string} connectionString Adresse de la base visée.
 */
export function refuseProduction(intitule, connectionString) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      `REFUS : NODE_ENV vaut « production ».\n` +
        `${intitule} n'a rien à faire sur une installation réelle.\n` +
        `Si l'environnement est mal étiqueté, corrigez l'étiquette — pas ce script.`,
    );
    process.exit(1);
  }

  if (!LOCAL.test(connectionString)) {
    /*
     * L'adresse n'est PAS affichée : elle porte le mot de passe de la base.
     * Nommer la variable suffit à savoir où regarder.
     */
    console.error(
      `REFUS : DATABASE_URL ne pointe pas vers une base locale.\n` +
        `${intitule} n'a rien à faire sur une installation réelle.\n` +
        `Vérifiez la variable DATABASE_URL de votre terminal et de votre .env.local.`,
    );
    process.exit(1);
  }
}
