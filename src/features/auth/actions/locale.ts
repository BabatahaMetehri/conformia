"use server";

/**
 * Changement de langue.
 *
 * ⚠️ UNE SERVER ACTION, PAS UN LIEN. Le choix doit SURVIVRE à la navigation
 * suivante : sans cookie, l'utilisateur repasserait en français dès la première
 * URL saisie à la main ou dès le prochain courriel cliqué. Le cookie est donc
 * posé côté serveur, puis la redirection amène l'écran équivalent dans la
 * nouvelle langue.
 *
 * ⚠️ LE CHEMIN COURANT EST CONSERVÉ. Renvoyer sur l'accueil ferait perdre le
 * dossier ouvert — changer de langue n'est pas changer d'écran. Le chemin arrive
 * SANS son préfixe de locale (c'est ce que rend `usePathname` de
 * `@/i18n/navigation`), et l'on repréfixe avec la langue choisie.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/config/constants";
import { LOCALE_COOKIE } from "@/lib/locale-detection";

/** Un an : le choix de langue n'a pas à être refait à chaque session. */
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function isSupported(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/**
 * Nettoie le chemin reçu du client.
 *
 * ⚠️ CE PARAMÈTRE VIENT DU NAVIGATEUR : il ne peut pas être redirigé tel quel.
 * Une valeur comme `//evil.example` ou `https://evil.example` produirait une
 * redirection OUVERTE — l'utilisateur croirait rester sur la plateforme. On
 * n'accepte donc qu'un chemin absolu d'un seul slash, et l'on retombe sur
 * l'accueil au moindre doute.
 */
function safePath(candidate: string): string {
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/dashboard";
  if (candidate.includes("://") || candidate.includes("\\")) return "/dashboard";
  return candidate;
}

export async function setLocaleAction(locale: string, currentPath: string): Promise<void> {
  const chosen: Locale = isSupported(locale) ? locale : DEFAULT_LOCALE;

  const store = await cookies();
  store.set(LOCALE_COOKIE, chosen, {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    // Aucune donnée sensible : le cookie doit rester lisible par le client pour
    // que le rendu initial n'ait pas à attendre le serveur.
    httpOnly: false,
  });

  redirect(`/${chosen}${safePath(currentPath)}`);
}
