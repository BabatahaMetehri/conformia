import { StyleSheet } from "@react-pdf/renderer";

/**
 * Feuille de style commune aux documents PDF.
 *
 * ⚠️ POURQUOI `@react-pdf/renderer` ET PAS AUTRE CHOSE.
 *
 * Trois candidats sérieux existaient :
 *
 *  • `pdfkit` — impératif : on positionne chaque bloc en coordonnées absolues.
 *    Un tableau de retards à hauteur variable devient alors un calcul de saut de
 *    page fait à la main, et c'est exactement le genre de code qui produit une
 *    ligne coupée en deux au bas de la page 3.
 *  • Un rendu HTML via navigateur sans interface (`puppeteer`) — fidèle, mais
 *    embarque un Chromium de 300 Mo dans l'image de production, pour produire
 *    quatre documents. Le coût d'exploitation est sans rapport avec le besoin.
 *  • `@react-pdf/renderer` — DÉCLARATIF, avec un moteur de mise en page Flexbox
 *    et une pagination automatique. On décrit la structure, la bibliothèque
 *    décide des ruptures. C'est le choix retenu, et il est nommé par le prompt.
 *
 * Le bénéfice décisif n'est pas la syntaxe familière : c'est que `wrap` et
 * `fixed` règlent les en-têtes répétés et les blocs insécables sans code. Un
 * rapport de conformité fait dix ou soixante pages selon l'exercice ; aucune des
 * deux longueurs ne doit demander d'ajustement.
 *
 * ⚠️ AUCUNE POLICE EXTERNE n'est chargée. Les polices intégrées (Helvetica) sont
 * couvertes par le standard PDF et rendues à l'identique partout. Enregistrer une
 * police de marque ferait dépendre la génération d'un fichier présent sur le
 * serveur — et un rapport qui échoue parce qu'une police manque échoue au pire
 * moment, celui où on l'imprime pour un contrôleur.
 */

export const palette = {
  ink: "#16211C",
  inkSoft: "#4A554F",
  inkFaint: "#7A857F",
  rule: "#D5DCD8",
  ruleSoft: "#EAEEEC",
  accent: "#2F5D50",
  accentSoft: "#EBF2EF",
  critical: "#9C3227",
  criticalSoft: "#F7E7E4",
  warn: "#8A6412",
  ok: "#3B6647",
} as const;

export const styles = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: palette.ink,
    lineHeight: 1.45,
  },

  // ─── En-tête et pied ───────────────────────────────────────────────────────

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: palette.ink,
    paddingBottom: 6,
    marginBottom: 16,
  },
  brand: { fontSize: 8, letterSpacing: 1.2, color: palette.accent, fontFamily: "Helvetica-Bold" },
  headerRight: { fontSize: 8, color: palette.inkFaint, textAlign: "right" },

  title: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 10, color: palette.inkSoft, marginBottom: 14 },

  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    borderTopWidth: 0.75,
    borderTopColor: palette.rule,
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: palette.inkFaint,
  },

  // ─── Sections ──────────────────────────────────────────────────────────────

  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.9,
    color: palette.accent,
    borderBottomWidth: 0.75,
    borderBottomColor: palette.rule,
    paddingBottom: 3,
    marginBottom: 7,
  },

  // ─── Couples libellé / valeur ──────────────────────────────────────────────

  facts: { flexDirection: "row", flexWrap: "wrap" },
  fact: { width: "50%", marginBottom: 6, paddingRight: 10 },
  factLabel: { fontSize: 7.5, color: palette.inkFaint, letterSpacing: 0.5 },
  factValue: { fontSize: 10 },
  factValueStrong: { fontSize: 10, fontFamily: "Helvetica-Bold" },

  // ─── Tableaux ──────────────────────────────────────────────────────────────

  table: { borderWidth: 0.75, borderColor: palette.rule, borderRadius: 2 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: palette.accentSoft,
    borderBottomWidth: 0.75,
    borderBottomColor: palette.rule,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: palette.ruleSoft,
  },
  th: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: palette.accent,
    paddingVertical: 4,
    paddingHorizontal: 5,
  },
  td: { fontSize: 8.5, paddingVertical: 3.5, paddingHorizontal: 5 },
  tdMuted: { fontSize: 8.5, paddingVertical: 3.5, paddingHorizontal: 5, color: palette.inkSoft },

  // ─── Indicateurs ───────────────────────────────────────────────────────────

  kpiRow: { flexDirection: "row", marginBottom: 14 },
  kpi: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 0.75,
    borderColor: palette.rule,
    borderRadius: 2,
    padding: 8,
    marginRight: 7,
  },
  kpiLast: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 0.75,
    borderColor: palette.rule,
    borderRadius: 2,
    padding: 8,
  },
  kpiLabel: { fontSize: 7, color: palette.inkFaint, letterSpacing: 0.5 },
  kpiValue: { fontSize: 19, fontFamily: "Helvetica-Bold", marginTop: 1 },
  kpiHint: { fontSize: 7, color: palette.inkFaint, marginTop: 1 },

  /*
   * Barres de répartition dessinées en rectangles empilés.
   *
   * ⚠️ Un graphique bitmap aurait supposé un canevas et une dépendance de plus,
   * pour un histogramme à cinq barres. Des rectangles proportionnels se lisent
   * aussi bien, restent nets à l'impression et à n'importe quel zoom, et ne
   * peuvent pas manquer au rendu.
   */
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  barLabel: { width: 150, fontSize: 8.5 },
  barTrack: { flexGrow: 1, height: 9, backgroundColor: palette.ruleSoft, borderRadius: 1 },
  barFill: { height: 9, backgroundColor: palette.accent, borderRadius: 1 },
  barValue: { width: 52, fontSize: 8.5, textAlign: "right" },

  // ─── Signature de génération ───────────────────────────────────────────────

  signature: {
    marginTop: 18,
    borderWidth: 0.75,
    borderColor: palette.rule,
    borderRadius: 2,
    padding: 8,
    backgroundColor: palette.ruleSoft,
  },
  signatureTitle: { fontSize: 7.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.6 },
  signatureLine: { fontSize: 7.5, color: palette.inkSoft, marginTop: 2 },
  hash: { fontSize: 7, color: palette.inkSoft, marginTop: 2 },

  note: { fontSize: 8, color: palette.inkSoft, marginTop: 6 },
  empty: { fontSize: 9, color: palette.inkFaint, fontStyle: "italic", paddingVertical: 8 },
});
