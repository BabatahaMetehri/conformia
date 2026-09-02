"use client";

import { useEffect, useState } from "react";

/**
 * Vrai une fois que React a repris la main sur le HTML rendu par le serveur.
 *
 * ⚠️ CE QUE CE CROCHET CORRIGE EST UN VRAI DÉFAUT, pas une commodité de test.
 *
 * Un contrôle rendu côté serveur — un tri de colonne, un filtre, une bascule —
 * a l'apparence exacte du contrôle final AVANT que son gestionnaire ne soit
 * attaché. Entre l'affichage et l'hydratation, il reste cliquable et ne fait
 * RIEN : pas d'erreur, pas d'indication, le clic disparaît. L'utilisateur
 * conclut que l'application est cassée, et reclique.
 *
 * La fenêtre est courte sur une machine au repos et s'allonge exactement quand
 * il ne faut pas : machine chargée, réseau lent, première visite sans cache.
 * C'est aussi ce qui rendait quatre tests de bout en bout intermittents — ils
 * cliquaient plus vite que l'hydratation, et échouaient à des endroits qui
 * changeaient d'une exécution à l'autre.
 *
 * ⚠️ `useState(false)` puis `useEffect` : c'est la seule combinaison qui donne
 * `false` au rendu serveur ET au premier rendu client. Toute autre forme fait
 * diverger les deux arbres, et React remplace tout le contenu à l'hydratation.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
