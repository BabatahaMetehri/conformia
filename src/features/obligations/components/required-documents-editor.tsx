"use client";

import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DOCUMENT_KINDS, type DocumentKind } from "@/config/constants";
import type { RequiredDocumentInput } from "@/services/obligations/schema";
import { cn } from "@/lib/utils";

/**
 * Liste ordonnée des pièces requises, réorganisable.
 *
 * ⚠️ DEUX chemins de réorganisation, et le second n'est pas optionnel.
 *
 * Le glisser-déposer HTML5 est inaccessible par nature : il n'a aucun équivalent
 * clavier, et les lecteurs d'écran n'annoncent ni la prise ni le dépôt. Livrer
 * uniquement le glisser-déposer rendrait la fonction inutilisable pour qui
 * n'utilise pas de souris. Les boutons « monter » / « descendre » sont donc le
 * chemin de référence, le glisser-déposer étant le raccourci à la souris.
 *
 * L'ordre EST la position dans le tableau : aucun champ `order_index` n'est
 * saisi. Deux pièces au même rang buteraient sur la contrainte unique en base,
 * et l'utilisateur verrait une erreur technique pour un geste qui, à l'écran,
 * semblait légitime.
 */
export function RequiredDocumentsEditor({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: readonly RequiredDocumentInput[];
  readonly onChange: (documents: readonly RequiredDocumentInput[]) => void;
  readonly disabled?: boolean;
}) {
  const t = useTranslations("obligations.documents");
  const tKind = useTranslations("documents.kind");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function move(from: number, to: number): void {
    if (to < 0 || to >= value.length || from === to) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onChange(next);
  }

  function patch(index: number, changes: Partial<RequiredDocumentInput>): void {
    onChange(value.map((item, position) => (position === index ? { ...item, ...changes } : item)));
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {t("empty")}
        </p>
      ) : (
        <ol className="space-y-2">
          {value.map((document, index) => (
            <li
              key={document.id ?? `new-${String(index)}`}
              draggable={!disabled}
              onDragStart={() => {
                setDragIndex(index);
              }}
              onDragOver={(event) => {
                // Sans `preventDefault`, le navigateur refuse le dépôt.
                event.preventDefault();
              }}
              onDrop={() => {
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
              }}
              className={cn(
                "rounded-lg border border-border bg-surface p-3",
                dragIndex === index && "opacity-50",
              )}
            >
              <div className="flex items-start gap-2">
                <GripVertical
                  aria-hidden="true"
                  className="mt-2 size-4 shrink-0 cursor-grab text-text-muted"
                />

                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`doc-label-${String(index)}`}>{t("label")}</Label>
                    <Input
                      id={`doc-label-${String(index)}`}
                      value={document.label}
                      disabled={disabled}
                      onChange={(event) => {
                        patch(index, { label: event.target.value });
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`doc-kind-${String(index)}`}>{t("kind")}</Label>
                    <Select
                      value={document.document_kind ?? "NONE"}
                      disabled={disabled}
                      onValueChange={(next) => {
                        patch(index, {
                          document_kind: next === "NONE" ? null : (next as DocumentKind),
                        });
                      }}
                    >
                      <SelectTrigger id={`doc-kind-${String(index)}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">{t("kindUnset")}</SelectItem>
                        {DOCUMENT_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {tKind(kind)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`doc-size-${String(index)}`}>{t("maxSize")}</Label>
                    <Input
                      id={`doc-size-${String(index)}`}
                      type="number"
                      min={1}
                      max={100}
                      value={document.max_size_mb ?? 25}
                      disabled={disabled}
                      onChange={(event) => {
                        patch(index, {
                          max_size_mb: Number.parseInt(event.target.value, 10) || 25,
                        });
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-2 sm:col-span-2">
                    <Checkbox
                      id={`doc-mandatory-${String(index)}`}
                      checked={document.is_mandatory ?? true}
                      disabled={disabled}
                      onCheckedChange={(checked) => {
                        patch(index, { is_mandatory: checked === true });
                      }}
                    />
                    <Label htmlFor={`doc-mandatory-${String(index)}`} className="font-normal">
                      {t("mandatory")}
                    </Label>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  {/*
                    Chemin CLAVIER de la réorganisation. Il n'est pas un repli
                    dégradé : c'est le seul qui fonctionne sans souris, et le seul
                    qu'un lecteur d'écran sache annoncer.
                  */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled || index === 0}
                    aria-label={t("moveUp", { position: index + 1 })}
                    onClick={() => {
                      move(index, index - 1);
                    }}
                  >
                    <ChevronUp aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled || index === value.length - 1}
                    aria-label={t("moveDown", { position: index + 1 })}
                    onClick={() => {
                      move(index, index + 1);
                    }}
                  >
                    <ChevronDown aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={t("remove", { position: index + 1 })}
                    onClick={() => {
                      onChange(value.filter((_, position) => position !== index));
                    }}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          onChange([
            ...value,
            {
              label: "",
              description: null,
              is_mandatory: true,
              document_kind: null,
              max_size_mb: 25,
            },
          ]);
        }}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("add")}
      </Button>
    </div>
  );
}
