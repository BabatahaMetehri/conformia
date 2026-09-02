"use client";

import { Copy, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { regenerateCalendarTokenAction } from "@/features/notifications/actions/inbox";

/**
 * Abonnement iCalendar : adresse, copie, rotation, mode d'emploi.
 *
 * ⚠️ L'adresse est affichée EN CLAIR, et l'avertissement l'accompagne. Elle vaut
 * mot de passe — qui la détient voit les échéances de son porteur. La masquer
 * derrière des astérisques n'y changerait rien, puisqu'il faut bien la copier
 * pour s'en servir : mieux vaut la montrer et dire ce qu'elle est.
 *
 * ⚠️ La régénération passe par une CONFIRMATION. Elle casse silencieusement tout
 * abonnement existant : l'agenda ne signale pas qu'un flux a cessé de répondre,
 * il cesse simplement de se mettre à jour — et l'on s'en aperçoit à la première
 * échéance manquée.
 */
export function CalendarFeedCard({
  initialUrl,
  rotatedAt,
}: {
  readonly initialUrl: string;
  readonly rotatedAt: string | null;
}) {
  const t = useTranslations();
  const [url, setUrl] = useState(initialUrl);
  const [pending, startTransition] = useTransition();

  const copy = () => {
    void navigator.clipboard.writeText(url).then(
      () => {
        toast.success(t("calendar.page.copied"));
      },
      () => {
        // Le presse-papiers peut être refusé (contexte non sécurisé, permission
        // navigateur). On le dit, plutôt que de laisser croire à une copie.
        toast.error(t("notifications.errors.updateFailed"));
      },
    );
  };

  const regenerate = () => {
    startTransition(() => {
      void regenerateCalendarTokenAction().then((outcome) => {
        if (outcome.status === "success") {
          setUrl(outcome.data.url);
          toast.success(t("calendar.page.regenerated"));
        } else {
          toast.error(t("notifications.errors.updateFailed"));
        }
      });
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="max-w-prose text-sm text-text-secondary">{t("calendar.page.intro")}</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="calendar-feed-url">{t("calendar.page.urlLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="calendar-feed-url"
            value={url}
            readOnly
            // Sélection immédiate au clic : l'adresse est longue, et la copier
            // à la main est une source d'erreur silencieuse.
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="min-w-64 flex-1 font-mono text-xs"
          />
          <Button variant="outline" onClick={copy}>
            <Copy aria-hidden="true" className="size-4" />
            {t("calendar.page.copy")}
          </Button>
        </div>
      </div>

      <p
        // `role="note"` : l'avertissement compte autant que l'adresse, mais il
        // n'est pas une alerte — il ne survient pas, il accompagne.
        role="note"
        className="border-status-warning/40 bg-status-warning-bg rounded-md border px-3 py-2 text-sm text-text-primary"
      >
        {t("calendar.page.secretWarning")}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <ConfirmDialog
          title={t("calendar.page.regenerate")}
          description={t("calendar.page.regenerateHint")}
          confirmLabel={t("calendar.page.regenerate")}
          onConfirm={regenerate}
          trigger={
            <Button variant="outline" disabled={pending}>
              <RefreshCw aria-hidden="true" className="size-4" />
              {t("calendar.page.regenerate")}
            </Button>
          }
        />
        {rotatedAt === null ? null : (
          <p className="text-xs text-text-secondary">
            {t("calendar.page.rotatedAt", { date: rotatedAt })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-4">
        <h2 className="text-sm font-medium text-text-primary">{t("calendar.page.howTo")}</h2>
        <p className="text-sm text-text-secondary">{t("calendar.page.outlook")}</p>
        <p className="text-sm text-text-secondary">{t("calendar.page.google")}</p>
        <p className="mt-1 text-xs text-text-secondary">{t("calendar.page.refreshNote")}</p>
      </div>
    </section>
  );
}
