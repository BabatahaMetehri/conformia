"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { ErrorState, LoadingState } from "@/components/shared/states";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  loadPreferencesAction,
  savePreferenceAction,
} from "@/features/notifications/actions/inbox";
import type { ChannelPreference } from "@/features/notifications/actions/types";
import { useActionRunner } from "@/hooks/use-action-runner";

const DIGEST_VALUES = ["NONE", "DAILY", "WEEKLY"] as const;

/**
 * Préférences par canal.
 *
 * ⚠️ Le texte d'introduction dit ce que ces réglages NE coupent PAS : une
 * demande de validation et un rejet arrivent quoi qu'il arrive. Sans cette
 * phrase, un utilisateur qui désactive le canal in-app croirait avoir tout
 * éteint, et tiendrait le premier message reçu pour un défaut.
 *
 * ⚠️ Le canal SMS est affiché DÉSACTIVÉ plutôt que masqué. Le masquer laisserait
 * croire qu'il n'existe pas ; l'afficher inerte dit qu'il existe et qu'il n'est
 * pas ouvert — ce qui est exactement l'état des choses.
 */
export function PreferencesForm() {
  const t = useTranslations();
  const groupId = useId();
  const [preferences, setPreferences] = useState<readonly ChannelPreference[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, run] = useActionRunner();

  useEffect(() => {
    void loadPreferencesAction().then((outcome) => {
      if (outcome.status === "success") setPreferences(outcome.data);
      else setFailed(true);
    });
  }, []);

  const save = (next: ChannelPreference) => {
    run(async () => {
      const outcome = await savePreferenceAction(next);
      if (outcome.status === "success") {
        setPreferences(outcome.data);
        toast.success(t("notifications.preferences.saved"));
        return;
      }
      toast.error(t("notifications.errors.updateFailed"));
    });
  };

  if (failed) return <ErrorState title={t("notifications.errors.loadFailed")} />;
  if (preferences === null) return <LoadingState label={t("common.states.loading")} rows={3} />;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-text-primary">
        {t("notifications.preferences.title")}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-secondary">
        {t("notifications.preferences.description")}
      </p>

      <ul className="mt-4 flex flex-col gap-4">
        {preferences.map((preference) => {
          const unavailable = preference.channel === "SMS";
          const switchId = `${groupId}-${preference.channel}-enabled`;
          const selectId = `${groupId}-${preference.channel}-digest`;
          const channelLabel = t(`notifications.channel.${preference.channel}`);

          return (
            <li
              key={preference.channel}
              className="flex flex-wrap items-center gap-4 border-b border-border pb-4 last:border-b-0 last:pb-0"
            >
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium text-text-primary">{channelLabel}</p>
                {unavailable ? (
                  <p className="text-xs text-text-secondary">
                    {t("notifications.preferences.smsUnavailable")}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id={switchId}
                  checked={preference.isEnabled && !unavailable}
                  disabled={unavailable || pending}
                  onCheckedChange={(checked) => {
                    save({ ...preference, isEnabled: checked });
                  }}
                />
                <Label htmlFor={switchId}>{t("notifications.preferences.enabled")}</Label>
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor={selectId}>{t("notifications.preferences.digestLabel")}</Label>
                <Select
                  value={preference.digestFrequency}
                  disabled={unavailable || pending}
                  onValueChange={(value) => {
                    save({
                      ...preference,
                      digestFrequency: value as ChannelPreference["digestFrequency"],
                    });
                  }}
                >
                  {/* Un déclencheur de liste sans nom accessible est annoncé
                      « bouton, liste » : le libellé visible ne lui est pas
                      rattaché automatiquement. */}
                  <SelectTrigger
                    id={selectId}
                    className="w-40"
                    aria-label={t("notifications.preferences.channelLabel", {
                      channel: channelLabel,
                    })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIGEST_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`notifications.preferences.digest.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
