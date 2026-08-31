"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { NavList } from "@/components/layout/nav-list";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { APP_NAME } from "@/config/constants";
import type { NavCounters, NavItem } from "@/config/navigation";

/**
 * Tiroir de navigation sous le point de rupture `lg`.
 *
 * Il rend la MÊME liste que la barre latérale, jamais un sommaire réduit : une
 * section joignable au bureau et introuvable sur tablette est un piège, pas une
 * simplification.
 *
 * Le tiroir se referme au clic sur un lien. Sans cela, la navigation aboutit
 * derrière un panneau resté ouvert, et l'utilisateur croit que rien ne s'est
 * passé.
 */
export function MobileNav({
  items,
  counters,
}: {
  readonly items: readonly NavItem[];
  readonly counters: NavCounters;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("layout.openMenu")}>
          <Menu aria-hidden="true" className="size-5" />
        </Button>
      </SheetTrigger>

      {/* `side="left"` est le nom de la variante Radix, pas une position physique :
          ses classes sont logiques (`start-0`, `border-e`), le tiroir s'ouvre donc
          à droite en RTL sans qu'aucune condition ne soit écrite ici. */}
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{APP_NAME}</SheetTitle>
          <SheetDescription>{t("nav.primary")}</SheetDescription>
        </SheetHeader>

        <nav aria-label={t("nav.primary")} className="overflow-y-auto p-2">
          <NavList
            items={items}
            counters={counters}
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
