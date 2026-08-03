"use client";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Dernier filet de sécurité : s'affiche quand le layout racine lui-même a échoué,
 * donc en dehors du provider i18n.
 *
 * Exception documentée à l'interdit « aucune chaîne en dur dans un composant »
 * (CLAUDE.md §6) : aucun catalogue de messages n'est joignable à ce stade du rendu.
 * Texte minimal, aucune information technique divulguée.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="fr" dir="ltr">
      <body>
        <main>
          <h1>Une erreur est survenue</h1>
          <p>L&apos;application n&apos;a pas pu afficher cette page.</p>
          {error.digest === undefined ? null : <p>Référence : {error.digest}</p>}
          <button type="button" onClick={reset}>
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
