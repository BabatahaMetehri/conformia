import { SectionHeader, SectionPlaceholder } from "@/components/layout/section";
import { requireSectionAccess } from "@/services/navigation/guard";

/**
 * Coquille du détail d'une occurrence. Elle porte la MÊME garde que la liste :
 * le droit de lister et celui d'ouvrir un dossier ne se dissocient pas.
 */
export default async function Page({ params }: { params: Promise<{ occurrenceId: string }> }) {
  await requireSectionAccess("/echeancier");
  const resolved = await params;

  return (
    <>
      <SectionHeader titleKey="occurrences" />
      <p data-numeric className="mb-6 text-sm text-text-muted">
        {resolved.occurrenceId}
      </p>
      <SectionPlaceholder />
    </>
  );
}
