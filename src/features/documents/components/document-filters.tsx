"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

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
import { DOCUMENT_KINDS } from "@/config/constants";
import { SEARCH_DEBOUNCE_MS } from "@/config/ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useQueryNavigation } from "@/hooks/use-query-navigation";

/**
 * Filtres de la recherche transverse.
 *
 * L'état vit dans l'URL, pas dans un store : la recherche se partage par
 * copier-coller, le retour arrière défait le filtre, et le rechargement ne perd
 * rien. Même convention que le référentiel, y compris ses deux pièges — forme
 * objet obligatoire pour `router.replace`, et transition pour ne pas perdre une
 * navigation émise pendant qu'une autre est en vol.
 */

const ALL = "__all__";

export function DocumentFilters({
  obligations,
  authorities,
  uploaders,
}: {
  readonly obligations: readonly { readonly id: string; readonly label: string }[];
  readonly authorities: readonly { readonly id: string; readonly name: string }[];
  readonly uploaders: readonly { readonly id: string; readonly name: string }[];
}) {
  const t = useTranslations("documents.search");
  const tKind = useTranslations("documents.kind");
  const params = useSearchParams();

  const { navigate, pending } = useQueryNavigation();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);

  function apply(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value.length === 0) next.delete(key);
      else next.set(key, value);
    }
    // Tout changement de filtre ramène en première page : rester en page 4 d'un
    // résultat qui n'en compte plus qu'une affiche une liste vide trompeuse.
    next.delete("page");

    navigate(next);
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (debounced === current) return;
    apply({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` est recréée à chaque rendu ; la dépendance utile est la valeur stabilisée.
  }, [debounced]);

  const value = (key: string): string => params.get(key) ?? ALL;
  const hasFilters = [...params.keys()].some((key) => key !== "page");

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="document-search">{t("title")}</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              id="document-search"
              className="ps-8"
              placeholder={t("placeholder")}
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
              }}
            />
          </div>
        </div>

        <FilterSelect
          label={t("obligation")}
          value={value("obligation")}
          onChange={(next) => {
            apply({ obligation: next });
          }}
          options={obligations.map((row) => ({ id: row.id, label: row.label }))}
        />
        <FilterSelect
          label={t("authority")}
          value={value("authority")}
          onChange={(next) => {
            apply({ authority: next });
          }}
          options={authorities.map((row) => ({ id: row.id, label: row.name }))}
        />
        <FilterSelect
          label={t("kind")}
          value={value("kind")}
          onChange={(next) => {
            apply({ kind: next });
          }}
          options={DOCUMENT_KINDS.map((kind) => ({ id: kind, label: tKind(kind) }))}
        />
        <FilterSelect
          label={t("uploader")}
          value={value("uploader")}
          onChange={(next) => {
            apply({ uploader: next });
          }}
          options={uploaders.map((row) => ({ id: row.id, label: row.name }))}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="document-from">{t("from")}</Label>
          <Input
            id="document-from"
            type="date"
            className="w-44"
            defaultValue={params.get("from") ?? ""}
            onChange={(event) => {
              apply({ from: event.target.value });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="document-to">{t("to")}</Label>
          <Input
            id="document-to"
            type="date"
            className="w-44"
            defaultValue={params.get("to") ?? ""}
            onChange={(event) => {
              apply({ to: event.target.value });
            }}
          />
        </div>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setTerm("");
              navigate(new URLSearchParams());
            }}
          >
            <X aria-hidden="true" className="size-4" />
            {t("reset")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string | null) => void;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}) {
  const t = useTranslations("common");

  if (options.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          onChange(next === ALL ? null : next);
        }}
      >
        <SelectTrigger className="w-52">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("all")}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
