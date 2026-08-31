import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { APP_NAME } from "@/config/constants";

/**
 * Coquille de la zone authentifiee. Volontairement nue a ce stade : la
 * navigation metier appartient aux ecrans, pas au systeme de design.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <span className="text-sm font-semibold text-text-primary">{APP_NAME}</span>
          <div className="ms-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
