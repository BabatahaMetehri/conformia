"use client";

import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type DragEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * Zone de dépôt de pièces.
 *
 * Purement présentationnelle : elle remonte des `File`, elle n'envoie rien.
 * Le dépôt réel, l'empreinte et le chemin de stockage relèvent du serveur — un
 * chemin construit côté client ne serait jamais digne de confiance.
 *
 * ACCESSIBILITÉ : le glisser-déposer n'est JAMAIS le seul chemin. Le bloc est un
 * `<label>` associé à un `<input type="file">` réel — donc atteignable au clavier,
 * annoncé correctement, et utilisable sans souris.
 */

interface FileDropzoneProps {
  readonly onFilesSelected: (files: readonly File[]) => void;
  /** Types MIME acceptés, issus de la liste blanche applicative. */
  readonly accept: readonly string[];
  readonly maxSizeMb: number;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function FileDropzone({
  onFilesSelected,
  accept,
  maxSizeMb,
  multiple = true,
  disabled = false,
  className,
}: FileDropzoneProps) {
  const t = useTranslations("documents.dropzone");
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (list === null || list.length === 0) return;
    onFilesSelected([...list]);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  }

  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center transition-colors",
          isDragging && "border-primary bg-primary-subtle",
          disabled && "cursor-not-allowed opacity-60",
          // L'anneau suit le focus de l'input associé : le label est le contrôle visible.
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
        )}
      >
        <Upload aria-hidden="true" className="size-7 text-text-muted" />
        <span className="text-sm font-medium text-text-primary">{t("prompt")}</span>
        <span id={hintId} className="text-xs text-text-muted">
          {t("constraints", { maxSizeMb, count: accept.length })}
        </span>
      </label>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept.join(",")}
        multiple={multiple}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => {
          handleFiles(event.target.files);
          // Réinitialisé pour que re-déposer le MÊME fichier déclenche l'événement.
          event.target.value = "";
        }}
      />
    </div>
  );
}
