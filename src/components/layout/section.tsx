import { Construction } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { LoadingState } from "@/components/shared/states";

/**
 * Chrome commun à toutes les sections : titre, description, place du contenu.
 *
 * Partagé, contrairement aux tableaux métier que CLAUDE.md §3.4 impose de garder
 * séparés. La distinction est nette : un en-tête de page ne porte aucune règle,
 * il n'a rien à faire diverger. Un tableau d'occurrences et un tableau de
 * documents, eux, portent des métiers distincts et restent distincts.
 */

export async function SectionHeader({
  titleKey,
  descriptionKey,
  actions,
}: {
  /** Clé sous `sections`, sans le suffixe `.title`. */
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly actions?: ReactNode;
}) {
  const t = await getTranslations("sections");

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">
          {t(`${titleKey}.title`)}
        </h1>
        {descriptionKey === undefined ? null : (
          <p className="mt-1 max-w-prose text-sm text-text-secondary">
            {t(`${descriptionKey}.description`)}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}

/**
 * Marque-place d'une section dont l'écran métier n'existe pas encore.
 *
 * Il DIT qu'il n'y a rien, plutôt que de simuler un contenu. Une fausse liste de
 * démonstration ferait croire l'application plus avancée qu'elle ne l'est, et
 * quelqu'un finirait par la prendre pour une vraie.
 */
export async function SectionPlaceholder() {
  const t = await getTranslations("layout");

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <Construction aria-hidden="true" className="size-8 text-text-muted" />
      <p className="text-sm font-medium text-text-primary">{t("underConstruction")}</p>
      <p className="max-w-prose text-sm text-text-muted">{t("underConstructionHint")}</p>
    </div>
  );
}

/**
 * Squelette d'attente d'une section.
 *
 * `variant` est choisi par chaque `loading.tsx` selon la forme du contenu à
 * venir : un squelette de tableau devant une liste de cartes déplacerait tout au
 * moment où la donnée arrive, ce qui est pire que pas de squelette du tout.
 */
export async function SectionLoading({
  variant = "table",
  rows,
}: {
  readonly variant?: "list" | "table" | "card" | "detail";
  readonly rows?: number;
}) {
  const t = await getTranslations("common.states");

  return (
    <div className="space-y-6">
      <div className="h-7 w-64 animate-pulse rounded bg-surface-raised" />
      <LoadingState
        variant={variant}
        label={t("loading")}
        {...(rows === undefined ? {} : { rows })}
      />
    </div>
  );
}
