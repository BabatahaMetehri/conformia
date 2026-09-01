"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Coquille d'onglets de la fiche.
 *
 * Seule la bascule d'onglet est interactive ; le CONTENU arrive en `ReactNode`
 * depuis la page, qui reste un Server Component. Les onglets sans interaction —
 * procédure, historique, périodes précédentes — ne traversent donc jamais le
 * bundle client (CLAUDE.md §2 : Server Components par défaut).
 */

export interface DetailTabsProps {
  readonly procedure: ReactNode;
  readonly dossier: ReactNode;
  readonly documents: ReactNode;
  readonly discussion: ReactNode;
  readonly history: ReactNode;
  readonly previousPeriods: ReactNode;
  /** Compteurs affichés sur les onglets, pour situer sans les ouvrir. */
  readonly counts: {
    readonly missingPieces: number;
    readonly documents: number;
    readonly comments: number;
  };
}

export function OccurrenceDetailTabs({
  procedure,
  dossier,
  documents,
  discussion,
  history,
  previousPeriods,
  counts,
}: DetailTabsProps) {
  const t = useTranslations("occurrences.detail.tabs");

  return (
    <Tabs defaultValue="dossier">
      <TabsList>
        <TabsTrigger value="procedure">{t("procedure")}</TabsTrigger>
        <TabsTrigger value="dossier">
          {t("dossier")}
          {counts.missingPieces > 0 ? (
            // Le compteur ne s'affiche que s'il MANQUE quelque chose : un badge
            // permanent devient un décor qu'on cesse de voir.
            <Badge variant="destructive">{counts.missingPieces}</Badge>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="documents">
          {t("documents")}
          {counts.documents > 0 ? <Badge variant="outline">{counts.documents}</Badge> : null}
        </TabsTrigger>
        <TabsTrigger value="discussion">
          {t("discussion")}
          {counts.comments > 0 ? <Badge variant="outline">{counts.comments}</Badge> : null}
        </TabsTrigger>
        <TabsTrigger value="history">{t("history")}</TabsTrigger>
        <TabsTrigger value="previous">{t("previousPeriods")}</TabsTrigger>
      </TabsList>

      <TabsContent value="procedure" className="pt-4">
        {procedure}
      </TabsContent>
      <TabsContent value="dossier" className="pt-4">
        {dossier}
      </TabsContent>
      <TabsContent value="documents" className="pt-4">
        {documents}
      </TabsContent>
      <TabsContent value="discussion" className="pt-4">
        {discussion}
      </TabsContent>
      <TabsContent value="history" className="pt-4">
        {history}
      </TabsContent>
      <TabsContent value="previous" className="pt-4">
        {previousPeriods}
      </TabsContent>
    </Tabs>
  );
}
