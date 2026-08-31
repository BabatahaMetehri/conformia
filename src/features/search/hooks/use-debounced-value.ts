"use client";

import { useEffect, useState } from "react";

/**
 * Retarde la propagation d'une valeur qui change vite.
 *
 * Sans cela, la palette déclenche une requête par touche : « déclaration » en
 * produirait onze, dont dix seraient obsolètes à leur arrivée. Le délai n'est
 * pas un confort réseau, c'est ce qui rend l'ordre des réponses sans importance.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    // Nettoyage à chaque frappe : le compte à rebours repart de zéro, il ne
    // s'empile pas.
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
