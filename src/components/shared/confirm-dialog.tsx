"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Confirmation d'une action.
 *
 * En variante `destructive`, l'utilisateur doit RECOPIER un mot. Ce n'est pas de
 * la cérémonie : un bouton « Confirmer » se clique par réflexe, un mot se tape
 * volontairement. Sur des actions qui touchent à des pièces justificatives ou à
 * des habilitations, ce ralentissement est le but.
 *
 * Le piégeage et la restauration du focus sont assurés par Radix : à la
 * fermeture, le focus revient sur l'élément déclencheur.
 */

interface ConfirmDialogProps {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly variant?: "default" | "destructive";
  /**
   * Mot à recopier. Requis en variante destructive ; l'action reste désactivée
   * tant que la saisie ne correspond pas exactement.
   */
  readonly confirmationWord?: string;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = "default",
  confirmationWord,
}: ConfirmDialogProps) {
  const t = useTranslations("common.confirm");
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const hintId = useId();

  const requiresWord = variant === "destructive" && confirmationWord !== undefined;
  const canConfirm = !requiresWord || typed === confirmationWord;

  return (
    <AlertDialog
      onOpenChange={(open) => {
        // Le champ se vide à chaque ouverture : une confirmation ne se rejoue pas
        // par inadvertance sur une seconde action.
        if (!open) setTyped("");
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {requiresWord ? (
          <div className="space-y-2">
            <Label htmlFor={inputId}>{t("typeToConfirm", { word: confirmationWord })}</Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              autoComplete="off"
              aria-describedby={hintId}
              // La saisie ne doit pas être devinée par l'assistant du navigateur.
              spellCheck={false}
            />
            <p id={hintId} className="text-xs text-text-muted">
              {t("irreversible")}
            </p>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={onConfirm}
            className={cn(
              variant === "destructive" &&
                "bg-status-overdue text-text-inverse hover:bg-status-overdue/90",
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
