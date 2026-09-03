import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import type { EscalationPolicyRow, NotificationRuleRow } from "@/services/admin/notification-rules";

/**
 * Règles de notification et politiques d'escalade — en lecture.
 *
 * ⚠️ POURQUOI ON LES MONTRE PLUTÔT QUE DE LES LAISSER EN BASE.
 *
 * Ces règles décident qui est alerté et quand. Quand une alerte n'arrive pas,
 * la première question est « la règle existe-t-elle ? » — et sans cet écran,
 * y répondre demande un accès à la base, c'est-à-dire un administrateur
 * technique, c'est-à-dire un délai. Ici, la personne qui constate l'absence
 * peut vérifier elle-même.
 *
 * ⚠️ POURQUOI ON NE LES MODIFIE PAS ICI. Une règle éteinte par mégarde ne casse
 * rien de visible : elle supprime des rappels, et le défaut ne se découvre qu'à
 * la première échéance manquée. Le changement passe donc par une migration,
 * revue et versionnée — pas par un clic.
 */

/** Un décalage négatif est un rappel AVANT échéance ; positif, une relance après. */
function OffsetBadge({ days, label }: { readonly days: number; readonly label: string }) {
  return (
    <span className={days < 0 ? "text-text-secondary" : "text-due-soon"} data-numeric>
      {label}
    </span>
  );
}

export async function NotificationRulesView({
  rules,
  policies,
}: {
  readonly rules: readonly NotificationRuleRow[];
  readonly policies: readonly EscalationPolicyRow[];
}) {
  const t = await getTranslations("admin.notificationRules");

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">
        {t("intro")}
      </p>

      <section aria-labelledby="rules-title">
        <h2 id="rules-title" className="mb-2 text-sm font-medium text-text-primary">
          {t("rulesTitle")}
        </h2>
        <p className="mb-3 text-xs text-text-muted">{t("rulesHint")}</p>

        {rules.length === 0 ? (
          <EmptyState title={t("noRules")} description={t("noRulesHint")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">{t("rulesTitle")}</caption>
              <thead className="bg-surface-muted text-xs text-text-secondary">
                <tr>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.when")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.channel")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.audience")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.criticality")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.state")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-border">
                    <td className="p-2">
                      <OffsetBadge
                        days={rule.offsetDays}
                        label={
                          rule.offsetDays < 0
                            ? t("beforeDue", { days: Math.abs(rule.offsetDays) })
                            : t("afterDue", { days: rule.offsetDays })
                        }
                      />
                    </td>
                    <td className="p-2 text-text-secondary">{t(`channel.${rule.channel}`)}</td>
                    <td className="p-2 text-text-secondary">{t(`audience.${rule.audience}`)}</td>
                    <td className="p-2 text-text-secondary">
                      {/* `null` = s'applique à TOUTES les criticités. Afficher
                          « — » laisserait croire à une règle sans portée. */}
                      {rule.criticality === null
                        ? t("allCriticalities")
                        : t(`criticality.${rule.criticality}`)}
                    </td>
                    <td className="p-2">
                      <Badge variant={rule.isActive ? "secondary" : "outline"}>
                        {rule.isActive ? t("active") : t("inactive")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="escalation-title">
        <h2 id="escalation-title" className="mb-2 text-sm font-medium text-text-primary">
          {t("escalationTitle")}
        </h2>
        <p className="mb-3 text-xs text-text-muted">{t("escalationHint")}</p>

        {policies.length === 0 ? (
          <EmptyState title={t("noPolicies")} description={t("noPoliciesHint")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">{t("escalationTitle")}</caption>
              <thead className="bg-surface-muted text-xs text-text-secondary">
                <tr>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.delay")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.notified")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.criticality")}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t("columns.state")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id} className="border-t border-border">
                    <td className="p-2" data-numeric>
                      {policy.daysAfterDue === 0
                        ? t("sameDay")
                        : t("afterDue", { days: policy.daysAfterDue })}
                    </td>
                    <td className="p-2 text-text-secondary">
                      {policy.notifyAudience === null
                        ? t("audience.OWNER")
                        : t(`audience.${policy.notifyAudience}`)}
                    </td>
                    <td className="p-2 text-text-secondary">
                      {policy.criticality === null
                        ? t("allCriticalities")
                        : t(`criticality.${policy.criticality}`)}
                    </td>
                    <td className="p-2">
                      <Badge variant={policy.isActive ? "secondary" : "outline"}>
                        {policy.isActive ? t("active") : t("inactive")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
