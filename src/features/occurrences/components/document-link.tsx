"use client";

import { Download, Eye, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Ouverture d'une pièce.
 *
 * ⚠️ AUCUNE URL n'est connue d'avance. Le composant demande au serveur une URL
 * SIGNÉE, à durée courte, qui journalise son émission au passage. Un `href` posé
 * dans le HTML serait une adresse permanente vers une déclaration fiscale, dont
 * la copie survivrait à la session (CLAUDE.md §1, confidentialité et traçabilité).
 *
 * La fenêtre est ouverte AVANT l'attente réseau, puis pointée sur l'URL obtenue :
 * ouvrir après une promesse est traité comme une pop-up par tous les navigateurs.
 */
export function DocumentActions({
  documentId,
  filename,
}: {
  readonly documentId: string;
  readonly filename: string;
}) {
  const t = useTranslations("occurrences.detail");
  const [busy, setBusy] = useState<"VIEW" | "DOWNLOAD" | null>(null);

  async function open(action: "VIEW" | "DOWNLOAD"): Promise<void> {
    setBusy(action);
    const target = action === "VIEW" ? window.open("", "_blank", "noopener,noreferrer") : null;

    try {
      const response = await fetch(
        `/api/documents/${documentId}/signed-url?action=${action}${
          action === "DOWNLOAD" ? "&download=1" : ""
        }`,
        { method: "POST" },
      );

      if (!response.ok) {
        target?.close();
        toast.error(t("documentUnavailable"));
        return;
      }

      const payload = (await response.json()) as { readonly url: string };
      if (target !== null) {
        target.location.href = payload.url;
        return;
      }
      window.location.href = payload.url;
    } catch {
      target?.close();
      toast.error(t("documentUnavailable"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        aria-label={t("viewDocument", { name: filename })}
        onClick={() => {
          void open("VIEW");
        }}
      >
        {busy === "VIEW" ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        aria-label={t("downloadDocument", { name: filename })}
        onClick={() => {
          void open("DOWNLOAD");
        }}
      >
        {busy === "DOWNLOAD" ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Download aria-hidden="true" className="size-4" />
        )}
      </Button>
    </div>
  );
}
