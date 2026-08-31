"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Bascule clair / sombre / système.
 *
 * Le rendu serveur ne connaît pas le thème résolu — il vit dans le stockage du
 * navigateur. Afficher l'icône avant l'hydratation produirait un soleil qui se
 * change en lune sous les yeux de l'utilisateur ; on réserve donc la place et on
 * n'affiche l'icône qu'une fois monté. Le THÈME lui-même, lui, est appliqué avant
 * le premier rendu par le script de next-themes : la page ne clignote pas.
 */
export function ThemeToggle() {
  const t = useTranslations("common.theme");
  const { setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("toggle")}>
          {mounted ? (
            <>
              <Sun aria-hidden="true" className="size-4 dark:hidden" />
              <Moon aria-hidden="true" className="hidden size-4 dark:block" />
            </>
          ) : (
            <span aria-hidden="true" className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            setTheme("light");
          }}
        >
          <Sun aria-hidden="true" className="size-4" />
          {t("light")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setTheme("dark");
          }}
        >
          <Moon aria-hidden="true" className="size-4" />
          {t("dark")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setTheme("system");
          }}
        >
          <Monitor aria-hidden="true" className="size-4" />
          {t("system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
