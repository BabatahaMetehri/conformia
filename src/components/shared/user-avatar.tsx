import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Avatar d'utilisateur, réduit aux initiales.
 *
 * Pas de photo : l'application ne stocke pas d'image de personne, et n'a aucune
 * raison de le faire. Les initiales suffisent à distinguer un responsable d'un
 * validateur dans un tableau.
 *
 * L'avatar est décoratif — le nom est affiché à côté, ou porté par `aria-label`
 * quand il ne l'est pas. Deux personnes aux mêmes initiales ne doivent pas être
 * indiscernables pour un lecteur d'écran.
 */

const SIZES = {
  sm: "size-6 text-2xs",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const;

export function UserAvatar({
  fullName,
  size = "md",
  showName = false,
  className,
}: {
  /** `null` pour un compte sans nom renseigné : on retombe sur un tiret. */
  readonly fullName: string | null;
  readonly size?: keyof typeof SIZES;
  readonly showName?: boolean;
  readonly className?: string;
}) {
  const initials = toInitials(fullName);

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Avatar
        className={cn(SIZES[size], "shrink-0")}
        {...(showName ? { "aria-hidden": true } : { "aria-label": fullName ?? undefined })}
      >
        <AvatarFallback className="bg-primary-subtle font-medium text-primary">
          {initials}
        </AvatarFallback>
      </Avatar>
      {showName ? <span className="text-sm text-text-primary">{fullName ?? "—"}</span> : null}
    </span>
  );
}

/** Deux initiales au plus : « Amina Belkacem » → « AB ». */
function toInitials(fullName: string | null): string {
  if (fullName === null) return "—";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
