import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NotificationBell } from "@/components/layout/notification-bell";
import { UserMenu } from "@/components/layout/user-menu";
import type { NavCounters, NavItem } from "@/config/navigation";
import { CommandPalette } from "@/features/search/components/command-palette";

/**
 * En-tête : tiroir mobile, fil d'Ariane, recherche, notifications, menu.
 *
 * Server Component qui compose des îlots clients. Il ne porte lui-même aucun
 * état — seuls les enfants qui en ont réellement besoin sont interactifs, et le
 * JavaScript envoyé se limite à eux.
 */
export function Header({
  items,
  counters,
  locale,
}: {
  readonly items: readonly NavItem[];
  readonly counters: NavCounters;
  readonly locale: string;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
      <MobileNav items={items} counters={counters} />

      {/* Le fil d'Ariane cède la place à la recherche sur écran étroit : deux
          repères de position valent moins qu'un moyen d'atteindre sa cible. */}
      <div className="hidden min-w-0 flex-1 sm:block">
        <Breadcrumbs />
      </div>

      <div className="ms-auto flex items-center gap-1 sm:gap-2">
        <CommandPalette />
        <NotificationBell />
        <UserMenu locale={locale} />
      </div>
    </header>
  );
}
