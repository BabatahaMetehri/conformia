/**
 * Primitives de navigation conscientes de la locale.
 *
 * ⚠️ Ces `Link`, `usePathname` et `useRouter` remplacent ceux de `next/link` et
 * `next/navigation` DANS TOUTE L'APPLICATION. Le préfixe de locale étant
 * toujours présent (`localePrefix: "always"`), un `<Link href="/documents">` de
 * `next/link` produirait une URL sans locale : le middleware la rattraperait par
 * une redirection, au prix d'un aller-retour à chaque clic. Ceux-ci écrivent
 * directement `/fr/documents`.
 *
 * Symétriquement, le `usePathname` d'ici rend le chemin SANS la locale — c'est
 * ce qui permet de comparer un chemin courant à un `href` de l'arbre de
 * navigation sans le préfixer à la main.
 */

import { createNavigation } from "next-intl/navigation";

import { routing } from "@/i18n/routing";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
