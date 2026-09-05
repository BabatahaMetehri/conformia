import { act, useState, useTransition } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * LE HOOK QUI REMPLACE `startTransition(async ...)`.
 *
 * ⚠️ DEUX PROPRIÉTÉS, ET LA SECONDE EST CELLE QUI COMPTE : l'attente couvre
 * TOUTE la tâche asynchrone, et deux exécutions ne se recouvrent jamais. C'est
 * la seconde qui manquait au motif précédent, et c'est elle qui produisait
 * l'écran périmé.
 */

// React 19 exporte `act` ; sans ce drapeau il avertit à chaque rendu.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Sonde {
  readonly pending: boolean[];
  run(task: () => Promise<void>): void;
}

let root: Root | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
});

function monter(): Sonde {
  const pending: boolean[] = [];
  const sonde: Sonde = { pending, run: () => undefined };

  function Essai() {
    const [attente, lancer] = useActionRunner();
    pending.push(attente);
    sonde.run = lancer;
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Essai />);
  });

  return sonde;
}

/** Une promesse dont le test décide du dénouement. */
function differe(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useActionRunner", () => {
  it("l'attente couvre TOUTE la tâche, pas seulement sa partie synchrone", async () => {
    const sonde = monter();
    const { promise, resolve } = differe();

    expect(sonde.pending.at(-1)).toBe(false);

    await act(async () => {
      sonde.run(async () => {
        await promise;
      });
      await Promise.resolve();
    });

    /*
     * ⚠️ C'EST ICI QUE L'ANCIEN MOTIF ÉCHOUAIT. `startTransition` rendait la main
     * au premier `await` : la partie qui suit s'exécutait hors transition, et
     * une seconde transition pouvait l'emporter. Le drapeau doit rester vrai
     * tant que la promesse n'est pas dénouée.
     */
    expect(sonde.pending.at(-1)).toBe(true);

    await act(async () => {
      resolve();
      await promise;
    });

    expect(sonde.pending.at(-1)).toBe(false);
  });

  it("deux exécutions ne se RECOUVRENT jamais : la seconde attend la première", async () => {
    const sonde = monter();
    const premier = differe();
    const second = differe();
    const ordre: string[] = [];

    await act(async () => {
      sonde.run(async () => {
        ordre.push("début-1");
        await premier.promise;
        ordre.push("fin-1");
      });
      sonde.run(async () => {
        ordre.push("début-2");
        await second.promise;
        ordre.push("fin-2");
      });
      await Promise.resolve();
    });

    /*
     * ⚠️ LA MISE EN FILE EST LA RAISON D'ÊTRE DU HOOK. Un drapeau tenu à la main
     * aurait laissé les deux tâches courir ensemble, et la première terminée
     * aurait rouvert l'interface pendant que la seconde travaillait encore.
     */
    expect(ordre).toEqual(["début-1"]);

    await act(async () => {
      premier.resolve();
      await premier.promise;
    });
    expect(ordre).toEqual(["début-1", "fin-1", "début-2"]);
    expect(sonde.pending.at(-1)).toBe(true);

    await act(async () => {
      second.resolve();
      await second.promise;
    });
    expect(ordre).toEqual(["début-1", "fin-1", "début-2", "fin-2"]);
    expect(sonde.pending.at(-1)).toBe(false);
  });

  it("une tâche qui LÈVE n'est pas AVALÉE", async () => {
    const sonde = monter();

    /*
     * ⚠️ LE HOOK NE RATTRAPE RIEN, ET C'EST UN CHOIX. Un rejet ici n'est jamais
     * un refus métier — ceux-là reviennent en `Result` et ne lèvent pas. C'est
     * une panne : action injoignable, déploiement en cours, session expirée côté
     * transport. L'avaler afficherait un écran d'apparence normale sur une
     * application qui ne répond plus, et l'utilisateur cliquerait à nouveau en
     * croyant avoir mal visé.
     *
     * L'erreur remonte donc jusqu'à la frontière d'erreur de Next, exactement
     * comme avec le motif précédent : ce point-là ne change pas.
     */
    await expect(
      act(async () => {
        sonde.run(() => Promise.reject(new Error("réseau")));
        await Promise.resolve();
      }),
    ).rejects.toThrow("réseau");
  });

  it("le hook ne dépend d'aucun état local du composant", () => {
    // Contre-épreuve du piège classique : `useState` dans le composant appelant
    // ne doit pas réinitialiser l'attente au rendu suivant.
    const pending: boolean[] = [];

    function Essai() {
      const [, setCompteur] = useState(0);
      const [attente] = useActionRunner();
      pending.push(attente);
      return (
        <button
          type="button"
          onClick={() => {
            setCompteur((n) => n + 1);
          }}
        />
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Essai />);
    });

    expect(pending).toEqual([false]);
  });
});

/**
 * LES DEUX MOTIFS REMPLACÉS, MESURÉS CÔTE À CÔTE.
 *
 * ⚠️ CE BLOC EXISTE PARCE QUE LA PREMIÈRE VERSION DE CETTE CORRECTION REPOSAIT
 * SUR UNE CROYANCE FAUSSE. On tenait pour acquis que `startTransition(async
 * ...)` perdait son état d'attente au premier `await`. MESURÉ, il ne le perd
 * pas : React 19 tient la transition ouverte jusqu'au bout de la fonction
 * asynchrone. Deux tentatives de test de bout en bout ont passé sur l'ancien
 * code avant que la mesure ne dise pourquoi.
 *
 * Ce que les deux motifs perdent VRAIMENT est ici, et rien d'autre :
 *
 *   • la promesse jetée dans un rappel SYNCHRONE perd l'état d'attente — la
 *     transition se referme avant le premier résultat ;
 *   • le rappel ASYNCHRONE garde l'attente, mais deux exécutions lancées coup
 *     sur coup partent EN PARALLÈLE. Leurs réponses reviennent dans l'ordre du
 *     réseau, et la dernière arrivée n'est pas la dernière demandée.
 *
 * Ces tests ÉCHOUERAIENT si `useActionRunner` retombait sur l'un ou l'autre.
 */
describe("ce que les motifs remplacés perdaient", () => {
  /** Sonde bâtie sur `useTransition` : le motif d'avant, tel quel. */
  function monterTransition(): {
    readonly pending: boolean[];
    sync(task: () => Promise<void>): void;
    async(task: () => Promise<void>): void;
  } {
    const pending: boolean[] = [];
    /*
     * Les deux lanceurs sont remplacés au premier rendu. La valeur initiale
     * IGNORE son argument et n'en déclare aucun : plus honnête qu'un paramètre
     * préfixé d'un souligné, qui laisserait croire qu'on comptait s'en servir.
     */
    const inerte = (): void => undefined;
    const sonde: {
      readonly pending: boolean[];
      sync: (task: () => Promise<void>) => void;
      async: (task: () => Promise<void>) => void;
    } = { pending, sync: inerte, async: inerte };

    function Essai() {
      const [attente, start] = useTransition();
      pending.push(attente);
      sonde.sync = (task) => {
        start(() => {
          void task();
        });
      };
      sonde.async = (task) => {
        start(async () => {
          await task();
        });
      };
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Essai />);
    });
    return sonde;
  }

  it("la promesse jetée dans un rappel SYNCHRONE perd l'état d'attente", async () => {
    const sonde = monterTransition();
    const { promise, resolve } = differe();

    await act(async () => {
      sonde.sync(() => promise);
      await Promise.resolve();
    });

    /*
     * ⚠️ LE TRAVAIL EST EN COURS ET L'ÉCRAN L'A DÉJÀ OUBLIÉ. Les boutons
     * redeviennent cliquables, le libellé « en cours… » disparaît, et rien
     * n'empêche un second envoi par-dessus le premier.
     */
    expect(sonde.pending.at(-1)).toBe(false);

    await act(async () => {
      resolve();
      await promise;
    });
  });

  it("deux rappels ASYNCHRONES partent en parallèle, sans file", async () => {
    const sonde = monterTransition();
    const premier = differe();
    const second = differe();
    const ordre: string[] = [];

    await act(async () => {
      sonde.async(async () => {
        ordre.push("début-1");
        await premier.promise;
      });
      sonde.async(async () => {
        ordre.push("début-2");
        await second.promise;
      });
      await Promise.resolve();
    });

    /*
     * ⚠️ LES DEUX ONT DÉMARRÉ. C'est la course : deux écritures concurrentes sur
     * la même ressource, dont l'ordre d'arrivée décide de l'état final. Avec
     * `useActionRunner`, le test jumeau plus haut n'observe que « début-1 ».
     */
    expect(ordre).toEqual(["début-1", "début-2"]);

    await act(async () => {
      premier.resolve();
      second.resolve();
      await premier.promise;
      await second.promise;
    });
  });
});
