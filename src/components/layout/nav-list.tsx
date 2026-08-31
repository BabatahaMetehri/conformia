"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { NavIcon } from "@/components/layout/nav-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavCounters, NavItem } from "@/config/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Liste de navigation, partagée par la barre latérale et le tiroir mobile.
 *
 * Partagée parce que c'est le MÊME sommaire : deux copies divergeraient au
 * premier ajout de section, et l'utilisateur verrait deux applications
 * différentes selon la largeur de son écran. La règle « pas d'abstraction UI
 * prématurée » (CLAUDE.md §3.4) vise les écrans métier distincts, pas un
 * élément de chrome rendu deux fois.
 *
 * ⚠️ `items` arrive DÉJÀ FILTRÉ par le serveur. Aucun test de permission ici :
 * en écrire un laisserait croire que ce composant décide de quelque chose.
 */

function isActive(currentPath: string, href: string): boolean {
  // `/admin` ne doit pas s'allumer sur `/administration` : on exige soit
  // l'égalité, soit une frontière de segment.
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

// ─── Pastille de compteur ────────────────────────────────────────────────────

function CounterBadge({ count, label }: { readonly count: number; readonly label: string }) {
  // Zéro n'affiche rien : une pastille « 0 » occupe la place et attire l'oeil
  // pour dire qu'il n'y a rien à voir.
  if (count === 0) return null;

  return (
    <span
      data-numeric
      className="ms-auto inline-flex min-w-6 items-center justify-center rounded-full bg-status-overdue-bg px-1.5 py-0.5 text-2xs font-semibold text-status-overdue"
    >
      {/* Le nombre est décoratif : le libellé complet, lui, est annoncé. */}
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ─── Entrée simple ───────────────────────────────────────────────────────────

interface EntryProps {
  readonly item: NavItem;
  readonly counters: NavCounters;
  readonly collapsed: boolean;
  readonly nested?: boolean;
  readonly onNavigate?: (() => void) | undefined;
}

function NavEntry({ item, counters, collapsed, nested = false, onNavigate }: EntryProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const label = t(item.labelKey);

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      // `aria-current` et non la seule couleur : la position courante doit être
      // perceptible sans voir l'écran.
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        collapsed && "justify-center px-2",
        nested && !collapsed && "ps-9",
        active
          ? "bg-primary-subtle font-medium text-text-primary"
          : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
      )}
    >
      <NavIcon name={item.icon} className="size-4 shrink-0" />
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {item.counter === undefined || collapsed ? null : (
        <CounterBadge
          count={counters[item.counter]}
          label={t(`counters.${item.counter}`, { count: counters[item.counter] })}
        />
      )}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        // Replié, l'icône seule ne dit rien : l'infobulle rend le libellé, et le
        // lecteur d'écran l'a déjà par le `sr-only`.
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

// ─── Groupe repliable ────────────────────────────────────────────────────────

function NavGroup({ item, counters, collapsed, onNavigate }: EntryProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const children = item.children ?? [];

  const containsActive = children.some((child) => isActive(pathname, child.href));
  const [open, setOpen] = useState(containsActive);
  const label = t(item.labelKey);
  const listId = `nav-group-${item.id}`;

  // Replié en mode icônes, un groupe n'a plus de place pour ses enfants : ils
  // sont rendus à plat, ce qui reste navigable au clavier comme à la souris.
  if (collapsed) {
    return (
      <>
        {children.map((child) => (
          <NavEntry
            key={child.id}
            item={child}
            counters={counters}
            collapsed
            onNavigate={onNavigate}
          />
        ))}
      </>
    );
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          containsActive
            ? "font-medium text-text-primary"
            : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
        )}
      >
        <NavIcon name={item.icon} className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "ms-auto size-4 transition-transform rtl:-scale-x-100",
            open && "rotate-90",
          )}
        />
      </button>

      <ul id={listId} hidden={!open} className="mt-1 space-y-0.5">
        {children.map((child) => (
          <NavEntry
            key={child.id}
            item={child}
            counters={counters}
            collapsed={false}
            nested
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </li>
  );
}

// ─── Liste ───────────────────────────────────────────────────────────────────

export function NavList({
  items,
  counters,
  collapsed = false,
  onNavigate,
  className,
}: {
  readonly items: readonly NavItem[];
  readonly counters: NavCounters;
  readonly collapsed?: boolean;
  /** Ferme le tiroir mobile après un clic ; inutile sur la barre latérale. */
  readonly onNavigate?: (() => void) | undefined;
  readonly className?: string;
}) {
  return (
    <ul className={cn("space-y-0.5", className)}>
      {items.map((item) =>
        item.children === undefined ? (
          <NavEntry
            key={item.id}
            item={item}
            counters={counters}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ) : (
          <NavGroup
            key={item.id}
            item={item}
            counters={counters}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ),
      )}
    </ul>
  );
}
