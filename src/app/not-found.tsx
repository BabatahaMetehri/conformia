import Link from "next/link";

import { DEFAULT_LOCALE } from "@/config/constants";

/**
 * 404 racine, hors segment `[locale]`.
 *
 * Il n'est atteint que par une URL qui n'a même pas de préfixe de locale
 * exploitable — le middleware en redirige normalement toutes. Aucun catalogue
 * de messages n'est joignable à ce niveau : c'est la même exception documentée
 * que `global-error.tsx` à l'interdit « aucune chaîne en dur » (CLAUDE.md §6).
 * Texte minimal, aucune information technique.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-text-primary">Page introuvable</h1>
      <p className="mt-2 text-sm text-text-secondary">
        Cette page n&apos;existe pas, ou elle ne vous est pas accessible.
      </p>
      <p className="mt-6">
        <Link href={`/${DEFAULT_LOCALE}/my-tasks`} className="text-sm text-primary underline">
          Revenir à l&apos;accueil
        </Link>
      </p>
    </main>
  );
}
