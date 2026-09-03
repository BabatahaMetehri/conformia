"use client";

import {
  ArrowLeftRight,
  BookMarked,
  Building2,
  CalendarOff,
  CalendarClock,
  FileChartColumn,
  FolderClosed,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Trash2,
  Users,
  KeyRound,
  Bell,
  type LucideIcon,
} from "lucide-react";

import type { NavIconName } from "@/config/navigation";

/**
 * Correspondance nom → composant d'icône.
 *
 * Elle vit côté CLIENT parce qu'un composant ne franchit pas la frontière RSC :
 * l'arbre de navigation transporte une chaîne, la résolution se fait ici. Le
 * `Record` est exhaustif par construction — ajouter un nom dans
 * `NAV_ICON_NAMES` sans l'illustrer casse la compilation.
 */
const ICONS: Readonly<Record<NavIconName, LucideIcon>> = {
  dashboard: LayoutDashboard,
  tasks: ListChecks,
  calendar: CalendarClock,
  validation: ShieldCheck,
  obligations: BookMarked,
  documents: FolderClosed,
  reports: FileChartColumn,
  admin: SlidersHorizontal,
  users: Users,
  roles: KeyRound,
  delegations: ArrowLeftRight,
  referentials: BookMarked,
  notifications: Bell,
  settings: Settings,
  jobs: Timer,
  purge: Trash2,
  audit: ScrollText,
  registers: Building2,
  absences: CalendarOff,
};

export function NavIcon({
  name,
  className,
}: {
  readonly name: NavIconName;
  readonly className?: string;
}) {
  const Icon = ICONS[name];
  // `aria-hidden` sans exception : l'icône double toujours un libellé texte, la
  // faire annoncer ferait entendre la même information deux fois.
  return <Icon aria-hidden="true" className={className} />;
}

/** Variante pour un usage hors navigation (menu utilisateur, en-têtes de section). */
export function iconFor(name: NavIconName): LucideIcon {
  return ICONS[name];
}
