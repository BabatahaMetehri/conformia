"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useQueryNavigation } from "@/hooks/use-query-navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRITICALITIES, PERIODICITIES } from "@/config/constants";
import { SEARCH_DEBOUNCE_MS } from "@/config/ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Filtres du référentiel.
 *
 * L'état vit dans l'URL, pas dans un store. Trois conséquences voulues : la
 * liste filtrée se partage par copier-coller, le retour arrière du navigateur
 * défait le filtre, et le rechargement de page ne perd rien. Un `useState`
 * donnerait les trois comportements inverses.
 */

const ALL = "__all__";

export function ObligationFilters({
  domains,
  authorities,
}: {
  readonly domains: readonly { readonly id: string; readonly label: string }[];
  readonly authorities: readonly { readonly id: string; readonly name: string }[];
}) {
  const t = useTranslations("obligations.filters");
  const tObligations = useTranslations("obligations");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /*
   * ⚠️ `busy` couvre AUSSI l'avant-hydratation : la saisie de recherche est
   * rendue mais son gestionnaire `onChange` n'existe pas encore, et ce qu'on y
   * tape n'atteint personne. Le champ est donc inerte tant que React n'a pas
   * repris la main — quelques centaines de millisecondes, visibles, plutôt
   * qu'une frappe avalée.
   */
  const { navigate, busy } = useQueryNavigation();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);

  function apply(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value.length === 0) next.delete(key);
      else next.set(key, value);
    }
    // La forme objet, la transition et la RELANCE tant que l'URL n'a pas pris
    // vivent dans `useQueryNavigation` — les trois pièges y sont documentés.
    navigate(next);
  }

  // La frappe ne navigue qu'après le silence : une navigation par touche
  // rechargerait la liste dix fois pour une recherche de dix caractères.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (debounced === current) return;
    apply({ q: debounced.length === 0 ? null : debounced });
    // `apply` et `params` changent à chaque rendu ; les inclure relancerait
    // l'effet en boucle. Seule la valeur amortie doit le déclencher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const hasFilters =
    ["q", "domain", "authority", "periodicity", "criticality", "active"].some(
      (key) => params.get(key) !== null,
    ) || term.length > 0;

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5 lg:col-span-3">
          <Label htmlFor="obligation-search">{t("search")}</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              id="obligation-search"
              value={term}
              placeholder={t("searchPlaceholder")}
              className="ps-9"
              onChange={(event) => {
                setTerm(event.target.value);
              }}
              aria-busy={busy}
              disabled={busy}
            />
          </div>
          <p className="text-xs text-text-muted">{t("searchHint")}</p>
        </div>

        <FilterSelect
          disabled={busy}
          id="filter-domain"
          label={tObligations("domain")}
          allLabel={t("all")}
          value={params.get("domain")}
          items={domains.map((domain) => ({ value: domain.id, label: domain.label }))}
          onChange={(value) => {
            apply({ domain: value });
          }}
        />

        <FilterSelect
          disabled={busy}
          id="filter-authority"
          label={tObligations("authority")}
          allLabel={t("all")}
          value={params.get("authority")}
          items={authorities.map((authority) => ({
            value: authority.id,
            label: authority.name,
          }))}
          onChange={(value) => {
            apply({ authority: value });
          }}
        />

        <FilterSelect
          disabled={busy}
          id="filter-periodicity"
          label={tObligations("periodicityColumn")}
          allLabel={t("all")}
          value={params.get("periodicity")}
          items={PERIODICITIES.map((value) => ({
            value,
            label: tObligations(`periodicity.${value}`),
          }))}
          onChange={(value) => {
            apply({ periodicity: value });
          }}
        />

        <FilterSelect
          disabled={busy}
          id="filter-criticality"
          label={tObligations("criticalityColumn")}
          allLabel={t("all")}
          value={params.get("criticality")}
          items={CRITICALITIES.map((value) => ({
            value,
            label: tObligations(`criticality.${value}`),
          }))}
          onChange={(value) => {
            apply({ criticality: value });
          }}
        />

        <FilterSelect
          disabled={busy}
          id="filter-active"
          label={tObligations("status")}
          allLabel={t("all")}
          value={params.get("active")}
          items={[
            { value: "true", label: tObligations("active") },
            { value: "false", label: tObligations("inactive") },
          ]}
          onChange={(value) => {
            apply({ active: value });
          }}
        />
      </div>

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm("");
            router.replace(pathname);
          }}
        >
          <X aria-hidden="true" className="size-4" />
          {t("reset")}
        </Button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  items,
  onChange,
  disabled = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly allLabel: string;
  readonly value: string | null;
  readonly items: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string | null) => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        disabled={disabled}
        value={value ?? ALL}
        onValueChange={(next) => {
          onChange(next === ALL ? null : next);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* « Tous » est une valeur sentinelle : Radix réserve la chaîne vide
              à l'état « rien de sélectionné » et refuse une SelectItem vide. */}
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
