import { SectionLoading } from "@/components/layout/section";

/**
 * ⚠️ SANS CE FICHIER, LE CLIC NE RÉPOND PAS.
 *
 * Next.js n'affiche rien tant que le rendu serveur n'est pas revenu : la page
 * précédente reste à l'écran, figée. L'utilisateur croit que son clic s'est
 * perdu et reclique — ce qui n'accélère rien et donne l'impression d'une
 * application « qui met des heures ».
 *
 * Le squelette ne rend pas la page plus rapide. Il rend l'attente LISIBLE, ce
 * qui est le seul point sur lequel on puisse agir depuis ici.
 */
export default function Loading() {
  return <SectionLoading variant="list" />;
}
