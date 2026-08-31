import { NotFoundScreen } from "@/components/layout/not-found-screen";

/**
 * Écran rendu par tout `notFound()` levé dans la zone authentifiée — y compris
 * par la garde de section, qui s'en sert pour refuser un accès sans le dire.
 * Voir `src/components/layout/not-found-screen.tsx` pour le pourquoi.
 */
export default function NotFound() {
  return <NotFoundScreen />;
}
