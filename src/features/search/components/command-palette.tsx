"use client";

import { useQuery } from "@tanstack/react-query";
import { BookMarked, CalendarClock, FolderClosed, Search, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SEARCH_DEBOUNCE_MS } from "@/config/ui";
import { searchAction } from "@/features/search/actions";
import { useDebouncedValue } from "@/features/search/hooks/use-debounced-value";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query-keys";
import type { SearchKind } from "@/services/search";

/**
 * Palette de recherche globale (⌘K / Ctrl+K).
 *
 * ⚠️ Le filtrage cmdk est DÉSACTIVÉ (`shouldFilter={false}`). Par défaut, cmdk
 * refiltre les éléments rendus selon sa propre correspondance floue sur le texte
 * visible. Nos résultats viennent d'un index Postgres qui a vu plus de champs
 * que ce qui s'affiche : chercher « 2026 01 » remonte à juste titre une
 * occurrence dont le libellé est « Déclaration G50 », et cmdk la masquerait
 * aussitôt, faute de la retrouver dans la chaîne affichée. Deux moteurs de
 * recherche en série ne valent jamais mieux que le plus faible des deux.
 *
 * ⚠️ Le cloisonnement n'est pas ici. C'est `global_search()` qui s'exécute sous
 * la RLS de l'appelant : ce composant affiche ce qu'on lui rend, il ne filtre
 * rien et ne doit pas donner l'impression de le faire.
 */

/** Minimum accepté par le service ; répété ici pour l'affichage seulement. */
const MIN_LENGTH = 2;

const ICONS: Readonly<Record<SearchKind, LucideIcon>> = {
  OBLIGATION: BookMarked,
  OCCURRENCE: CalendarClock,
  DOCUMENT: FolderClosed,
};

const PATH_PREFIX: Readonly<Record<SearchKind, string>> = {
  OBLIGATION: "/obligations",
  OCCURRENCE: "/occurrences",
  DOCUMENT: "/documents",
};

export function CommandPalette() {
  const t = useTranslations("search");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const query = useDebouncedValue(typed.trim(), SEARCH_DEBOUNCE_MS);

  // ⌘K sur macOS, Ctrl+K ailleurs. `metaKey || ctrlKey` couvre les deux sans
  // avoir à renifler la plateforme, ce qui se trompe sur les claviers externes.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen((previous) => !previous);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const enabled = open && query.length >= MIN_LENGTH;

  const { data, isFetching, isError } = useQuery({
    queryKey: queryKeys.search.results(query),
    queryFn: () => searchAction(query),
    enabled,
    // Les résultats précédents restent affichés pendant la frappe suivante :
    // sans cela la liste se vide à chaque touche et la cible saute.
    placeholderData: (previous) => previous,
  });

  function goTo(kind: SearchKind, id: string): void {
    setOpen(false);
    setTyped("");
    router.push(`${PATH_PREFIX[kind]}/${id}`);
  }

  const groups = data?.status === "success" ? data.outcome.groups : [];
  const failed = isError || data?.status === "error";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        className="w-full justify-start gap-2 text-text-muted sm:w-64"
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="truncate">{t("open")}</span>
        {/* Décoratif : le raccourci est déjà annoncé par le libellé du bouton,
            et « ⌘K » lu à voix haute ne veut rien dire. */}
        <kbd
          aria-hidden="true"
          className="ms-auto hidden rounded border border-border px-1.5 py-0.5 text-2xs sm:inline"
        >
          ⌘K
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
          {/* Titre et description obligatoires pour Radix, masqués visuellement :
              la palette s'explique d'elle-même à l'écran, pas à l'oreille. */}
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("description", { min: MIN_LENGTH })}
          </DialogDescription>

          <Command shouldFilter={false}>
            <CommandInput
              value={typed}
              onValueChange={setTyped}
              placeholder={t("placeholder")}
              // `aria-busy` : l'attente est perceptible sans voir le curseur.
              aria-busy={isFetching}
            />

            <CommandList>
              {typed.trim().length < MIN_LENGTH ? (
                <CommandEmpty>{t("tooShort", { min: MIN_LENGTH })}</CommandEmpty>
              ) : failed ? (
                <CommandEmpty>{t("failed")}</CommandEmpty>
              ) : groups.length === 0 ? (
                <CommandEmpty>{isFetching ? t("searching") : t("empty")}</CommandEmpty>
              ) : null}

              {groups.map((group) => {
                const Icon = ICONS[group.kind];
                return (
                  <CommandGroup key={group.kind} heading={t(`groups.${group.kind}`)}>
                    {group.hits.map((hit) => (
                      <CommandItem
                        key={hit.id}
                        // `value` unique : sans lui, deux résultats homonymes
                        // partageraient la même valeur et cmdk n'en surlignerait
                        // qu'un seul au clavier.
                        value={`${group.kind}:${hit.id}`}
                        onSelect={() => {
                          goTo(group.kind, hit.id);
                        }}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                        <span className="truncate">{hit.title}</span>
                        {hit.subtitle === null ? null : (
                          <span data-numeric className="ms-auto text-xs text-text-muted">
                            {hit.subtitle}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
