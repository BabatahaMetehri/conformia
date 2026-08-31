"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DATE_SHIFTS, DateShift, DueAnchor, Periodicity } from "@/config/constants";
import type { DueRuleInput } from "@/services/scheduling";

/**
 * Éditeur de règle d'échéance en CHAMPS GUIDÉS.
 *
 * ⚠️ Aucune saisie JSON brute, nulle part. Un utilisateur métier ne doit jamais
 * voir `{"anchor":"PERIOD_END","offset_days":20}` : c'est illisible, et une
 * virgule de trop produit une erreur qu'il ne peut pas diagnostiquer.
 *
 * L'interface CHANGE selon l'ancre choisie, plutôt que d'afficher tous les
 * champs en grisant les inutiles :
 *   PERIOD_END / PERIOD_START → « jours après la fin / le début de période »
 *   FIXED_DATE               → mois, jour, décalage d'année
 *   EXPIRY_DATE              → « jours avant expiration »
 *   EVENT_DATE               → « jours après le fait déclencheur »
 * Les dates fixes de CUSTOM se saisissent en liste, indépendamment de l'ancre.
 */

/** Ancres proposées, selon ce que la périodicité rend cohérent. */
function anchorsFor(periodicity: Periodicity): readonly DueAnchor[] {
  if (periodicity === Periodicity.ON_EVENT) {
    return [DueAnchor.EVENT_DATE, DueAnchor.EXPIRY_DATE];
  }
  if (periodicity === Periodicity.CUSTOM) {
    return [DueAnchor.PERIOD_END, DueAnchor.PERIOD_START];
  }
  if (periodicity === Periodicity.ANNUAL || periodicity === Periodicity.BIENNIAL) {
    return [
      DueAnchor.PERIOD_END,
      DueAnchor.PERIOD_START,
      DueAnchor.FIXED_DATE,
      DueAnchor.EXPIRY_DATE,
      DueAnchor.EVENT_DATE,
    ];
  }
  // FIXED_DATE est écarté : une date civile fixe ne se répète pas douze fois
  // par an. La retirer de la liste vaut mieux que de la faire refuser ensuite.
  return [
    DueAnchor.PERIOD_END,
    DueAnchor.PERIOD_START,
    DueAnchor.EXPIRY_DATE,
    DueAnchor.EVENT_DATE,
  ];
}

export function DueRuleEditor({
  value,
  periodicity,
  onChange,
  disabled = false,
}: {
  readonly value: DueRuleInput;
  readonly periodicity: Periodicity;
  readonly onChange: (rule: DueRuleInput) => void;
  readonly disabled?: boolean;
}) {
  const t = useTranslations("obligations.rule");
  const tAnchor = useTranslations("obligations.anchor");
  const tShift = useTranslations("obligations.shift");

  const anchors = anchorsFor(periodicity);
  const anchor = value.anchor;

  function patch(changes: Partial<DueRuleInput>): void {
    onChange({ ...value, ...changes });
  }

  /** Libellé du décalage : il DIT ce que le nombre signifie pour cette ancre. */
  const offsetLabelKey =
    anchor === DueAnchor.PERIOD_END
      ? "offsetAfterPeriodEnd"
      : anchor === DueAnchor.PERIOD_START
        ? "offsetAfterPeriodStart"
        : anchor === DueAnchor.EXPIRY_DATE
          ? "offsetBeforeExpiry"
          : "offsetAfterEvent";

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="due-anchor">{t("anchor")}</Label>
          <Select
            value={anchor}
            disabled={disabled}
            onValueChange={(next) => {
              // Changer d'ancre remet les champs propres à l'ancienne à zéro :
              // laisser `fixed_month` derrière soi produirait une règle refusée
              // par une validation que l'utilisateur ne verrait pas venir.
              const nextAnchor = next as DueAnchor;
              patch(
                nextAnchor === DueAnchor.FIXED_DATE
                  ? {
                      anchor: nextAnchor,
                      fixed_month: value.fixed_month ?? 12,
                      fixed_day: value.fixed_day ?? 31,
                      offset_days: undefined,
                    }
                  : {
                      anchor: nextAnchor,
                      offset_days: value.offset_days ?? 0,
                      fixed_month: undefined,
                      fixed_day: undefined,
                      year_offset: undefined,
                    },
              );
            }}
          >
            <SelectTrigger id="due-anchor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {anchors.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {tAnchor(candidate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-text-muted">{tAnchor(`hint.${anchor}`)}</p>
        </div>

        {anchor === DueAnchor.FIXED_DATE ? (
          <FixedDateFields value={value} disabled={disabled} onPatch={patch} />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="due-offset">{t(offsetLabelKey)}</Label>
            <Input
              id="due-offset"
              type="number"
              inputMode="numeric"
              disabled={disabled}
              value={offsetForDisplay(anchor, value.offset_days)}
              onChange={(event) => {
                const raw = Number.parseInt(event.target.value, 10);
                const parsed = Number.isNaN(raw) ? 0 : raw;
                /*
                 * « Jours AVANT expiration » se saisit en positif et se stocke en
                 * négatif. Demander à l'utilisateur de taper « -90 » pour dire
                 * « trois mois avant » est une fuite du modèle vers l'écran.
                 */
                patch({ offset_days: anchor === DueAnchor.EXPIRY_DATE ? -parsed : parsed });
              }}
            />
            <p className="text-xs text-text-muted">{t(`${offsetLabelKey}Hint`)}</p>
          </div>
        )}
      </div>

      {periodicity === Periodicity.CUSTOM ? (
        <CustomDatesFields value={value} disabled={disabled} onPatch={patch} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <ShiftField
          id="weekend-shift"
          label={t("weekendShift")}
          hint={t("weekendShiftHint")}
          value={value.weekend_shift ?? DateShift.NEXT_BUSINESS_DAY}
          disabled={disabled}
          onChange={(next) => {
            patch({ weekend_shift: next });
          }}
          labelFor={(shift) => tShift(shift)}
        />
        <ShiftField
          id="holiday-shift"
          label={t("holidayShift")}
          hint={t("holidayShiftHint")}
          value={value.holiday_shift ?? DateShift.NEXT_BUSINESS_DAY}
          disabled={disabled}
          onChange={(next) => {
            patch({ holiday_shift: next });
          }}
          labelFor={(shift) => tShift(shift)}
        />
      </div>
    </div>
  );
}

/** Positif à l'écran pour EXPIRY_DATE, négatif en base. */
function offsetForDisplay(anchor: DueAnchor, offset: number | undefined): number {
  const value = offset ?? 0;
  return anchor === DueAnchor.EXPIRY_DATE ? Math.abs(value) : value;
}

function FixedDateFields({
  value,
  disabled,
  onPatch,
}: {
  readonly value: DueRuleInput;
  readonly disabled: boolean;
  readonly onPatch: (changes: Partial<DueRuleInput>) => void;
}) {
  const t = useTranslations("obligations.rule");

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="fixed-month">{t("fixedMonth")}</Label>
        <Input
          id="fixed-month"
          type="number"
          min={1}
          max={12}
          disabled={disabled}
          value={value.fixed_month ?? 12}
          onChange={(event) => {
            onPatch({ fixed_month: Number.parseInt(event.target.value, 10) || 1 });
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fixed-day">{t("fixedDay")}</Label>
        <Input
          id="fixed-day"
          type="number"
          min={1}
          max={31}
          disabled={disabled}
          value={value.fixed_day ?? 31}
          onChange={(event) => {
            onPatch({ fixed_day: Number.parseInt(event.target.value, 10) || 1 });
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="year-offset">{t("yearOffset")}</Label>
        <Input
          id="year-offset"
          type="number"
          min={-1}
          max={3}
          disabled={disabled}
          value={value.year_offset ?? 0}
          onChange={(event) => {
            onPatch({ year_offset: Number.parseInt(event.target.value, 10) || 0 });
          }}
        />
      </div>
      <p className="col-span-3 text-xs text-text-muted">{t("yearOffsetHint")}</p>
    </div>
  );
}

function CustomDatesFields({
  value,
  disabled,
  onPatch,
}: {
  readonly value: DueRuleInput;
  readonly disabled: boolean;
  readonly onPatch: (changes: Partial<DueRuleInput>) => void;
}) {
  const t = useTranslations("obligations.rule");
  const occurrences = value.occurrences ?? [];

  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-text-primary">{t("customDates")}</legend>
      <p className="text-xs text-text-muted">{t("customDatesHint")}</p>

      {occurrences.length === 0 ? (
        <p className="py-2 text-sm text-text-muted">{t("customDatesEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {occurrences.map((occurrence, index) => (
            // Position stable : les dates n'ont pas d'identifiant, et réordonner
            // n'est pas proposé ici — la liste se lit dans l'ordre de saisie.
            <li key={`custom-${String(index)}`} className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`custom-month-${String(index)}`} className="text-xs">
                  {t("fixedMonth")}
                </Label>
                <Input
                  id={`custom-month-${String(index)}`}
                  type="number"
                  min={1}
                  max={12}
                  className="w-20"
                  disabled={disabled}
                  value={occurrence.month}
                  onChange={(event) => {
                    onPatch({
                      occurrences: occurrences.map((item, position) =>
                        position === index
                          ? { ...item, month: Number.parseInt(event.target.value, 10) || 1 }
                          : item,
                      ),
                    });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`custom-day-${String(index)}`} className="text-xs">
                  {t("fixedDay")}
                </Label>
                <Input
                  id={`custom-day-${String(index)}`}
                  type="number"
                  min={1}
                  max={31}
                  className="w-20"
                  disabled={disabled}
                  value={occurrence.day}
                  onChange={(event) => {
                    onPatch({
                      occurrences: occurrences.map((item, position) =>
                        position === index
                          ? { ...item, day: Number.parseInt(event.target.value, 10) || 1 }
                          : item,
                      ),
                    });
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={t("removeCustomDate", { index: index + 1 })}
                onClick={() => {
                  onPatch({
                    occurrences: occurrences.filter((_, position) => position !== index),
                  });
                }}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          onPatch({ occurrences: [...occurrences, { month: 1, day: 31 }] });
        }}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("addCustomDate")}
      </Button>
    </fieldset>
  );
}

function ShiftField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
  labelFor,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: DateShift;
  readonly disabled: boolean;
  readonly onChange: (shift: DateShift) => void;
  readonly labelFor: (shift: DateShift) => string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          onChange(next as DateShift);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_SHIFTS.map((shift) => (
            <SelectItem key={shift} value={shift}>
              {labelFor(shift)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-text-muted">{hint}</p>
    </div>
  );
}
