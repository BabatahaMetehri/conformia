"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Markdown } from "@/components/shared/markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Éditeur de procédure : saisie Markdown et prévisualisation.
 *
 * Onglets plutôt que deux volets côte à côte. Sur une procédure de dépôt, le
 * texte est long et l'écran déjà chargé de champs ; deux colonnes étroites se
 * lisent moins bien qu'une large, et la prévisualisation n'a pas besoin d'être
 * permanente — on l'ouvre pour vérifier, pas pour rédiger.
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  onBlur,
  label,
  describedBy,
  rows = 14,
  className,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly label: string;
  readonly describedBy?: string | undefined;
  readonly rows?: number;
  readonly className?: string;
}) {
  const t = useTranslations("obligations.procedure");
  const [tab, setTab] = useState("write");

  return (
    <div className={cn("space-y-2", className)}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="write">{t("write")}</TabsTrigger>
          <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
        </TabsList>

        <TabsContent value="write">
          <Textarea
            id={id}
            value={value}
            rows={rows}
            aria-label={label}
            {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            {...(onBlur === undefined ? {} : { onBlur })}
            className="font-mono text-xs"
          />
          <p className="mt-1 text-xs text-text-muted">{t("hint")}</p>
        </TabsContent>

        <TabsContent value="preview">
          <div className="min-h-40 rounded-md border border-border bg-surface p-4">
            {value.trim().length === 0 ? (
              <p className="text-sm text-text-muted">{t("emptyPreview")}</p>
            ) : (
              <Markdown source={value} />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
