"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { CurrentUserContext } from "@/hooks/use-current-user";
import type { CurrentUser } from "@/types/current-user";

/**
 * 30 s : une occurrence change au rythme d'une saisie humaine, pas d'un flux.
 * Refetch systématique à chaque montage serait du bruit réseau pur.
 */
const STALE_TIME_MS = 30_000;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        // Une seule reprise : au-delà, l'erreur est réelle et doit être montrée.
        retry: 1,
        // Le retour d'onglet ne justifie pas de recharger : les écrans de
        // conformité restent ouverts des heures pendant qu'on remplit un dossier.
        refetchOnWindowFocus: false,
      },
    },
  });
}

interface AppProvidersProps {
  readonly children: ReactNode;
  readonly currentUser: CurrentUser | null;
  /**
   * Nonce CSP de la requête. `next-themes` pose un script en ligne pour appliquer
   * le thème AVANT le premier rendu — sans lui, la page clignoterait en clair
   * avant de basculer. Notre CSP interdisant `unsafe-inline`, ce script doit
   * porter le nonce, sinon il est bloqué et le clignotement réapparaît.
   */
  readonly nonce: string | undefined;
}

export function AppProviders({ children, currentUser, nonce }: AppProvidersProps) {
  // `useState` et non une constante de module : en SSR, un client partagé entre
  // deux requêtes ferait fuiter le cache d'un utilisateur vers un autre.
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Pas de transition à la bascule : sur des tableaux denses, l'animation
      // de centaines de cellules est plus gênante qu'un basculement net.
      disableTransitionOnChange
      {...(nonce === undefined ? {} : { nonce })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <CurrentUserContext.Provider value={currentUser}>{children}</CurrentUserContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
