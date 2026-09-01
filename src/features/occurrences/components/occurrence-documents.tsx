"use client";

import { ChevronDown, FileText, History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocumentActions } from "@/features/occurrences/components/document-link";
import { formatDateTimeFr } from "@/lib/dates";
import type { AttachedDocumentView, OccurrenceDetailView } from "@/services/occurrences/detail";

/**
 * Onglet « Documents » : toutes les pièces du dossier.
 *
 * ⚠️ Les versions antérieures sont REPLIÉES sous la version courante, jamais
 * masquées. Un remplacement n'écrase rien — le nouveau fichier pointe vers
 * l'ancien, qui reste consultable et téléchargeable. C'est la contrepartie
 * visible de la règle « jamais d'écrasement en place » (CLAUDE.md §1).
 */
export function OccurrenceDocuments({ detail }: { readonly detail: OccurrenceDetailView }) {
  const t = useTranslations("occurrences.detail");

  if (detail.documents.length === 0) {
    return <EmptyState title={t("noDocuments")} description={t("noDocumentsHint")} />;
  }

  return (
    <ul className="space-y-2">
      {detail.documents.map((document) => (
        <DocumentRow key={document.id} document={document} />
      ))}
    </ul>
  );
}

function DocumentRow({ document }: { readonly document: AttachedDocumentView }) {
  const t = useTranslations("occurrences.detail");
  // Le vocabulaire des natures de pièce existe déjà : le dupliquer sous
  // occurrences.detail créerait deux libellés à tenir à jour pour une seule notion.
  const tKind = useTranslations("documents.kind");
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <FileText aria-hidden="true" className="size-4 text-text-muted" />
            {document.originalFilename}
            <Badge variant="outline">{t("versionLabel", { version: document.version })}</Badge>
            {document.documentKind === null ? null : (
              <Badge variant="outline">{tKind(document.documentKind)}</Badge>
            )}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {document.uploaderName ?? "—"} · {formatDateTimeFr(new Date(document.uploadedAt))}
          </p>
          {/* L'empreinte est affichée : c'est ce qui permet à un tiers de vérifier
              qu'un fichier redéposé ailleurs est bien celui-ci. */}
          <p className="mt-1 truncate font-mono text-[11px] text-text-muted" data-numeric>
            sha256 {document.sha256.slice(0, 16)}…
          </p>
        </div>

        <DocumentActions documentId={document.id} filename={document.normalizedFilename} />
      </div>

      {document.previousVersions.length === 0 ? null : (
        <div className="mt-2 border-t border-border pt-2">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((value) => !value);
            }}
          >
            <History aria-hidden="true" className="size-4" />
            {t("previousVersions", { count: document.previousVersions.length })}
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </Button>

          {expanded ? (
            <ul className="mt-2 space-y-1.5 ps-4">
              {document.previousVersions.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary"
                >
                  <span>
                    {t("versionLabel", { version: version.version })} · {version.originalFilename} ·{" "}
                    {version.uploaderName ?? "—"} · {formatDateTimeFr(new Date(version.uploadedAt))}
                  </span>
                  <DocumentActions documentId={version.id} filename={version.normalizedFilename} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </li>
  );
}
