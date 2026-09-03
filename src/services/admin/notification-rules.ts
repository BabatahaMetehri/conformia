import "server-only";

/**
 * Règles de notification et politiques d'escalade — exposition en lecture.
 *
 * Tient la frontière de couches : l'interface n'atteint jamais `data/`
 * directement (CLAUDE.md §3.1).
 */

import {
  listEscalationPolicies,
  listNotificationRules,
  type EscalationPolicyRow,
  type NotificationRuleRow,
} from "@/data/queries/notification-rules";
import type { Result } from "@/lib/result";

export type { EscalationPolicyRow, NotificationRuleRow };

export async function getNotificationRules(): Promise<Result<readonly NotificationRuleRow[]>> {
  return listNotificationRules();
}

export async function getEscalationPolicies(): Promise<Result<readonly EscalationPolicyRow[]>> {
  return listEscalationPolicies();
}
