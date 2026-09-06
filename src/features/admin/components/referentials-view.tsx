"use client";

import { CalendarPlus, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HolidayImportOutcome } from "@/features/admin/actions/types";
import {
  HolidayImpactDialog,
  type HolidayIntent,
} from "@/features/admin/components/holiday-impact-dialog";
import { formatDateFr } from "@/lib/dates";
import type { HolidayRow, Referentials } from "@/services/admin";

/**
 * Référentiels : organismes, domaines, services, jours fériés.
 *
 * ⚠️ Les trois premiers sont en LECTURE SEULE ici. Un organisme ou un domaine
 * renommé traverse tout le référentiel d'obligations et toutes les occurrences
 * déjà générées : ce n'est pas un geste d'écran, c'est une migration.
 *
 * ⚠️ Les JOURS FÉRIÉS, eux, se saisissent — et chaque saisie déplace des
 * échéances. Les fêtes CIVILES à date fixe sont déjà présentes, récurrentes. Les
 * fêtes RELIGIEUSES suivent le calendrier hégirien et sont fixées par décret :
 * elles se saisissent à la main chaque année, et le système se le rappelle
 * lui-même par une occurrence de maintenance créée chaque 1er décembre.
 */
export function ReferentialsView({
  holidays,
  referentials,
  canManage,
  currentYear,
}: {
  readonly holidays: readonly HolidayRow[];
  readonly referentials: Referentials;
  readonly canManage: boolean;
  readonly currentYear: number;
}) {
  const t = useTranslations("admin.referentials");

  const [form, setForm] = useState({ date: "", label: "", isRecurring: false });

  /*
   * ⚠️ AUCUNE DES TROIS ACTIONS N'EST APPLIQUÉE DIRECTEMENT. Elles passent par
   * une intention, que la fenêtre de confirmation chiffre avant d'exécuter :
   * ajouter, importer ou retirer un jour chômé déplace des échéances que des
   * gens ont notées ailleurs, et le nombre doit être connu pendant qu'il est
   * encore possible de renoncer.
   */
  const [intent, setIntent] = useState<HolidayIntent | null>(null);

  function report(outcome: HolidayImportOutcome) {
    if (outcome.status !== "success") return;
    const data = outcome.data;

    if (data.rejectedLines.length > 0) {
      // ⚠️ Les lignes rejetées sont MONTRÉES : un import qui avale la moitié
      // d'un fichier en silence produit un calendrier faux que personne ne
      // saura faux.
      toast.error(t("importRejected", { count: data.rejectedLines.length }), {
        description: data.rejectedLines.slice(0, 10).join(", "),
      });
    }
    toast.success(t("saved", { count: data.imported, moved: data.recalculated }));
    setForm({ date: "", label: "", isRecurring: false });
  }

  function submit(): void {
    setIntent({ kind: "save", holiday: form });
  }

  function importCsv(file: File): void {
    void file.text().then((content) => {
      setIntent({ kind: "import", content });
    });
  }

  function remove(holiday: HolidayRow): void {
    setIntent({ kind: "delete", holidayId: holiday.id, label: holiday.label });
  }

  return (
    <div className="space-y-6">
      <HolidayImpactDialog
        intent={intent}
        onOpenChange={(open) => {
          if (!open) setIntent(null);
        }}
        onApplied={report}
      />

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">{t("holidaysTitle")}</h2>
        <p className="mt-0.5 mb-3 text-xs text-text-muted">{t("holidaysHint")}</p>

        {canManage ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date">{t("date")}</Label>
              <Input
                id="holiday-date"
                type="date"
                value={form.date}
                onChange={(event) => {
                  setForm({ ...form, date: event.target.value });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-label">{t("label")}</Label>
              <Input
                id="holiday-label"
                value={form.label}
                onChange={(event) => {
                  setForm({ ...form, label: event.target.value });
                }}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-text-secondary">
              <Checkbox
                checked={form.isRecurring}
                onCheckedChange={(checked) => {
                  setForm({ ...form, isRecurring: checked === true });
                }}
              />
              {t("recurring")}
            </label>
            <div className="flex gap-2 pb-0.5">
              <Button
                size="sm"
                disabled={intent !== null || form.date === "" || form.label.trim().length === 0}
                onClick={submit}
              >
                <CalendarPlus aria-hidden="true" className="size-4" />
                {t("add")}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <label className="cursor-pointer">
                  <Upload aria-hidden="true" className="size-4" />
                  {t("import")}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file !== undefined) importCsv(file);
                      event.target.value = "";
                    }}
                  />
                </label>
              </Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <Th>{t("date")}</Th>
                <Th>{t("label")}</Th>
                <Th>{t("kind")}</Th>
                <Th>{t("source")}</Th>
                <Th>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((holiday) => (
                <tr key={holiday.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-text-primary" data-numeric>
                    {formatDateFr(new Date(`${holiday.date}T12:00:00Z`))}
                  </td>
                  <td className="px-3 py-2 text-text-primary">{holiday.label}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">
                      {holiday.isRecurring ? t("recurringYes") : t("recurringNo")}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{holiday.source ?? "—"}</td>
                  <td className="px-3 py-2">
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={intent !== null}
                        aria-label={t("remove", { label: holiday.label })}
                        onClick={() => {
                          remove(holiday);
                        }}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-text-muted">
                    {t("noHoliday", { year: currentYear })}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-text-muted">{t("csvFormat")}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReadOnlyList
          title={t("authorities")}
          rows={referentials.authorities}
          hint={t("readOnly")}
        />
        <ReadOnlyList title={t("domains")} rows={referentials.domains} hint={t("readOnly")} />
        <ReadOnlyList
          title={t("departments")}
          rows={referentials.departments}
          hint={t("readOnly")}
        />
      </div>
    </div>
  );
}

function ReadOnlyList({
  title,
  rows,
  hint,
}: {
  readonly title: string;
  readonly rows: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly hint: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <p className="mt-0.5 mb-2 text-xs text-text-muted">{hint}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.id} className="flex items-baseline gap-2 text-sm">
            <span className="text-xs text-text-muted" data-numeric>
              {row.code}
            </span>
            <span className="text-text-primary">{row.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-start text-xs font-medium tracking-wide text-text-muted uppercase">
      {children}
    </th>
  );
}
