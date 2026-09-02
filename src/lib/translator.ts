import { createTranslator } from "next-intl";

import { DEFAULT_LOCALE, type Locale } from "@/config/constants";
import { APP_TIMEZONE } from "@/lib/dates";
import ar from "@/i18n/messages/ar.json";
import fr from "@/i18n/messages/fr.json";

/**
 * Traducteur HORS REQUÊTE.
 *
 * ⚠️ Déplacé de `src/emails/` vers `src/lib/` : les courriels n'en sont plus le
 * seul usage. Les exports en ont besoin aussi — un gestionnaire de route qui
 * produit une archive n'a pas de segment de locale dans son chemin, donc pas de
 * contexte de requête i18n. Le laisser sous `emails/` aurait obligé la couche
 * export à importer un module de courriel pour traduire un nom de colonne.
 *
 * ⚠️ `getTranslations` de `next-intl/server` lit le contexte de requête. Les
 * courriels partent d'une tâche planifiée : il n'y a ni requête, ni cookie, ni
 * en-tête `Accept-Language`. `createTranslator` prend ses messages en argument
 * et fonctionne partout — c'est la seule voie qui n'oblige pas à écrire des
 * chaînes en dur dans les gabarits (CLAUDE.md §6).
 *
 * Les catalogues sont importés STATIQUEMENT et non par `import()` dynamique :
 * un gabarit rendu dans un job ne doit pas dépendre de la résolution de modules
 * à l'exécution, qui se comporte différemment une fois le code empaqueté.
 */
/*
 * ⚠️ Le catalogue français DONNE LE TYPE, et l'annotation force `ar` à s'y
 * conformer : une clé manquante ou renommée d'un seul côté fait échouer la
 * compilation, au lieu de produire un courriel au libellé absent. C'est la règle
 * de projet « une clé ajoutée l'est dans fr ET dans ar », rendue mécanique.
 */
const CATALOGUES: Readonly<Record<Locale, typeof fr>> = { fr, ar };

/**
 * Traducteur pour un destinataire.
 *
 * La locale est un paramètre alors que l'application n'en propose qu'une : le
 * jour où un destinataire arabophone existe, seul l'appelant change. Coder `fr`
 * dans les gabarits aurait demandé d'y revenir un par un.
 */
export function appTranslator(locale: Locale = DEFAULT_LOCALE) {
  return createTranslator({
    locale,
    messages: CATALOGUES[locale],
    timeZone: APP_TIMEZONE,
  });
}

/** Le type EST celui de la fabrique : il ne peut pas s'en écarter. */
export type AppTranslator = ReturnType<typeof appTranslator>;

/** Ancien nom, conservé pour les gabarits de courriel. */
export type EmailTranslator = AppTranslator;

/** Ancien nom, conservé pour les gabarits de courriel. */
export const emailTranslator = appTranslator;
