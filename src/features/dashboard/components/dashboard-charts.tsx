"use client";

import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartFrame, DataTable } from "@/features/dashboard/components/chart-frame";
import type { DashboardView } from "@/services/dashboard";

/**
 * Les quatre visualisations du tableau de bord.
 *
 * ⚠️ Les formes sont choisies AVANT les couleurs, et la couleur est choisie par
 * le travail qu'elle fait :
 *   • évolution d'une seule série  → courbe, UNE teinte, aucune légende ;
 *   • répartition par statut       → barre empilée, palette catégorielle validée ;
 *   • charge à venir               → barres, deux nuances d'UNE teinte ;
 *   • comparaison par domaine      → barres, UNE teinte pour toutes.
 *
 * ⚠️ Une seule teinte pour toutes les barres d'une comparaison, jamais un
 * dégradé « plus foncé quand c'est plus grand » : cela encoderait deux fois la
 * même information et brûlerait le seul canal libre.
 *
 * ⚠️ Aucun graphique à double axe. Deux mesures d'échelles différentes font deux
 * graphiques — l'alignement de deux échelles est arbitraire et invente une
 * corrélation absente des données.
 *
 * Les couleurs viennent des jetons `--chart-*`, validés dans les deux modes
 * (bande de clarté, chroma, séparation sous protanopie et deutéranopie,
 * contraste). Le mode sombre a ses propres pas ; ce n'est pas une inversion.
 */

const AXIS = { fontSize: 11, fill: "var(--color-text-muted)" };
const GRID = "var(--color-chart-grid)";

/** Ordre FIXE des teintes : une série garde la sienne quel que soit le filtre. */
const STATUS_COLOR: Readonly<Record<string, string>> = {
  TODO: "var(--color-chart-1)",
  IN_PROGRESS: "var(--color-chart-2)",
  PENDING_VALIDATION: "var(--color-chart-3)",
  REJECTED: "var(--color-chart-4)",
  VALIDATED: "var(--color-chart-5)",
};

function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--color-surface-raised)",
      border: "1px solid var(--color-border)",
      borderRadius: "0.5rem",
      fontSize: "12px",
      color: "var(--color-text-primary)",
    },
    labelStyle: { color: "var(--color-text-secondary)" },
    cursor: { fill: "var(--color-chart-grid)", fillOpacity: 0.35 },
  };
}

export function DashboardCharts({ view }: { readonly view: DashboardView }) {
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("occurrences.status");

  const monthLabel = (month: string): string => month.slice(0, 7);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* ── Conformité mensuelle : UNE série, donc aucune légende ─────────── */}
      <ChartFrame
        title={t("charts.compliance")}
        description={t("charts.complianceHint")}
        table={
          <DataTable
            caption={t("charts.compliance")}
            columns={[t("month"), t("due"), t("onTime"), t("rate")]}
            rows={view.monthly.map((entry) => [
              monthLabel(entry.month),
              entry.due,
              entry.onTime,
              entry.rate === null ? "—" : `${String(entry.rate)} %`,
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={view.monthly.map((entry) => ({ ...entry, label: monthLabel(entry.month) }))}
            margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
          >
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              unit="%"
              width={44}
            />
            <Tooltip
              {...tooltipStyle()}
              formatter={(value) => [`${String(value ?? "—")} %`, t("rate")]}
            />
            {/* Marque fine, points visibles ≥ 8 px : la courbe reste lisible sans
                remplir l'aire, qui suggérerait à tort un cumul. */}
            <Line
              type="monotone"
              dataKey="rate"
              name={t("rate")}
              stroke="var(--color-chart-1)"
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: "var(--color-chart-1)" }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      {/* ── Répartition par statut : légende TOUJOURS présente ────────────── */}
      <ChartFrame
        title={t("charts.statuses")}
        description={t("charts.statusesHint")}
        table={
          <DataTable
            caption={t("charts.statuses")}
            columns={[t("status"), t("count")]}
            rows={view.statuses.map((slice) => [tStatus(slice.status), slice.total])}
          />
        }
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            layout="vertical"
            data={[
              Object.fromEntries([
                ["name", t("charts.statuses")],
                ...view.statuses.map((slice) => [slice.status, slice.total] as const),
              ]),
            ]}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip {...tooltipStyle()} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "var(--color-text-secondary)" }}
              iconType="circle"
              iconSize={8}
            />
            {view.statuses.map((slice) => (
              <Bar
                key={slice.status}
                dataKey={slice.status}
                name={tStatus(slice.status)}
                stackId="statuses"
                fill={STATUS_COLOR[slice.status] ?? "var(--color-chart-8)"}
                // 2 px de surface entre les segments, jamais un contour :
                // le trait ajouterait du bruit là où un vide suffit.
                stroke="var(--color-surface)"
                strokeWidth={2}
                radius={2}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      {/* ── Charge à venir : deux nuances d'une même teinte ───────────────── */}
      <ChartFrame
        title={t("charts.upcoming")}
        description={t("charts.upcomingHint")}
        table={
          <DataTable
            caption={t("charts.upcoming")}
            columns={[t("week"), t("started"), t("notStarted")]}
            rows={view.upcoming.map((week) => [week.weekStart, week.started, week.notStarted])}
          />
        }
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={view.upcoming.map((week) => ({ ...week, label: week.weekStart.slice(5) }))}
            margin={{ top: 8, right: 12, bottom: 0, left: -22 }}
          >
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
            <Tooltip {...tooltipStyle()} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "var(--color-text-secondary)" }}
              iconType="circle"
              iconSize={8}
            />
            <Bar
              dataKey="started"
              name={t("started")}
              stackId="load"
              fill="var(--color-chart-1)"
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
            {/* Le non-démarré est la part qui doit sauter aux yeux : teinte
                d'alerte, et non une seconde teinte catégorielle. */}
            <Bar
              dataKey="notStarted"
              name={t("notStarted")}
              stackId="load"
              fill="var(--color-chart-4)"
              stroke="var(--color-surface)"
              strokeWidth={2}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      {/* ── Comparaison par domaine : UNE teinte pour toutes les barres ───── */}
      <ChartFrame
        title={t("charts.domains")}
        description={t("charts.domainsHint")}
        table={
          <DataTable
            caption={t("charts.domains")}
            columns={[t("domain"), t("open"), t("late")]}
            rows={view.domains.map((row) => [row.label, row.open, row.late])}
          />
        }
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            layout="vertical"
            data={[...view.domains]}
            margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis
              type="category"
              dataKey="label"
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={96}
            />
            <Tooltip {...tooltipStyle()} />
            {/* ⚠️ Une seule teinte, posée sur la SÉRIE et non cellule par
                cellule : un dégradé selon la valeur encoderait la longueur de la
                barre une seconde fois et brûlerait le seul canal libre. */}
            <Bar
              dataKey="open"
              name={t("open")}
              fill="var(--color-chart-1)"
              radius={[0, 4, 4, 0]}
              maxBarSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
