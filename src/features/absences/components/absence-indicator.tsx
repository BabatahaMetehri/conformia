import { CalendarOff } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { formatDateFr } from "@/lib/dates";
import type { AbsenceRow } from "@/services/absences";

/**
 * Indicateur d'absence du tableau de bord.
 *
 * ⚠️ IL DIT « EST ABSENT », PAS « N'A PAS LES DROITS ». Une absence oriente les
 * rappels ; elle ne transfère aucune permission, et le suppléant peut agir en
 * permanence. L'indicateur existe pour répondre à une seule question — « pourquoi
 * ce dossier n'avance-t-il pas ? » — et il faut qu'il y réponde sans laisser
 * croire qu'une action est bloquée.
 *
 * Server Component : aucune interactivité, donc rien à envoyer au navigateur.
 */
export async function AbsenceIndicator({ absences }: { readonly absences: readonly AbsenceRow[] }) {
  if (absences.length === 0) return null;

  const t = await getTranslations("absences");

  return (
    <section
      aria-labelledby="absences-heading"
      className="mb-6 rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="absences-heading"
        className="flex items-center gap-2 text-sm font-semibold text-text-primary"
      >
        <CalendarOff aria-hidden="true" className="size-4 text-text-muted" />
        {t("dashboard.title")}
      </h2>

      <ul className="mt-3 space-y-1.5">
        {absences.map((absence) => (
          <li key={absence.id} className="text-sm text-text-secondary">
            {t("dashboard.entry", {
              name: absence.userName,
              // Midi UTC : assez loin des bornes du jour pour qu'aucun décalage
              // de fuseau ne fasse afficher la veille.
              date: formatDateFr(new Date(`${absence.endsAt}T12:00:00Z`)),
            })}
          </li>
        ))}
      </ul>

      <Link
        href="/absences"
        className="mt-3 inline-block text-xs text-accent underline-offset-2 hover:underline"
      >
        {t("title")}
      </Link>
    </section>
  );
}
