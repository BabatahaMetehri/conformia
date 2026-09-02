import { Document, Page, Text, View } from "@react-pdf/renderer";

import { palette, styles } from "./theme";

/**
 * Rapport de conformité — le document qu'on pose sur une table.
 *
 * ⚠️ Il porte une SIGNATURE DE GÉNÉRATION : auteur, date, périmètre, et
 * l'empreinte des données agrégées. Sans elle, deux exemplaires du même rapport
 * tirés à deux semaines d'écart sont indiscernables, et personne ne peut dire
 * lequel a servi de base à une décision. L'empreinte ne protège pas d'une
 * falsification — elle identifie une version, ce qui est le besoin réel.
 */

export interface ReportLabels {
  readonly title: string;
  readonly subtitle: (from: string, to: string) => string;
  readonly page: (current: number, total: number) => string;
  readonly summary: string;
  readonly totalOccurrences: string;
  readonly submitted: string;
  readonly onTimeRate: string;
  readonly lateCount: string;
  readonly pendingCount: string;
  readonly ofSubmitted: string;
  readonly byObligation: string;
  readonly code: string;
  readonly obligation: string;
  readonly total: string;
  readonly onTime: string;
  readonly late: string;
  readonly pending: string;
  readonly rate: string;
  readonly lateList: string;
  readonly period: string;
  readonly dueDate: string;
  readonly days: string;
  readonly reason: string;
  readonly owner: string;
  readonly noLate: string;
  readonly causes: string;
  readonly noCause: string;
  readonly signature: string;
  readonly generatedBy: string;
  readonly generatedAt: string;
  readonly scope: string;
  readonly fingerprint: string;
  readonly fingerprintNote: string;
  readonly andMore: (count: number) => string;
}

export interface ReportComplianceLine {
  readonly code: string;
  readonly name: string;
  readonly total: number;
  readonly onTime: number;
  readonly late: number;
  readonly pending: number;
  readonly rate: number | null;
}

export interface ReportLateLine {
  readonly code: string;
  readonly name: string;
  readonly period: string;
  readonly dueDate: string;
  readonly days: number;
  readonly reason: string;
  readonly owner: string;
}

export interface ReportCauseLine {
  readonly label: string;
  readonly count: number;
  readonly share: number;
}

export interface ReportData {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly totalOccurrences: number;
  readonly submitted: number;
  readonly onTime: number;
  readonly late: number;
  readonly pending: number;
  readonly onTimeRate: number | null;
  readonly byObligation: readonly ReportComplianceLine[];
  readonly lateLines: readonly ReportLateLine[];
  readonly lateHidden: number;
  readonly causes: readonly ReportCauseLine[];
  readonly generatedBy: string;
  readonly generatedAtLabel: string;
  readonly scopeLabel: string;
  readonly fingerprint: string;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)} %`;
}

function Kpi({
  label,
  value,
  hint,
  last = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly last?: boolean;
}) {
  return (
    <View style={last ? styles.kpiLast : styles.kpi}>
      <Text style={styles.kpiLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {hint === undefined ? null : <Text style={styles.kpiHint}>{hint}</Text>}
    </View>
  );
}

export function ComplianceReport({
  data,
  labels,
}: {
  readonly data: ReportData;
  readonly labels: ReportLabels;
}) {
  const maxCause = data.causes.reduce((peak, cause) => Math.max(peak, cause.count), 0);

  return (
    <Document title={labels.title} author="CONFORMIA" subject={data.scopeLabel}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.brand}>AGROESPACE · CONFORMIA</Text>
          <Text style={styles.headerRight}>{data.generatedAtLabel}</Text>
        </View>

        <Text style={styles.title}>{labels.title}</Text>
        <Text style={styles.subtitle}>{labels.subtitle(data.fromLabel, data.toLabel)}</Text>

        {/* ── Synthèse ─────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{labels.summary.toUpperCase()}</Text>
        <View style={styles.kpiRow}>
          <Kpi label={labels.totalOccurrences} value={String(data.totalOccurrences)} />
          <Kpi
            label={labels.submitted}
            value={String(data.submitted)}
            hint={`${String(data.pending)} ${labels.pending.toLowerCase()}`}
          />
          <Kpi
            label={labels.onTimeRate}
            value={percent(data.onTimeRate)}
            hint={labels.ofSubmitted}
          />
          <Kpi label={labels.lateCount} value={String(data.late)} last />
        </View>

        {/* ── Conformité par obligation ────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.byObligation.toUpperCase()}</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader} fixed>
              <Text style={[styles.th, { width: "14%" }]}>{labels.code}</Text>
              <Text style={[styles.th, { width: "38%" }]}>{labels.obligation}</Text>
              <Text style={[styles.th, { width: "10%" }]}>{labels.total}</Text>
              <Text style={[styles.th, { width: "10%" }]}>{labels.onTime}</Text>
              <Text style={[styles.th, { width: "10%" }]}>{labels.late}</Text>
              <Text style={[styles.th, { width: "8%" }]}>{labels.pending}</Text>
              <Text style={[styles.th, { width: "10%" }]}>{labels.rate}</Text>
            </View>
            {data.byObligation.map((line) => (
              <View key={line.code} style={styles.tableRow} wrap={false}>
                <Text style={[styles.td, { width: "14%" }]}>{line.code}</Text>
                <Text style={[styles.td, { width: "38%" }]}>{line.name}</Text>
                <Text style={[styles.tdMuted, { width: "10%" }]}>{String(line.total)}</Text>
                <Text style={[styles.tdMuted, { width: "10%" }]}>{String(line.onTime)}</Text>
                <Text
                  style={[
                    styles.td,
                    { width: "10%", color: line.late > 0 ? palette.critical : palette.inkSoft },
                  ]}
                >
                  {String(line.late)}
                </Text>
                <Text style={[styles.tdMuted, { width: "8%" }]}>{String(line.pending)}</Text>
                <Text style={[styles.td, { width: "10%" }]}>{percent(line.rate)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Retards, avec leurs motifs ───────────────────────────────── */}
        <View style={styles.section} break>
          <Text style={styles.sectionTitle}>{labels.lateList.toUpperCase()}</Text>
          {data.lateLines.length === 0 ? (
            <Text style={styles.empty}>{labels.noLate}</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader} fixed>
                <Text style={[styles.th, { width: "13%" }]}>{labels.code}</Text>
                <Text style={[styles.th, { width: "12%" }]}>{labels.period}</Text>
                <Text style={[styles.th, { width: "13%" }]}>{labels.dueDate}</Text>
                <Text style={[styles.th, { width: "8%" }]}>{labels.days}</Text>
                <Text style={[styles.th, { width: "26%" }]}>{labels.reason}</Text>
                <Text style={[styles.th, { width: "28%" }]}>{labels.owner}</Text>
              </View>
              {data.lateLines.map((line, index) => (
                <View
                  key={`${line.code}-${line.period}-${String(index)}`}
                  style={styles.tableRow}
                  wrap={false}
                >
                  <Text style={[styles.td, { width: "13%" }]}>{line.code}</Text>
                  <Text style={[styles.tdMuted, { width: "12%" }]}>{line.period}</Text>
                  <Text style={[styles.tdMuted, { width: "13%" }]}>{line.dueDate}</Text>
                  <Text style={[styles.td, { width: "8%", color: palette.critical }]}>
                    {String(line.days)}
                  </Text>
                  <Text style={[styles.td, { width: "26%" }]}>{line.reason}</Text>
                  <Text style={[styles.tdMuted, { width: "28%" }]}>{line.owner}</Text>
                </View>
              ))}
            </View>
          )}
          {data.lateHidden > 0 ? (
            <Text style={styles.note}>{labels.andMore(data.lateHidden)}</Text>
          ) : null}
        </View>

        {/* ── Répartition des causes ───────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.causes.toUpperCase()}</Text>
          {data.causes.length === 0 ? (
            <Text style={styles.empty}>{labels.noCause}</Text>
          ) : (
            data.causes.map((cause) => (
              <View key={cause.label} style={styles.barRow} wrap={false}>
                <Text style={styles.barLabel}>{cause.label}</Text>
                <View style={styles.barTrack}>
                  {/*
                    Largeur proportionnelle au PLUS GRAND, pas au total : sur cinq
                    causes équilibrées, une échelle sur le total donnerait cinq
                    barres courtes et illisibles.
                  */}
                  <View
                    style={[
                      styles.barFill,
                      { width: `${String(maxCause === 0 ? 0 : (cause.count / maxCause) * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.barValue}>
                  {String(cause.count)} · {(cause.share * 100).toFixed(0)} %
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ── Signature de génération ──────────────────────────────────── */}
        <View style={styles.signature} wrap={false}>
          <Text style={styles.signatureTitle}>{labels.signature.toUpperCase()}</Text>
          <Text style={styles.signatureLine}>
            {labels.generatedBy} : {data.generatedBy}
          </Text>
          <Text style={styles.signatureLine}>
            {labels.generatedAt} : {data.generatedAtLabel}
          </Text>
          <Text style={styles.signatureLine}>
            {labels.scope} : {data.scopeLabel}
          </Text>
          <Text style={styles.hash}>
            {labels.fingerprint} : {data.fingerprint}
          </Text>
          <Text style={styles.hash}>{labels.fingerprintNote}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{data.generatedBy}</Text>
          <Text render={({ pageNumber, totalPages }) => labels.page(pageNumber, totalPages)} />
        </View>
      </Page>
    </Document>
  );
}
