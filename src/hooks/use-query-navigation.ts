"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { useHydrated } from "@/hooks/use-hydrated";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Écrit l'état d'un écran DANS L'URL, et s'assure qu'il y arrive.
 *
 * ⚠️ CE CROCHET CORRIGE UN DÉFAUT MESURÉ, PAS UNE GÊNE THÉORIQUE.
 *
 * Une navigation douce ne valide l'URL qu'une fois la charge serveur reçue. Un
 * `replace` émis pendant qu'un autre est encore en vol est ABANDONNÉ EN
 * SILENCE : la requête part, le navigateur l'interrompt, et l'écran reste sur
 * le filtre précédent sans rien signaler. L'utilisateur clique « Fiscal », rien
 * ne bouge, et il reclique.
 *
 * La transition seule ne suffit pas — c'est ce qui avait été tenté, et le défaut
 * survit : sous charge, une sélection sur deux se perd encore. La correction qui
 * tient ne repose pas sur un délai mais sur un FAIT VÉRIFIABLE — l'URL porte-t-elle
 * ce qu'on lui a demandé ? Tant que non, on redemande, à intervalle court et en
 * nombre borné.
 *
 * ⚠️ La comparaison est CANONIQUE (paires triées) : `?a=1&b=2` et `?b=2&a=1`
 * décrivent le même écran. Comparer les chaînes brutes relancerait indéfiniment
 * une navigation pourtant aboutie.
 */

/**
 * Cadence des relances : 200 ms, puis le double à chaque fois, plafonné.
 *
 * ⚠️ UNE CADENCE FIXE EST LA MAUVAISE FORME ICI, et cela s'est vu. À 200 ms
 * constants, les huit tentatives sont consommées en moins de deux secondes :
 * sur une machine chargée — la suite de bout en bout complète, par exemple — le
 * serveur n'a pas fini de rendre la première que le plafond est déjà atteint, et
 * l'écran reste figé pour toujours alors qu'une seconde de patience aurait
 * suffi. La progression géométrique donne un peu plus de sept secondes au total,
 * en restant réactive sur le cas normal, où la première tentative suffit.
 */
const FIRST_RETRY_MS = 200;
const MAX_RETRY_MS = 2_000;

/**
 * ⚠️ LA BORNE EST UNE DURÉE, PAS UN NOMBRE D'ESSAIS.
 *
 * Compter les tentatives paraît naturel et se révèle faux : six essais espacés
 * de 200 ms à 2 s valent sept secondes sur une machine au repos et sept secondes
 * sur une machine saturée — sauf que dans le second cas, aucune n'a eu le temps
 * d'aboutir. Le plafond en nombre s'épuise alors précisément quand il faudrait
 * insister, et l'écran reste figé pour toujours. Une borne en TEMPS s'adapte :
 * elle laisse la place aux navigations lentes, et elle finit quand même.
 */
const GIVE_UP_AFTER_MS = 20_000;

/**
 * Durée au-delà de laquelle une navigation « en cours » est tenue pour PERDUE.
 *
 * ⚠️ SANS CE SEUIL, LA GARDE ANTI-DOUBLON DEVIENT UN BLOCAGE DÉFINITIF.
 *
 * Quand le routeur abandonne une requête (`net::ERR_ABORTED`), la transition
 * React qui la portait ne se termine JAMAIS : `pending` reste vrai pour
 * toujours. Une relance conditionnée au seul `pending` n'est alors jamais émise,
 * l'URL ne bouge plus, et les contrôles — désactivés pendant qu'une navigation
 * est en cours — restent inertes définitivement. Mesuré sur le filtre du
 * référentiel : champ grisé et URL figée huit secondes après la frappe, sans
 * aucune reprise.
 *
 * Trois secondes séparent donc « c'est long » de « c'est perdu ».
 */
const STUCK_AFTER_MS = 3_000;

function delayFor(attempt: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
}

function canonical(entries: Iterable<[string, string]>): string {
  return [...entries]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
}

export interface QueryNavigation {
  /** Remplace la requête courante par celle-ci, et insiste jusqu'à ce qu'elle prenne. */
  readonly navigate: (next: URLSearchParams) => void;
  /** Une navigation est en cours. */
  readonly pending: boolean;
  /**
   * Les contrôles doivent être inertes : navigation en cours, OU page pas encore
   * hydratée — auquel cas leur gestionnaire n'est pas attaché et le clic serait
   * perdu sans le moindre signe.
   */
  readonly busy: boolean;
}

export function useQueryNavigation(): QueryNavigation {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  const [target, setTarget] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const deadline = useRef(0);
  /** Instant de la dernière tentative — sert à reconnaître une navigation perdue. */
  const attemptedAt = useRef(0);

  const push = useCallback(
    (next: URLSearchParams): void => {
      /*
       * ⚠️ Forme OBJET. Le routeur de next-intl traite son argument comme un
       * chemin : une chaîne « /echeancier?x=1 » n'y transporte aucune requête.
       */
      startTransition(() => {
        router.replace({ pathname, query: Object.fromEntries(next.entries()) });
      });
    },
    [pathname, router],
  );

  const navigate = useCallback(
    (next: URLSearchParams): void => {
      setTarget(next.toString());
      setAttempts(0);
      deadline.current = Date.now() + GIVE_UP_AFTER_MS;
      attemptedAt.current = Date.now();
      push(next);
    },
    [push],
  );

  /*
   * ⚠️ `pending` est lu par RÉFÉRENCE, pas capturé par l'effet.
   *
   * L'effet ne se réexécute que sur changement de dépendance : conditionner la
   * relance à `pending` dans son corps la rendait indécidable dès lors que
   * `pending` restait figé à vrai — ce qui est précisément le cas d'une
   * navigation abandonnée. La minuterie relit donc l'état au moment où elle
   * s'exécute.
   */
  const pendingRef = useRef(false);
  pendingRef.current = pending;

  useEffect(() => {
    if (target === null) return;

    if (canonical(params.entries()) === canonical(new URLSearchParams(target).entries())) {
      setTarget(null);
      setAttempts((count) => (count === 0 ? count : 0));
      return;
    }

    // Délai écoulé : on cesse d'insister. Redemander sans fin transformerait un
    // écran figé en écran qui recharge en boucle — plus visible, pas mieux.
    if (Date.now() >= deadline.current) {
      setTarget(null);
      return;
    }

    const timer = window.setTimeout(() => {
      /*
       * ⚠️ NE PAS DOUBLER UNE NAVIGATION EN VOL — MAIS NE PAS ATTENDRE UN
       * FANTÔME. Deux défauts opposés se rejoignent ici, et il a fallu les deux
       * pour trouver la bonne forme :
       *
       *   • Sans garde, la relance devient le problème qu'elle prétend
       *     corriger : une navigation de 500 ms se fait interrompre par la
       *     relance de 200 ms, puis par la suivante, et le plafond tombe sans
       *     qu'aucune n'ait abouti.
       *   • Avec une garde sur le seul `pending`, une navigation ABANDONNÉE par
       *     le routeur laisse la transition React en suspens POUR TOUJOURS : la
       *     relance n'est jamais émise, l'URL ne bouge plus, et les contrôles
       *     restent grisés définitivement. Mesuré sur le filtre du référentiel :
       *     champ inerte et URL figée huit secondes après la frappe.
       *
       * On patiente donc pendant une navigation en cours, mais pas au-delà de
       * `STUCK_AFTER_MS` : passé ce délai, elle est tenue pour perdue.
       */
      const lost = !pendingRef.current || Date.now() - attemptedAt.current >= STUCK_AFTER_MS;
      if (lost) {
        attemptedAt.current = Date.now();
        push(new URLSearchParams(target));
      }

      /*
       * Incrémenter RÉARME cet effet, que l'on ait relancé ou seulement patienté.
       * C'est ce qui donne à la vérification un battement propre, indépendant
       * des rendus — sans quoi une navigation figée ne serait jamais réexaminée.
       */
      setAttempts((count) => count + 1);
    }, delayFor(attempts));

    return () => {
      window.clearTimeout(timer);
    };
  }, [target, params, attempts, push]);

  return { navigate, pending, busy: pending || !hydrated };
}
