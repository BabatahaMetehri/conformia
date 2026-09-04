"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryNavigation } from "@/hooks/use-query-navigation";

/**
 * Sélecteur de registre du tableau de bord.
 *
 * ⚠️ L'état vit dans l'URL, comme partout ailleurs : la vue filtrée se partage
 * par copier-coller, le retour arrière défait le filtre, le rechargement ne perd
 * rien. Un `useState` donnerait les trois comportements inverses.
 */

const ALL = "__all__";

export function RegisterScopeSelect({
  registers,
}: {
  readonly registers: readonly { readonly id: string; readonly label: string }[];
}) {
  const t = useTranslations("registers");
  const params = useSearchParams();
  const { navigate, busy } = useQueryNavigation();

  if (registers.length === 0) return null;

  return (
    <div className="mb-4 max-w-sm">
      <Label htmlFor="dashboard-register">{t("filterLabel")}</Label>
      <Select
        value={params.get("register") ?? ALL}
        disabled={busy}
        onValueChange={(value) => {
          const next = new URLSearchParams(params.toString());
          if (value === ALL) next.delete("register");
          else next.set("register", value);
          navigate(next);
        }}
      >
        <SelectTrigger id="dashboard-register" className="mt-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filterAll")}</SelectItem>
          {registers.map((register) => (
            <SelectItem key={register.id} value={register.id}>
              {register.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
