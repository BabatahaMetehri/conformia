"use client";

import { Download, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * Ouverture et téléchargement d'une pièce.
 *
 * ⚠️ AUCUNE URL de stockage n'est connue du navigateur. Les deux boutons visent
 * une route applicative qui, elle, vérifie le droit, JOURNALISE l'accès, puis
 * redirige vers une URL signée valable 300 secondes. Un `href` direct vers le
 * stockage serait une adresse permanente vers une déclaration fiscale, dont la
 * copie survivrait à la session (CLAUDE.md §1).
 *
 * Deux gestes, deux traces distinctes : `mode=inline` journalise un VIEW,
 * l'absence de ce paramètre un DOWNLOAD. Le journal doit pouvoir répondre à
 * « qui a emporté cette déclaration », pas seulement « qui l'a regardée ».
 *
 * ⚠️ Placé dans `components/shared` : l'échéancier et l'écran /documents en ont
 * tous deux besoin, et la barrière inter-features leur interdit de se partager
 * un composant directement.
 *
 * Aucune attente avant l'ouverture, délibérément : `window.open` appelé après un
 * `await` est traité comme une pop-up par tous les navigateurs et bloqué. La
 * redirection étant faite par le serveur, il n'y a plus rien à attendre — c'est
 * ce que cette route apporte par rapport à une URL signée rendue en JSON.
 */
export function DocumentActions({
  documentId,
  compact = false,
}: {
  readonly documentId: string;
  readonly compact?: boolean;
}) {
  const t = useTranslations("documents.actions");
  const anchor = useRef<HTMLAnchorElement>(null);

  const base = `/api/documents/${documentId}/download`;

  return (
    <>
      <Button
        size={compact ? "icon-sm" : "sm"}
        variant="ghost"
        aria-label={t("view")}
        onClick={() => {
          window.open(`${base}?mode=inline`, "_blank", "noopener,noreferrer");
        }}
      >
        <Eye aria-hidden="true" className="size-4" />
        {compact ? null : t("view")}
      </Button>

      <Button
        size={compact ? "icon-sm" : "sm"}
        variant="ghost"
        aria-label={t("download")}
        onClick={() => {
          // Un clic sur une ancre plutôt qu'une navigation : le serveur répond
          // par une redirection vers une URL signée en pièce jointe, et la page
          // courante ne doit pas être quittée pour autant.
          anchor.current?.click();
        }}
      >
        <Download aria-hidden="true" className="size-4" />
        {compact ? null : t("download")}
      </Button>

      <a ref={anchor} href={base} className="hidden" aria-hidden="true" tabIndex={-1}>
        {t("download")}
      </a>
    </>
  );
}
