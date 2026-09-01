"use client";

/**
 * File d'envois en cours : une ligne par fichier, sa propre barre, son propre
 * bouton de reprise.
 *
 * ⚠️ Une barre unique pour un lot serait plus simple et moins utile : quand
 * trois pièces partent et qu'une échoue, l'utilisateur doit voir LAQUELLE. Une
 * progression agrégée l'oblige à tout recommencer pour retrouver le fichier
 * fautif.
 */

import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { UploadEntry } from "@/components/shared/use-direct-upload";
import { cn } from "@/lib/utils";

export function UploadQueue({
  entries,
  onRetry,
  onDismiss,
}: {
  readonly entries: readonly UploadEntry[];
  readonly onRetry: (key: string) => void;
  readonly onDismiss: (key: string) => void;
}) {
  const t = useTranslations("documents.upload");

  if (entries.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label={t("queueLabel")}>
      {entries.map((entry) => (
        <li
          key={entry.key}
          className={cn(
            "rounded-md border px-3 py-2",
            entry.stage === "FAILED"
              ? "border-destructive/40 bg-destructive/5"
              : "border-border bg-surface",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
              {entry.file.name}
            </span>

            {entry.stage === "DONE" ? (
              <Check aria-hidden="true" className="size-4 text-status-validated" />
            ) : null}
            {entry.stage === "FAILED" ? (
              <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />
            ) : null}

            <span className="shrink-0 text-xs text-text-muted">{t(`stage.${entry.stage}`)}</span>

            {entry.stage === "FAILED" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onRetry(entry.key);
                }}
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                {t("retry")}
              </Button>
            ) : null}

            {entry.stage === "DONE" || entry.stage === "FAILED" ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("dismiss", { name: entry.file.name })}
                onClick={() => {
                  onDismiss(entry.key);
                }}
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
          </div>

          {entry.stage === "UPLOADING" ? (
            <Progress className="mt-2 h-1" value={Math.round(entry.progress * 100)} />
          ) : null}

          {entry.failure === null ? null : (
            // ⚠️ Clé dynamique : les codes de refus viennent du serveur et de la
            // base, qui peuvent en introduire un que `messages/` ne connaît pas
            // encore. `t()` lèverait sur une clé absente et ferait tomber la
            // page entière — un refus mal libellé vaut mieux qu'un écran blanc.
            <p className="mt-1 text-xs text-destructive">
              {t.has(`failure.${entry.failure}`)
                ? t(`failure.${entry.failure}`)
                : t("failure.UPLOAD_FAILED")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
