"use client";

/**
 * Primitives de formulaire du parcours d'authentification.
 *
 * Volontairement minimales : shadcn/ui n'est pas encore installé, et ces écrans
 * doivent fonctionner sans dépendre de son arrivée. Aucune chaîne visible n'est
 * écrite ici — tout vient de `next-intl`.
 */

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium">
      {children}
    </label>
  );
}

interface TextFieldProps {
  readonly id: string;
  readonly name: string;
  readonly type: "email" | "password" | "text";
  readonly label: string;
  readonly autoComplete: string;
  readonly required?: boolean;
  readonly minLength?: number;
  readonly inputMode?: "numeric" | "email" | "text";
  readonly pattern?: string;
  readonly hint?: string;
}

export function TextField({
  id,
  name,
  type,
  label,
  autoComplete,
  required = true,
  minLength,
  inputMode,
  pattern,
  hint,
}: TextFieldProps) {
  return (
    <div className="space-y-1">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        {...(minLength === undefined ? {} : { minLength })}
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(pattern === undefined ? {} : { pattern })}
        {...(hint === undefined ? {} : { "aria-describedby": `${id}-hint` })}
        className="w-full rounded border px-3 py-2"
      />
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-xs opacity-70">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Bouton de soumission désactivé pendant l'envoi — double soumission impossible. */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded bg-foreground px-3 py-2 text-background disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/** `role="alert"` : l'erreur est annoncée aux lecteurs d'écran dès son apparition. */
export function FormError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="rounded border border-current px-3 py-2 text-sm">
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message: string }) {
  return (
    <p role="status" className="rounded border px-3 py-2 text-sm">
      {message}
    </p>
  );
}
