import { SectionHeader, SectionPlaceholder } from "@/components/layout/section";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Coquille de détail. Elle porte la MÊME garde que sa section : le droit de
 * lister et le droit d'ouvrir une fiche ne se dissocient pas.
 *
 * L'identifiant est affiché tel quel — le fil d'Ariane le reprend comme dernier
 * segment, faute de libellé à lui donner tant que l'écran métier n'existe pas.
 */
export default async function Page({ params }: { params: Promise<{ obligationId: string }> }) {
  await requireSectionAccess("/obligations");
  const resolved = await params;

  return (
    <>
      <SectionHeader titleKey="obligations" />
      <p data-numeric className="mb-6 text-sm text-text-muted">
        {resolved.obligationId}
      </p>
      <SectionPlaceholder />
    </>
  );
}
