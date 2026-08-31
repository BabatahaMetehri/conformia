import { FileQuestion, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * États d'écran : vide, en erreur, en chargement.
 * Purement présentationnels — ils reçoivent ce qu'ils affichent.
 */

// ─── Vide ────────────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  /** Action de sortie : « créer », « élargir le filtre »… */
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <FileQuestion aria-hidden="true" className="size-8 text-text-muted" />
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-prose text-sm text-text-muted">{description}</p>
      )}
      {action}
    </div>
  );
}

// ─── Erreur ──────────────────────────────────────────────────────────────────

export function ErrorState({
  title,
  description,
  correlationId,
  action,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  /**
   * Identifiant de corrélation. C'est ce que l'utilisateur lit au support, et
   * ce que le support retrouve dans les journaux : sans lui, « ça ne marche
   * pas » n'est pas diagnosticable. Jamais de détail technique à l'écran — la
   * cause reste côté serveur.
   */
  readonly correlationId?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  const t = useTranslations("errors");

  return (
    <div
      // `role="alert"` : l'erreur est annoncée dès son apparition.
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-status-overdue/40 bg-status-overdue-bg px-6 py-10 text-center",
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-8 text-status-overdue" />
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-prose text-sm text-text-secondary">{description}</p>
      )}
      {correlationId === undefined ? null : (
        // `text-secondary` et non `text-muted` : sur le fond teinte de l'erreur,
        // le gris attenue tombe a 4.31:1, sous le plancher AA. C'est justement
        // la ligne qu'un utilisateur doit pouvoir recopier au support.
        <p className="text-xs text-text-secondary">
          {t("correlationId")}{" "}
          <code data-numeric className="rounded bg-surface-raised px-1 py-0.5">
            {correlationId}
          </code>
        </p>
      )}
      {action}
    </div>
  );
}

// ─── Chargement ──────────────────────────────────────────────────────────────

/**
 * Squelettes calqués sur le contenu attendu — JAMAIS d'indicateur circulaire.
 *
 * Un cercle qui tourne ne dit rien : ni ce qui arrive, ni combien. Un squelette
 * qui a la forme du tableau à venir évite le saut de mise en page au moment où la
 * donnée arrive, et l'œil a déjà trouvé ses repères.
 */
export function LoadingState({
  variant = "list",
  rows = 5,
  label,
  className,
}: {
  readonly variant?: "list" | "table" | "card" | "detail";
  readonly rows?: number;
  /** Annonce vocale ; l'attente doit être perceptible sans voir l'écran. */
  readonly label: string;
  readonly className?: string;
}) {
  const lines = Array.from({ length: rows }, (_, index) => index);

  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("space-y-3", className)}>
      <span className="sr-only">{label}</span>

      {variant === "table" ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-4 border-b border-border bg-surface-raised px-4 py-2.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ms-auto h-4 w-24" />
          </div>
          {lines.map((line) => (
            <div
              key={line}
              className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-24 rounded-md" />
              <Skeleton className="ms-auto h-4 w-28" />
            </div>
          ))}
        </div>
      ) : null}

      {variant === "list" ? (
        <div className="space-y-2">
          {lines.map((line) => (
            <div
              key={line}
              className="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
            >
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {variant === "card" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lines.map((line) => (
            <div key={line} className="space-y-3 rounded-lg border border-border p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      {variant === "detail" ? (
        <div className="space-y-4">
          <Skeleton className="h-7 w-1/2" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-24 rounded-md" />
            <Skeleton className="h-6 w-28 rounded-md" />
          </div>
          <Skeleton className="h-24 w-full rounded-lg" />
          {lines.slice(0, 3).map((line) => (
            <Skeleton key={line} className="h-4 w-full" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
