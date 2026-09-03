import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { NavIcon } from "@/components/layout/nav-icon";
import { EmptyState } from "@/components/shared/states";
import type { NavItem } from "@/config/navigation";
import { Link } from "@/i18n/navigation";

/**
 * Sommaire de l'administration.
 *
 * ⚠️ IL NE DÉCIDE RIEN. Les entrées viennent de l'arbre de navigation DÉJÀ
 * filtré par les permissions de la session : ce sommaire montre exactement ce
 * que la barre latérale montre, jamais une entrée de plus. Réécrire la liste ici
 * produirait une seconde formulation des droits, vouée à diverger — et le jour
 * où deux formulations divergent, c'est la moins stricte qui gagne.
 *
 * ⚠️ Une section absente n'est pas grisée, elle est ABSENTE. La charge envoyée
 * au navigateur ne la mentionne pas.
 */
export async function AdminHub({ sections }: { readonly sections: readonly NavItem[] }) {
  const t = await getTranslations();

  if (sections.length === 0) {
    return (
      <EmptyState title={t("admin.hub.emptyTitle")} description={t("admin.hub.emptyDescription")} />
    );
  }

  return (
    <>
      <p className="mb-4 text-sm text-text-secondary">{t("admin.hub.intro")}</p>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <li key={section.id}>
            <Link
              href={section.href}
              className="hover:bg-surface-muted flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <NavIcon name={section.icon} className="mt-0.5 size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text-primary">
                  {t(`nav.${section.labelKey}`)}
                </span>
                <span className="mt-0.5 block text-xs text-text-secondary">
                  {t(`sections.${section.labelKey}.description`)}
                </span>
              </span>
              {/* `rtl:-scale-x-100` : un chevron « suivant » pointe vers la
                  gauche en arabe. Une flèche qui garde son sens ferait revenir
                  en arrière, visuellement. */}
              <ChevronRight
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-text-muted rtl:-scale-x-100"
              />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
