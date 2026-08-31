"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { flattenNavigation, NAVIGATION } from "@/config/navigation";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Fil d'Ariane dérivé des segments de route.
 *
 * Les libellés viennent de l'arbre de navigation : le chemin `/admin/users`
 * n'est jamais traduit segment par segment, il est rapproché des `href`
 * déclarés. Un segment inconnu (identifiant d'occurrence, de document) est rendu
 * tel quel — mieux vaut un identifiant lisible qu'un libellé inventé.
 *
 * ⚠️ Aucun contrôle d'autorisation ici, et c'est volontaire : le fil ne fait que
 * décrire l'URL déjà atteinte. C'est la garde de route qui décide si cette URL
 * s'affiche, et elle a déjà tranché avant que ce composant ne soit rendu.
 */

/** `href` → clé i18n, construit une fois depuis l'arbre complet, non filtré. */
const LABEL_KEY_BY_HREF: ReadonlyMap<string, string> = new Map([
  ...flattenNavigation(NAVIGATION).map<[string, string]>((item) => [item.href, item.labelKey]),
  // Écrans hors sommaire, atteignables par le menu utilisateur.
  ["/profile", "profile"],
  ["/profile/calendar", "calendarFeed"],
]);

interface Crumb {
  readonly href: string;
  readonly labelKey: string | null;
  readonly segment: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    return { href, labelKey: LABEL_KEY_BY_HREF.get(href) ?? null, segment };
  });
}

export function Breadcrumbs() {
  const t = useTranslations("nav");
  const tLayout = useTranslations("layout");
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);

  if (crumbs.length === 0) return null;

  return (
    // `aria-label` explicite : la primitive shadcn en code un en dur (« breadcrumb »),
    // ce qu'interdit CLAUDE.md §6 — un `aria-label` est une chaîne visible par
    // l'utilisateur, simplement pas à l'écran.
    <Breadcrumb aria-label={tLayout("breadcrumb")}>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const label = crumb.labelKey === null ? crumb.segment : t(crumb.labelKey);
          const isLast = index === crumbs.length - 1;

          return (
            // Le séparateur EST un <li> : il doit rester frère de l'entrée, jamais
            // imbriqué dedans.
            <Fragment key={crumb.href}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {isLast ? null : (
                // Le chevron pointe dans le sens de lecture : il se retourne en RTL.
                <BreadcrumbSeparator className="[&>svg]:rtl:-scale-x-100" />
              )}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
