"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveSettingAction } from "@/features/admin/actions/admin";
import { formatDateTimeFr } from "@/lib/dates";
import type { SettingRow } from "@/services/admin";
import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * Réglages de l'installation.
 *
 * ⚠️ La validation est pilotée par `app_settings.value_type`, lu en base. Un
 * réglage ajouté demain est donc validé sans qu'on touche à cet écran — c'est le
 * même principe que partout ailleurs : les règles sont des données.
 *
 * ⚠️ La DESCRIPTION est affichée à côté de chaque champ, pas dans une
 * documentation séparée. Un réglage dont on ne comprend pas l'effet est un
 * réglage qu'on modifie au hasard.
 */
export function SettingsView({ settings }: { readonly settings: readonly SettingRow[] }) {
  const t = useTranslations("admin.settings");
  const tActions = useTranslations("common.actions");

  const [pending, run] = useActionRunner();
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(settings.map((setting) => [setting.key, serialise(setting.value)])),
  );

  function save(key: string): void {
    run(async () => {
      const outcome = await saveSettingAction({ key, value: drafts[key] ?? "" });
      if (outcome.status === "error") {
        // Le message porte la raison du refus : « entier attendu » se corrige,
        // « échec » ne se corrige pas.
        toast.error(t("failed"), { description: outcome.error.message });
        return;
      }
      toast.success(t("saved", { key }));
    });
  }

  return (
    <div className="space-y-2">
      {settings.map((setting) => {
        const draft = drafts[setting.key] ?? "";
        const dirty = draft !== serialise(setting.value);

        return (
          <section
            key={setting.key}
            className="grid gap-3 rounded-lg border border-border bg-surface p-3 lg:grid-cols-[1fr_20rem_auto] lg:items-start"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                <span data-numeric>{setting.key}</span>
                <Badge variant="outline">{setting.valueType}</Badge>
              </p>
              <p className="mt-1 text-xs text-text-secondary">{setting.description}</p>
              <p className="mt-1 text-xs text-text-muted">
                {t("updatedAt", { date: formatDateTimeFr(new Date(setting.updatedAt)) })}
              </p>
            </div>

            <div>
              <label className="sr-only" htmlFor={`setting-${setting.key}`}>
                {setting.key}
              </label>
              <Input
                id={`setting-${setting.key}`}
                value={draft}
                data-numeric
                onChange={(event) => {
                  setDrafts({ ...drafts, [setting.key]: event.target.value });
                }}
              />
              <p className="mt-1 text-xs text-text-muted">{hintFor(setting.valueType, t)}</p>
            </div>

            <Button
              size="sm"
              disabled={pending || !dirty}
              onClick={() => {
                save(setting.key);
              }}
            >
              {tActions("save")}
            </Button>
          </section>
        );
      })}
    </div>
  );
}

/** JSON compact pour les structures, valeur nue pour les scalaires. */
function serialise(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function hintFor(valueType: string, t: (key: string) => string): string {
  switch (valueType) {
    case "boolean":
      return t("hintBoolean");
    case "integer":
      return t("hintInteger");
    case "array":
      return t("hintArray");
    case "object":
      return t("hintObject");
    default:
      return t("hintString");
  }
}
