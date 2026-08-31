"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";

/**
 * Limite d'erreur de section, rendue par chaque `error.tsx`.
 *
 * ⚠️ AUCUNE TRACE TECHNIQUE À L'ÉCRAN. `error.message` est déjà expurgé par Next
 * en production — il y devient « An error occurred in the Server Components
 * render » — mais en développement il porte le message réel. L'afficher
 * conditionnellement produirait un écran qui ment sur ce qu'il montrera en
 * production. On n'affiche donc que le `digest`, identifiant de corrélation que
 * l'utilisateur recopie au support et que le support retrouve dans les journaux
 * du serveur.
 */
export function SectionError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("routing");
  const tCommon = useTranslations("common.actions");

  useEffect(() => {
    // Journalisation côté navigateur uniquement : la trace serveur existe déjà,
    // rattachée au même `digest`.
    console.error("Erreur de rendu de section", error.digest ?? "sans digest");
  }, [error]);

  return (
    <ErrorState
      title={t("errorTitle")}
      description={t("errorDescription")}
      {...(error.digest === undefined ? {} : { correlationId: error.digest })}
      action={
        <Button variant="outline" size="sm" onClick={reset}>
          {tCommon("retry")}
        </Button>
      }
    />
  );
}
