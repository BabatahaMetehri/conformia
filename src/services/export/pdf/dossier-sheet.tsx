import { Document, Page, Text, View } from "@react-pdf/renderer";

import { palette, styles } from "./theme";

/**
 * Fiche récapitulative d'un dossier — la première pièce de toute archive.
 *
 * ⚠️ Elle doit se suffire à elle-même. Un contrôleur qui reçoit l'archive n'a ni
 * l'application, ni nos identifiants, ni le contexte : la fiche porte donc
 * l'obligation, la période, les deux échéances, le statut, les intervenants ET
 * la chronologie complète. Un renvoi vers un écran serait sans valeur pour son
 * destinataire.
 */

export interface DossierSheetLabels {
  readonly title: string;
  readonly generatedAt: string;
  readonly page: (current: number, total: number) => string;
  readonly identification: string;
  readonly obligation: string;
  readonly code: string;
  readonly domain: string;
  readonly authority: string;
  readonly period: string;
  readonly legalBasis: string;
  readonly deadlines: string;
  readonly internalDue: string;
  readonly legalDue: string;
  readonly submittedAt: string;
  readonly lateDays: string;
  readonly notSubmitted: string;
  readonly status: string;
  readonly people: string;
  readonly owner: string;
  readonly validator: string;
  readonly lateReason: string;
  readonly documents: string;
  readonly documentName: string;
  readonly documentSize: string;
  readonly documentHash: string;
  readonly noDocument: string;
  readonly timeline: string;
  readonly when: string;
  readonly who: string;
  readonly what: string;
  readonly detail: string;
  readonly noTimeline: string;
  readonly rectifications: string;
  readonly onBehalfOf: (name: string) => string;
}

export interface DossierSheetDocument {
  readonly order: number;
  readonly name: string;
  readonly sizeLabel: string;
  readonly sha256: string;
}

export interface DossierSheetEvent {
  readonly at: string;
  readonly who: string;
  readonly what: string;
  readonly detail: string;
}

export interface DossierSheetData {
  readonly obligationName: string;
  readonly obligationCode: string;
  readonly domainLabel: string;
  readonly authorityName: string;
  readonly periodLabel: string;
  readonly legalBasis: string;
  readonly internalDueDate: string;
  readonly legalDueDate: string;
  readonly submittedAt: string | null;
  readonly lateDays: number | null;
  readonly statusLabel: string;
  readonly ownerName: string;
  readonly validatorName: string;
  readonly lateReason: string | null;
  readonly documents: readonly DossierSheetDocument[];
  readonly timeline: readonly DossierSheetEvent[];
  readonly rectificationCount: number;
  readonly generatedAtLabel: string;
  readonly generatedByLabel: string;
}

function Fact({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={strong ? styles.factValueStrong : styles.factValue}>{value}</Text>
    </View>
  );
}

export function DossierSheet({
  data,
  labels,
}: {
  readonly data: DossierSheetData;
  readonly labels: DossierSheetLabels;
}) {
  const late = data.lateDays !== null && data.lateDays > 0;

  return (
    <Document title={`${data.obligationCode} — ${data.periodLabel}`} author="CONFORMIA">
      <Page size="A4" style={styles.page}>
        {/* `fixed` : l'en-tête se répète sur chaque page d'une chronologie longue. */}
        <View style={styles.header} fixed>
          <Text style={styles.brand}>AGROESPACE · CONFORMIA</Text>
          <Text style={styles.headerRight}>{data.generatedAtLabel}</Text>
        </View>

        <Text style={styles.title}>{labels.title}</Text>
        <Text style={styles.subtitle}>
          {data.obligationCode} — {data.obligationName} · {data.periodLabel}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.identification.toUpperCase()}</Text>
          <View style={styles.facts}>
            <Fact label={labels.obligation} value={data.obligationName} strong />
            <Fact label={labels.code} value={data.obligationCode} />
            <Fact label={labels.domain} value={data.domainLabel} />
            <Fact label={labels.authority} value={data.authorityName} />
            <Fact label={labels.period} value={data.periodLabel} />
            <Fact label={labels.status} value={data.statusLabel} strong />
          </View>
          {data.legalBasis.length === 0 ? null : (
            <Text style={styles.note}>
              {labels.legalBasis} : {data.legalBasis}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.deadlines.toUpperCase()}</Text>
          <View style={styles.facts}>
            <Fact label={labels.internalDue} value={data.internalDueDate} />
            <Fact label={labels.legalDue} value={data.legalDueDate} strong />
            <Fact label={labels.submittedAt} value={data.submittedAt ?? labels.notSubmitted} />
            <Fact
              label={labels.lateDays}
              value={data.lateDays === null ? "—" : String(data.lateDays)}
            />
          </View>
          {/*
            Le motif de retard n'apparaît QUE s'il y a retard, et il est mis en
            évidence. Une fiche qui l'enterre au milieu des autres champs oblige
            le lecteur à le chercher — or c'est la première question qu'on pose
            devant un dossier déposé hors délai.
          */}
          {late && data.lateReason !== null ? (
            <View
              style={{
                marginTop: 4,
                padding: 6,
                backgroundColor: palette.criticalSoft,
                borderRadius: 2,
              }}
            >
              <Text style={{ fontSize: 7.5, color: palette.critical, letterSpacing: 0.5 }}>
                {labels.lateReason.toUpperCase()}
              </Text>
              <Text style={{ fontSize: 9.5, marginTop: 1 }}>{data.lateReason}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.people.toUpperCase()}</Text>
          <View style={styles.facts}>
            <Fact label={labels.owner} value={data.ownerName} />
            <Fact label={labels.validator} value={data.validatorName} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {labels.documents.toUpperCase()} ({String(data.documents.length)})
          </Text>
          {data.documents.length === 0 ? (
            <Text style={styles.empty}>{labels.noDocument}</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, { width: "48%" }]}>{labels.documentName}</Text>
                <Text style={[styles.th, { width: "14%" }]}>{labels.documentSize}</Text>
                <Text style={[styles.th, { width: "38%" }]}>{labels.documentHash}</Text>
              </View>
              {data.documents.map((document) => (
                <View key={document.sha256 + document.name} style={styles.tableRow} wrap={false}>
                  <Text style={[styles.td, { width: "48%" }]}>
                    {String(document.order).padStart(2, "0")}_{document.name}
                  </Text>
                  <Text style={[styles.tdMuted, { width: "14%" }]}>{document.sizeLabel}</Text>
                  {/*
                    Empreinte TRONQUÉE à seize caractères. Les soixante-quatre
                    entiers sont dans manifest.json, qui sert à vérifier ; la
                    fiche sert à lire, et une colonne de hachages complets rend
                    le tableau illisible sans rien prouver de plus.
                  */}
                  <Text style={[styles.tdMuted, { width: "38%" }]}>
                    {document.sha256.slice(0, 16)}…
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {data.rectificationCount === 0 ? null : (
          <Text style={styles.note}>
            {labels.rectifications} : {String(data.rectificationCount)}
          </Text>
        )}

        <View style={styles.section} break={data.timeline.length > 12}>
          <Text style={styles.sectionTitle}>{labels.timeline.toUpperCase()}</Text>
          {data.timeline.length === 0 ? (
            <Text style={styles.empty}>{labels.noTimeline}</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader} fixed>
                <Text style={[styles.th, { width: "22%" }]}>{labels.when}</Text>
                <Text style={[styles.th, { width: "26%" }]}>{labels.who}</Text>
                <Text style={[styles.th, { width: "22%" }]}>{labels.what}</Text>
                <Text style={[styles.th, { width: "30%" }]}>{labels.detail}</Text>
              </View>
              {data.timeline.map((event, index) => (
                <View key={`${event.at}-${String(index)}`} style={styles.tableRow} wrap={false}>
                  <Text style={[styles.tdMuted, { width: "22%" }]}>{event.at}</Text>
                  <Text style={[styles.td, { width: "26%" }]}>{event.who}</Text>
                  <Text style={[styles.td, { width: "22%" }]}>{event.what}</Text>
                  <Text style={[styles.tdMuted, { width: "30%" }]}>{event.detail}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>{data.generatedByLabel}</Text>
          <Text render={({ pageNumber, totalPages }) => labels.page(pageNumber, totalPages)} />
        </View>
      </Page>
    </Document>
  );
}
