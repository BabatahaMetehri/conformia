/**
 * MAINTENANCE DU CALENDRIER DES JOURS FÉRIÉS — tâche annuelle.
 *
 * ⚠️ LE SYSTÈME SE RAPPELLE DE SA PROPRE MAINTENANCE. Chaque 1er décembre, cette
 * tâche crée une occurrence « Mise à jour du calendrier des jours fériés N+1 »
 * assignée à l'administrateur.
 *
 * La raison est concrète. Les fêtes religieuses — Aïd el-Fitr, Aïd el-Adha, Awal
 * Moharem, Achoura, Mawlid Ennabaoui — suivent le calendrier hégirien et sont
 * fixées chaque année par décret : elles ne peuvent pas être calculées, elles
 * doivent être saisies. Une saisie annuelle que rien ne réclame est une saisie
 * qu'on oublie, et un calendrier oublié fait tomber des échéances un jour chômé
 * — c'est-à-dire fabrique des retards par le seul fait de ne pas s'être tenu à
 * jour. La tâche transforme donc un oubli silencieux en dossier qui apparaît
 * dans une file de travail.
 *
 * Elle est IDEMPOTENTE : relancée deux fois la même année, elle ne crée qu'une
 * occurrence — la contrainte d'unicité (obligation, période) s'en charge, et on
 * la traite comme un succès plutôt que comme une erreur.
 */

// ⚠️ EN PREMIER, avant le client de service : ce module pose le marqueur
// que la garde d'emplacement attend (cf. admin-guard.ts).
import "@/server/jobs/_job-context";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/** Code de l'obligation interne portant cette maintenance. */
const OBLIGATION_CODE = "SYS-HOLIDAYS";

export interface HolidayReminderReport {
  readonly year: number;
  readonly created: boolean;
  readonly occurrenceId: string | null;
}

export async function ensureHolidayCalendarTask(
  today: Date = new Date(),
): Promise<HolidayReminderReport> {
  const supabase = createSupabaseAdminClient();
  const targetYear = today.getUTCFullYear() + 1;
  const periodKey = String(targetYear);

  // L'obligation interne est créée à la première exécution : elle n'a pas sa
  // place dans le référentiel réglementaire livré, ce n'est pas une obligation
  // légale mais une tâche de l'outil.
  const { data: obligation, error: obligationError } = await supabase
    .from("obligation_types")
    .upsert(
      {
        code: OBLIGATION_CODE,
        name: "Mise à jour du calendrier des jours fériés",
        periodicity: "ANNUAL",
        due_rule: { anchor: "PERIOD_START", offset_days: 20 },
        effective_from: "2000-01-01",
        criticality: "HIGH",
        legal_basis:
          "Fêtes religieuses fixées par décret chaque année : saisie manuelle obligatoire.",
      },
      { onConflict: "code" },
    )
    .select("id")
    .single();

  if (obligationError !== null) {
    throw new Error(`Obligation de maintenance indisponible : ${obligationError.message}`);
  }

  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id, roles!inner(code)")
    .eq("roles.code", "ADMIN")
    .is("revoked_at", null)
    .limit(1);

  const owner = admins?.[0]?.user_id ?? null;
  if (owner === null) {
    // Sans administrateur, la tâche n'a pas de destinataire. On le DIT plutôt
    // que de créer un dossier que personne ne verra jamais.
    logger.error("Aucun compte ADMIN : la tâche de calendrier ne peut être affectée", {
      year: targetYear,
    });
  }

  const { data: created, error } = await supabase
    .from("obligation_occurrences")
    .upsert(
      {
        obligation_type_id: obligation.id,
        period_key: periodKey,
        period_start: `${periodKey}-01-01`,
        period_end: `${periodKey}-12-31`,
        // Échéance au 20 janvier : le calendrier doit être à jour avant que la
        // première échéance de l'année ne tombe.
        legal_due_date: `${periodKey}-01-20`,
        internal_due_date: `${periodKey}-01-10`,
        status: "TODO",
        owner_id: owner,
      },
      { onConflict: "obligation_type_id,period_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Création de la tâche de calendrier impossible : ${error.message}`);
  }

  const report: HolidayReminderReport = {
    year: targetYear,
    created: created !== null,
    occurrenceId: created?.id ?? null,
  };

  if (report.created) {
    logger.info("Tâche de mise à jour du calendrier créée", {
      year: report.year,
      occurrenceId: report.occurrenceId,
    });
  } else {
    logger.info("Tâche de calendrier déjà présente — rien à faire", { year: targetYear });
  }

  return report;
}
