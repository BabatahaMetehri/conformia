"use client";

import { startTransition, useActionState, useCallback } from "react";

/**
 * Exécute un travail asynchrone avec un état d'attente DÉTERMINISTE.
 *
 * ⚠️ CE HOOK REMPLACE `startTransition(async () => { ... })`, ET LE MOTIF
 * REMPLACÉ ÉTAIT FAUX — pas maladroit, faux.
 *
 * React ne traite comme transition que ce qui s'exécute AVANT le premier
 * `await`. C'est écrit dans sa documentation, à « React doesn't treat my state
 * update as a Transition ». Tout ce qui suit l'attente — le `router.refresh()`,
 * la fermeture d'une boîte de dialogue, la remise à zéro d'un champ — retombe
 * hors du champ de la transition. Une seconde transition démarrée entre-temps
 * peut alors emporter ces mises à jour : l'écran reste sur des données
 * périmées, sans aucun signe d'erreur.
 *
 * Le défaut ne se voit pas au test manuel, parce qu'il demande deux gestes en
 * moins de temps qu'il n'en faut pour relire l'écran. Il se voit en production,
 * chez la personne qui enchaîne — c'est-à-dire chez celle qui connaît le
 * logiciel.
 *
 * ⚠️ POURQUOI `useActionState` ET NON UN SIMPLE `useState<boolean>`.
 *
 * Un drapeau tenu à la main a exactement la course qu'on cherche à supprimer :
 * deux exécutions se chevauchent, la PREMIÈRE qui se termine remet le drapeau à
 * faux, et l'interface se rouvre alors que la seconde travaille encore. React
 * met les envois EN FILE : `pending` reste vrai tant que la file n'est pas
 * vide, et les travaux ne se recouvrent jamais. C'est la propriété qui rend
 * l'état déterministe, et elle ne se réécrit pas en trois lignes.
 *
 * ⚠️ LA CHARGE UTILE EST UNE FONCTION, ET CE N'EST PAS UN DÉTOURNEMENT.
 * `useActionState` sert aussi à l'amélioration progressive, où la charge utile
 * est un `FormData` sérialisable. Ici l'appelant est toujours un gestionnaire
 * `onClick` d'un composant client : il n'y a aucune amélioration progressive à
 * préserver, et passer la tâche elle-même évite d'inventer un protocole de
 * messages entre le composant et son propre gestionnaire.
 *
 * Usage :
 *
 * ```tsx
 * const [pending, run] = useActionRunner();
 *
 * function submit(): void {
 *   run(async () => {
 *     const outcome = await declareAbsenceAction(input);
 *     if (outcome.status === "success") {
 *       toast.success(t("created"));
 *       setOpen(false);
 *       return;
 *     }
 *     toast.error(outcome.error.message);
 *   });
 * }
 * ```
 *
 * ⚠️ AUCUN `router.refresh()` DANS LA TÂCHE. La Server Action appelle
 * `revalidatePath` ; Next.js renvoie l'instruction de revalidation AVEC la
 * réponse de l'action et rafraîchit la route lui-même. Un rafraîchissement
 * client fait alors double emploi — et c'est lui qui, placé après l'attente,
 * se faisait emporter. Voir `docs/state-management.md`.
 */
export function useActionRunner(): readonly [boolean, (task: () => Promise<void>) => void] {
  const [, dispatch, pending] = useActionState<null, () => Promise<void>>(
    async (_previous, task) => {
      await task();
      /*
       * Aucun état rendu : le résultat vit dans les `setState` de l'appelant et
       * dans la revalidation serveur. Renvoyer un état ici obligerait chaque
       * écran à en inventer la forme, et à le lire dans un `useEffect` — soit
       * deux rendus de plus pour une information qu'il détient déjà.
       */
      return null;
    },
    null,
  );

  /*
   * ⚠️ L'ENVOI PASSE PAR UNE TRANSITION SYNCHRONE, ET CE N'EST PAS UN
   * ORNEMENT : SANS ELLE, `pending` NE PASSE JAMAIS À VRAI.
   *
   * `useActionState` est pensé pour l'attribut `action` d'un formulaire, où
   * React ouvre lui-même la transition. Appelé à la main depuis un `onClick`,
   * l'envoi n'a aucune transition où s'inscrire, et le drapeau d'attente reste
   * faux du début à la fin — mesuré, pas supposé : les boutons resteraient
   * cliquables pendant tout l'envoi.
   *
   * Le rappel est SYNCHRONE. C'est toute la différence avec le motif corrigé :
   * il ne fait qu'inscrire la tâche dans la file, et c'est React qui tient la
   * transition ouverte jusqu'au bout de l'asynchrone.
   */
  const run = useCallback(
    (task: () => Promise<void>): void => {
      startTransition(() => {
        dispatch(task);
      });
    },
    [dispatch],
  );

  return [pending, run] as const;
}
