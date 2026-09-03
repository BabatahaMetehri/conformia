"use client";

import { CalendarDays, Check, Languages, LogOut, Monitor, Moon, Sun, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState, useTransition } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES } from "@/config/constants";
import { logoutAction } from "@/features/auth/actions";
import { setLocaleAction } from "@/features/auth/actions/locale";
import { useRequiredCurrentUser } from "@/hooks/use-current-user";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * Menu utilisateur : profil, thème, langue, flux calendrier, déconnexion.
 *
 * ⚠️ LE CHOIX DE LANGUE PASSE PAR UNE SERVER ACTION, jamais par un lien.
 * Il doit poser un cookie pour survivre à la navigation suivante : sans lui,
 * l'utilisateur repasserait en français dès la première URL saisie à la main ou
 * dès le prochain lien reçu par courriel. Le chemin courant est conservé —
 * changer de langue n'est pas changer d'écran.
 */
export function UserMenu({ locale }: { readonly locale: string }) {
  const t = useTranslations();
  const user = useRequiredCurrentUser();
  const { theme, setTheme } = useTheme();
  /*
   * ⚠️ `usePathname` de `@/i18n/navigation` rend le chemin SANS son préfixe de
   * locale. C'est exactement ce dont l'action a besoin : elle repréfixe avec la
   * langue choisie. Celui de `next/navigation` rendrait « /fr/echeancier » et
   * produirait « /ar/fr/echeancier ».
   */
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  // Le thème résolu vit dans le navigateur : l'afficher au rendu serveur
  // produirait une coche placée au hasard, corrigée à l'hydratation.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const displayName = user.profile?.fullName ?? user.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("layout.userMenu")}
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <UserAvatar fullName={user.profile?.fullName ?? null} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-text-primary">{displayName}</span>
          {user.email === null ? null : (
            <span className="truncate text-xs font-normal text-text-secondary">{user.email}</span>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User aria-hidden="true" className="size-4" />
            {t("nav.profile")}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/profile/calendar">
            <CalendarDays aria-hidden="true" className="size-4" />
            {t("nav.calendarFeed")}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun aria-hidden="true" className="size-4 dark:hidden" />
            <Moon aria-hidden="true" className="hidden size-4 dark:block" />
            {t("common.theme.toggle")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(
              [
                ["light", Sun],
                ["dark", Moon],
                ["system", Monitor],
              ] as const
            ).map(([value, Icon]) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => {
                  setTheme(value);
                }}
              >
                <Icon aria-hidden="true" className="size-4" />
                {t(`common.theme.${value}`)}
                {mounted && theme === value ? (
                  <Check aria-hidden="true" className="ms-auto size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden="true" className="size-4" />
            {t("layout.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LOCALES.map((candidate) => (
              <DropdownMenuItem
                key={candidate}
                /*
                 * ⚠️ `lang` sur l'élément lui-même : « العربية » doit être
                 * annoncé en arabe par le lecteur d'écran, même lorsque la page
                 * entière est en français. Sans cet attribut, la synthèse vocale
                 * lit des caractères arabes avec des règles françaises.
                 */
                lang={candidate}
                disabled={candidate === locale}
                onSelect={() => {
                  if (candidate === locale) return;
                  startTransition(async () => {
                    await setLocaleAction(candidate, pathname);
                  });
                }}
              >
                {t(`layout.locales.${candidate}`)}
                {candidate === locale ? (
                  <Check aria-hidden="true" className="ms-auto size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/*
          Déconnexion en FORMULAIRE, pas en lien. Une déconnexion modifie l'état
          du serveur : un GET la rendrait déclenchable par une simple image
          distante pointant sur l'URL, et préchargeable par le navigateur.
        */}
        <form action={logoutAction.bind(null, locale)}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              {t("layout.signOut")}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
