"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SEARCH_DEBOUNCE_MS } from "@/config/ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useQueryNavigation } from "@/hooks/use-query-navigation";
import { REGISTER_STATUSES, REGISTER_TYPES } from "@/services/registers/schema";

/**
 * Filtres de la liste des registres.
 *
 * L'état vit dans l'URL, comme ailleurs : la vue filtrée se partage, le retour
 * arrière défait le filtre, le rechargement ne perd rien.
 */

const ALL = "__all__";

export function RegisterFilters({ wilayas }: { readonly wilayas: readonly string[] }) {
  const t = useTranslations("registers.filters");
  const tType = useTranslations("registers.type");
  const tStatus = useTranslations("registers.status");
  const params = useSearchParams();
  const { navigate, busy } = useQueryNavigation();

  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);

  function apply(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value.length === 0) next.delete(key);
      else next.set(key, value);
    }
    navigate(next);
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (debounced === current) return;
    apply({ q: debounced.length === 0 ? null : debounced });
    // Seule la valeur amortie doit relancer l'effet : `apply` et `params`
    // changent à chaque rendu et le feraient boucler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="md:col-span-2">
        <Label htmlFor="register-search">{t("search")}</Label>
        <div className="relative mt-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
          />
          <Input
            id="register-search"
            value={term}
            disabled={busy}
            onChange={(event) => {
              setTerm(event.target.value);
            }}
            placeholder={t("searchPlaceholder")}
            className="ps-9"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="register-type">{t("type")}</Label>
        <Select
          value={params.get("type") ?? ALL}
          disabled={busy}
          onValueChange={(value) => {
            apply({ type: value === ALL ? null : value });
          }}
        >
          <SelectTrigger id="register-type" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("all")}</SelectItem>
            {REGISTER_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {tType(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="register-status">{t("status")}</Label>
        <Select
          value={params.get("status") ?? ALL}
          disabled={busy}
          onValueChange={(value) => {
            apply({ status: value === ALL ? null : value });
          }}
        >
          <SelectTrigger id="register-status" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("all")}</SelectItem>
            {REGISTER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {tStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {wilayas.length > 0 ? (
        <div>
          <Label htmlFor="register-wilaya">{t("wilaya")}</Label>
          <Select
            value={params.get("wilaya") ?? ALL}
            disabled={busy}
            onValueChange={(value) => {
              apply({ wilaya: value === ALL ? null : value });
            }}
          >
            <SelectTrigger id="register-wilaya" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("all")}</SelectItem>
              {/*
               * ⚠️ Les wilayas viennent de la BASE, pas d'une liste des 58
               * wilayas d'Algérie. Proposer un filtre sur une wilaya où
               * l'entreprise n'a aucun établissement ne rend jamais qu'une
               * liste vide, et fait douter du filtre plutôt que des données.
               */}
              {wilayas.map((wilaya) => (
                <SelectItem key={wilaya} value={wilaya}>
                  {wilaya}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
