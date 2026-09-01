"use client";

import { CalendarDays, List, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Badge } from "@/components/ui/badge";
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
import { CRITICALITIES, OCCURRENCE_STATUSES } from "@/config/constants";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Filtres de l'échéancier.
 *
 * ⚠️ L'état vit dans l'URL — c'est ce qui rend une vue PARTAGEABLE. Coller un
 * lien à un collègue doit lui montrer exactement la même liste. Un état local
 * donnerait un lien qui ne transporte rien.
 *
 * La mémorisation par utilisateur est un filet, pas la source de vérité : elle
 * ne s'applique que lorsque l'URL ne porte AUCUN filtre.
 */

const ALL = "__all__";

export function OccurrenceFilterBar({
  domains,
  authorities,
  owners,
  calendarHref,
  isCalendar = false,
}: {
  readonly domains: readonly { readonly id: string; readonly label: string }[];
  readonly authorities: readonly { readonly id: string; readonly name: string }[];
  readonly owners: readonly { readonly id: string; readonly fullName: string }[];
  readonly calendarHref: string;
  readonly isCalendar?: boolean;
}) {
  const t = useTranslations("occurrences.filters");
  const tOcc = useTranslations("occurrences");
  const tCriticality = useTranslations("obligations.criticality");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value.length === 0) next.delete(key);
      else next.set(key, value);
    }
    // Tout changement de filtre invalide la page courante : le curseur pointe
    // une position dans un jeu de résultats qui n'existe plus.
    next.delete("cursor");

    /*
     * ⚠️ Forme OBJET et TRANSITION. Le routeur de next-intl traite son argument
     * comme un chemin : une chaîne « /echeancier?x=1 » n'y transporte aucune
     * requête. Et une navigation douce ne valide l'URL qu'une fois la charge
     * serveur reçue — sans transition, un changement émis pendant qu'un autre
     * est en vol est abandonné en silence.
     */
    startTransition(() => {
      router.replace({ pathname, query: Object.fromEntries(next.entries()) });
    });
  }

  const statuses = (params.get("status") ?? "").split(",").filter((s) => s.length > 0);

  function toggleStatus(status: string): void {
    const next = statuses.includes(status)
      ? statuses.filter((s) => s !== status)
      : [...statuses, status];
    apply({ status: next.join(",") });
  }

  const activeKeys = [
    "period",
    "status",
    "domain",
    "authority",
    "owner",
    "criticality",
    "overdue",
    "internallyLate",
    "rectifications",
    "mine",
  ];
  const hasFilters = activeKeys.some((key) => params.get(key) !== null);

  return (
    <div
      className="mb-4 space-y-3 rounded-lg border border-border bg-surface p-3"
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 space-y-1.5">
          <Label htmlFor="filter-period">{tOcc("period")}</Label>
          <Input
            id="filter-period"
            defaultValue={params.get("period") ?? ""}
            placeholder={t("periodPlaceholder")}
            onBlur={(event) => {
              apply({ period: event.target.value.trim() });
            }}
          />
        </div>

        <FilterSelect
          id="filter-domain"
          label={tOcc("domain")}
          allLabel={t("all")}
          value={params.get("domain")}
          items={domains.map((domain) => ({ value: domain.id, label: domain.label }))}
          onChange={(value) => {
            apply({ domain: value });
          }}
        />

        <FilterSelect
          id="filter-authority"
          label={tOcc("authority")}
          allLabel={t("all")}
          value={params.get("authority")}
          items={authorities.map((a) => ({ value: a.id, label: a.name }))}
          onChange={(value) => {
            apply({ authority: value });
          }}
        />

        <FilterSelect
          id="filter-owner"
          label={tOcc("owner")}
          allLabel={t("all")}
          value={params.get("owner")}
          items={owners.map((o) => ({ value: o.id, label: o.fullName }))}
          onChange={(value) => {
            apply({ owner: value });
          }}
        />

        <FilterSelect
          id="filter-criticality"
          label={tOcc("criticalityColumn")}
          allLabel={t("all")}
          value={params.get("criticality")}
          items={CRITICALITIES.map((value) => ({
            value,
            label: tCriticality(value),
          }))}
          onChange={(value) => {
            apply({ criticality: value });
          }}
        />

        <div className="ms-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={calendarHref}>
              {isCalendar ? (
                <List aria-hidden="true" className="size-4" />
              ) : (
                <CalendarDays aria-hidden="true" className="size-4" />
              )}
              {isCalendar ? t("switchToList") : t("switchToCalendar")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Statuts : sélection MULTIPLE. La file de travail se regarde rarement
          statut par statut — « à faire + en cours » est la vue par défaut. */}
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">{tOcc("statusColumn")}</legend>
        {OCCURRENCE_STATUSES.map((status) => {
          const active = statuses.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => {
                toggleStatus(status);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary-subtle font-medium text-text-primary"
                  : "border-border text-text-secondary hover:bg-surface-raised",
              )}
            >
              {tOcc(`status.${status}`)}
            </button>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleFilter
          label={t("overdueOnly")}
          active={params.get("overdue") === "true"}
          onToggle={(next) => {
            apply({ overdue: next ? "true" : null });
          }}
        />
        <ToggleFilter
          label={t("internallyLateOnly")}
          active={params.get("internallyLate") === "true"}
          onToggle={(next) => {
            apply({ internallyLate: next ? "true" : null });
          }}
        />
        <ToggleFilter
          label={t("rectificationsOnly")}
          active={params.get("rectifications") === "true"}
          onToggle={(next) => {
            apply({ rectifications: next ? "true" : null });
          }}
        />
        <ToggleFilter
          label={t("mineOnly")}
          active={params.get("mine") === "true"}
          onToggle={(next) => {
            apply({ mine: next ? "true" : null });
          }}
        />

        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={() => {
              startTransition(() => {
                router.replace({ pathname, query: {} });
              });
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

function ToggleFilter({
  label,
  active,
  onToggle,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        onToggle(!active);
      }}
    >
      <Badge variant={active ? "default" : "outline"}>{label}</Badge>
    </button>
  );
}

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  items,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly allLabel: string;
  readonly value: string | null;
  readonly items: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string | null) => void;
}) {
  return (
    <div className="w-44 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? ALL}
        onValueChange={(next) => {
          onChange(next === ALL ? null : next);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* Valeur sentinelle : Radix réserve la chaîne vide à « rien de
              sélectionné » et refuse une SelectItem vide. */}
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
