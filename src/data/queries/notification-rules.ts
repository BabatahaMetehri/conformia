import "server-only";

/**
 * Lectures des règles de notification et des politiques d'escalade.
 *
 * ⚠️ LECTURE SEULE, et c'est une décision. Ces règles décident QUI est alerté et
 * QUAND : une modification maladroite ne casse rien de visible — elle éteint
 * silencieusement des rappels, et le défaut ne se découvre qu'à la première
 * échéance manquée. L'écran les EXPOSE pour qu'on puisse les vérifier ; les
 * changer passe par une migration, revue et versionnée.
 *
 * Les politiques d'écriture existent en base (insert/update/delete réservés à
 * `settings.manage`) : le jour où un formulaire est justifié, la garde est déjà
 * là. Ce n'est pas le manque de droit qui retient, c'est le choix.
 */

import { mapPostgrestError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface NotificationRuleRow {
  readonly id: string;
  readonly criticality: string | null;
  readonly offsetDays: number;
  readonly channel: string;
  readonly audience: string;
  readonly templateKey: string;
  readonly isActive: boolean;
  readonly obligationTypeId: string | null;
}

export interface EscalationPolicyRow {
  readonly id: string;
  readonly criticality: string | null;
  readonly daysAfterDue: number;
  readonly notifyAudience: string | null;
  readonly isActive: boolean;
  readonly obligationTypeId: string | null;
}

export async function listNotificationRules(): Promise<Result<readonly NotificationRuleRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notification_rules")
    .select(
      "id, criticality, offset_days, channel, audience, template_key, is_active, obligation_type_id",
    )
    .order("criticality", { ascending: true, nullsFirst: true })
    .order("offset_days", { ascending: true })
    .order("channel", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      criticality: row.criticality,
      offsetDays: row.offset_days,
      channel: row.channel,
      audience: row.audience,
      templateKey: row.template_key,
      isActive: row.is_active,
      obligationTypeId: row.obligation_type_id,
    })),
  );
}

export async function listEscalationPolicies(): Promise<Result<readonly EscalationPolicyRow[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("escalation_policies")
    .select("id, criticality, days_after_due, notify_audience, is_active, obligation_type_id")
    .order("criticality", { ascending: true, nullsFirst: true })
    .order("days_after_due", { ascending: true });

  if (error !== null) return err(mapPostgrestError(error));

  return ok(
    data.map((row) => ({
      id: row.id,
      criticality: row.criticality,
      daysAfterDue: row.days_after_due,
      notifyAudience: row.notify_audience,
      isActive: row.is_active,
      obligationTypeId: row.obligation_type_id,
    })),
  );
}
