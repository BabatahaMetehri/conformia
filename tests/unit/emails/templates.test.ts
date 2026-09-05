import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isTemplateKey,
  renderEmail,
  TEMPLATE_KEYS,
  type EmailPayload,
  type TemplateKey,
} from "@/emails";

/**
 * RENDU DE TOUS LES GABARITS.
 *
 * ⚠️ AUCUN N'ÉTAIT RENDU PAR UN TEST. Un gabarit qui casse ne fait échouer ni la
 * compilation ni le build : il est rendu à l'exécution, dans une tâche horaire,
 * pour une alerte qui ne partira jamais. Le planificateur attrape l'exception et
 * la consigne — `scheduler.ts` le fait délibérément, pour qu'un gabarit fautif
 * n'emporte pas le cycle. Personne ne lit ce journal. L'échéance passe.
 *
 * ⚠️ LE TEST LE PLUS IMPORTANT DE CE FICHIER VÉRIFIE UNE ABSENCE. Un courriel de
 * conformité sort de l'entreprise, transite par des serveurs qu'on ne maîtrise
 * pas, et reste des années dans des boîtes qu'on ne maîtrise pas davantage. Il
 * ne doit porter ni montant, ni nom de document, ni numéro de référence. Cette
 * discipline ne tient que si elle est VÉRIFIÉE : elle est invisible à la
 * relecture — on ne remarque pas ce qui n'est pas là — et un ajout bien
 * intentionné (« mettons le nom du fichier, ce sera plus clair ») passerait
 * toutes les autres revues.
 */

// ─── Jeu d'essai ─────────────────────────────────────────────────────────────

/** Valeurs sentinelles : si l'une d'elles atteint un courriel, on le saura. */
const SECRET = {
  documentName: "bilan-fiscal-2026-CONFIDENTIEL.pdf",
  amount: "1250000,00 DA",
  reference: "REF-DGI-99887766",
  detailedReason: "Le montant declare ne correspond pas au grand livre du mois",
} as const;

const FACTS = {
  obligationName: "Declaration mensuelle G50",
  obligationCode: "G50",
  periodLabel: "2026-01",
  internalDueDate: "13/02/2026",
  legalDueDate: "20/02/2026",
  authorityName: "Direction generale des impots",
  occurrenceUrl: "https://conformia.agroespace.dz/fr/echeancier/abc-123",
} as const;

const BASE_URL = "https://conformia.agroespace.dz";

const PAYLOADS: Readonly<Record<TemplateKey, EmailPayload>> = {
  UpcomingDeadline: { template: "UpcomingDeadline", daysBefore: 7, ...FACTS },
  OverdueAlert: { template: "OverdueAlert", daysAfter: 3, ...FACTS },
  ValidationRequested: { template: "ValidationRequested", ...FACTS },
  /*
   * ⚠️ LE MOTIF PORTE LA SENTINELLE, délibérément. C'est la seule exception
   * arrêtée à la règle « rien du contenu », et un test la nomme plus bas : une
   * exception implicite serait une brèche.
   */
  SubmissionRejected: { template: "SubmissionRejected", reason: SECRET.detailedReason, ...FACTS },
  EscalationNotice: {
    template: "EscalationNotice",
    daysAfter: 7,
    ownerName: "Karim Belhadj",
    ...FACTS,
  },
  WeeklyDigest: {
    template: "WeeklyDigest",
    recipientName: "Amine Cherif",
    weekLabel: "Semaine du 09/02/2026",
    sections: [
      { title: "Retards en cours", items: ["G50 — 2026-01"], hiddenCount: 0 },
      { title: "Validations en attente", items: ["CNAS — 2026-01"], hiddenCount: 4 },
    ],
    dashboardUrl: `${BASE_URL}/fr/dashboard`,
  },
  UserInvitation: {
    template: "UserInvitation",
    inviterName: "Amine Cherif",
    roleLabel: "Responsable",
    acceptUrl: `${BASE_URL}/fr/set-password?token=xyz`,
    expiresInHours: 48,
  },
  PasswordReset: {
    template: "PasswordReset",
    resetUrl: `${BASE_URL}/fr/reset?token=xyz`,
    expiresInMinutes: 60,
  },
  IntegrityAlert: {
    template: "IntegrityAlert",
    checkedCount: 120,
    divergentCount: 2,
    checkedAt: "12/02/2026 03:00",
    reportUrl: `${BASE_URL}/fr/admin/settings`,
  },
  BackupFailureAlert: {
    template: "BackupFailureAlert",
    lastSuccessAt: "05/02/2026 02:00",
    hoursSinceSuccess: 173,
    reportUrl: `${BASE_URL}/fr/admin/jobs`,
  },
  GroupedAlerts: {
    template: "GroupedAlerts",
    recipientName: "Amine Cherif",
    items: ["G50 — echeance dans 7 jour(s)", "CNAS — en retard de 2 jour(s)"],
    listUrl: `${BASE_URL}/fr/echeancier`,
  },
  AbsenceRouting: {
    template: "AbsenceRouting",
    absentName: "Karim Belhadj",
    offsetDays: 3,
    ...FACTS,
  },
  DeputyNotice: { template: "DeputyNotice", ownerName: "Karim Belhadj", ...FACTS },
};

const ALL = Object.entries(PAYLOADS) as [TemplateKey, EmailPayload][];

/**
 * Champs autorisés, gabarit par gabarit.
 *
 * ⚠️ LISTE BLANCHE TENUE À LA MAIN, ET C'EST VOULU. Ajouter un champ à
 * `EmailPayload` casse d'abord la compilation de ce fichier (le littéral devient
 * incomplet), puis fait échouer ce test tant que le nom n'a pas été inscrit ici.
 * Le passage oblige donc quelqu'un à écrire noir sur blanc « oui, cette donnée
 * part par courriel ». Une liste déduite du type à l'exécution — ce que
 * TypeScript ne permet pas — n'aurait rien gardé du tout.
 */
const CHAMPS_AUTORISES: Readonly<Record<TemplateKey, readonly string[]>> = {
  UpcomingDeadline: ["template", "daysBefore", ...Object.keys(FACTS)],
  OverdueAlert: ["template", "daysAfter", ...Object.keys(FACTS)],
  ValidationRequested: ["template", ...Object.keys(FACTS)],
  SubmissionRejected: ["template", "reason", ...Object.keys(FACTS)],
  EscalationNotice: ["template", "daysAfter", "ownerName", ...Object.keys(FACTS)],
  AbsenceRouting: ["template", "absentName", "offsetDays", ...Object.keys(FACTS)],
  DeputyNotice: ["template", "ownerName", ...Object.keys(FACTS)],
  WeeklyDigest: ["template", "recipientName", "weekLabel", "sections", "dashboardUrl"],
  UserInvitation: ["template", "inviterName", "roleLabel", "acceptUrl", "expiresInHours"],
  PasswordReset: ["template", "resetUrl", "expiresInMinutes"],
  IntegrityAlert: ["template", "checkedCount", "divergentCount", "checkedAt", "reportUrl"],
  BackupFailureAlert: ["template", "lastSuccessAt", "hoursSinceSuccess", "reportUrl"],
  GroupedAlerts: ["template", "recipientName", "items", "listUrl"],
};

// ─── Détecteurs ──────────────────────────────────────────────────────────────

/**
 * Retire commentaires de ligne et de bloc.
 *
 * Les gabarits DISENT en commentaire ce qu'ils ne portent pas — « ni montant, ni
 * pièce jointe ». Sans ce nettoyage, l'analyse ci-dessous se déclencherait sur
 * la documentation de la règle qu'elle vérifie.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * Identifiants qui n'ont rien à faire dans un gabarit de courriel.
 *
 * ⚠️ En ANGLAIS et en casse de code, parce que c'est la forme qu'aurait le
 * défaut : personne n'écrit `props.montant`, on écrit `props.documentName`. Les
 * commentaires français du projet emploient les mots équivalents en toutes
 * lettres, d'où le nettoyage préalable.
 */
const INTERDITS = [
  "documentName",
  "fileName",
  "filename",
  "originalName",
  "storagePath",
  "attachment",
  "attachments",
  "amount",
  "totalAmount",
  "referenceNumber",
  "checksum",
  "sha256",
  "contentHash",
] as const;

function champsInterdits(source: string): string[] {
  const code = sansCommentaires(source);
  return INTERDITS.filter((mot) => new RegExp(`\\b${mot}\\b`, "i").test(code));
}

function fichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return fichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

/** Nom de fichier avec extension bureautique — la signature d'un nom de document. */
const NOM_DE_FICHIER = /[\w-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|zip|odt|ods|jpe?g|png)\b/i;
/** Montant suivi d'une devise. */
const MONTANT = /\d[\d\s.,]*\s?(?:DA|DZD)\b|[€$]\s?\d/;
/** Suite de six chiffres ou plus : un numéro de référence, jamais une date. */
const NUMERO = /\d{6,}/;

// ─── Rendu ───────────────────────────────────────────────────────────────────

describe("rendu des gabarits de courriel", () => {
  it("le jeu d'essai couvre TOUS les gabarits déclarés", () => {
    /*
     * ⚠️ SÉCURITÉ DU TEST LUI-MÊME. Ajouter un gabarit sans l'ajouter ici le
     * laisserait non testé — et le fichier resterait vert, ce qui est pire que
     * rouge : il affirmerait une couverture qu'il n'a pas.
     */
    expect([...TEMPLATE_KEYS].sort()).toEqual(ALL.map(([key]) => key).sort());
  });

  it.each(ALL)("%s produit un sujet, un HTML et un texte non vides", async (_key, payload) => {
    const rendu = await renderEmail(payload);

    expect(rendu.subject.trim().length).toBeGreaterThan(0);
    expect(rendu.html.trim().length).toBeGreaterThan(0);
    /*
     * Le texte brut n'est pas une politesse : c'est ce que voient les passerelles
     * anti-spam d'entreprise, les clients configurés en texte seul et les
     * lecteurs d'écran mal servis par le HTML de courriel. C'est aussi la version
     * que personne ne relit, donc celle qui resterait cassée le plus longtemps.
     */
    expect(rendu.text.trim().length).toBeGreaterThan(40);
  });

  it.each(ALL)("%s ne dépend d'AUCUNE image pour être compris", async (_key, payload) => {
    const rendu = await renderEmail(payload);

    /*
     * ⚠️ Outlook bloque les images distantes par défaut en entreprise. Un
     * courriel dont le sens passe par une image arrive vide chez la moitié de ses
     * destinataires, et personne ne le signale. Deux vérifications : aucune
     * balise d'image, et un texte brut qui porte à lui seul le message — titre,
     * accroche et lien.
     */
    expect(rendu.html).not.toContain("<img");
    expect(rendu.text).toContain("http");
    const lignes = rendu.text.split("\n").filter((ligne) => ligne.trim().length > 0);
    expect(lignes.length).toBeGreaterThanOrEqual(3);
  });

  it.each(ALL)("%s annonce lui-même qu'il ne porte aucune pièce jointe", async (_key, payload) => {
    const rendu = await renderEmail(payload);

    /*
     * ⚠️ L'interdiction est tenue par le TYPE : `EmailMessage` ne déclare aucun
     * champ de pièce jointe (voir le test de structure plus bas). Ici on vérifie
     * la contrepartie visible — le pied de page le DIT au destinataire, pour que
     * personne n'attende un fichier qui ne viendra pas, ni ne réponde au courriel
     * en en joignant un.
     */
    expect(rendu.text).toContain("aucune pièce jointe");
  });
});

// ─── Liens profonds ──────────────────────────────────────────────────────────

describe("liens profonds", () => {
  /** Chaque gabarit porte un lien d'action, et l'on sait lequel. */
  const LIENS: [TemplateKey, string][] = [
    ["UpcomingDeadline", FACTS.occurrenceUrl],
    ["OverdueAlert", FACTS.occurrenceUrl],
    ["ValidationRequested", FACTS.occurrenceUrl],
    ["SubmissionRejected", FACTS.occurrenceUrl],
    ["EscalationNotice", FACTS.occurrenceUrl],
    ["AbsenceRouting", FACTS.occurrenceUrl],
    ["DeputyNotice", FACTS.occurrenceUrl],
    ["WeeklyDigest", `${BASE_URL}/fr/dashboard`],
    ["GroupedAlerts", `${BASE_URL}/fr/echeancier`],
    ["UserInvitation", `${BASE_URL}/fr/set-password?token=xyz`],
    ["PasswordReset", `${BASE_URL}/fr/reset?token=xyz`],
    ["IntegrityAlert", `${BASE_URL}/fr/admin/settings`],
    ["BackupFailureAlert", `${BASE_URL}/fr/admin/jobs`],
  ];

  it("les treize gabarits portent un lien", () => {
    // Un gabarit sans lien d'action laisse le destinataire chercher l'écran
    // concerné dans l'application — ce qu'il ne fera pas.
    expect(LIENS.map(([key]) => key).sort()).toEqual([...TEMPLATE_KEYS].sort());
  });

  it.each(LIENS)("%s porte un lien ABSOLU, en HTML et en texte", async (key, attendu) => {
    const rendu = await renderEmail(PAYLOADS[key]);

    /*
     * ⚠️ ABSOLU, et vérifié comme tel. Un courriel n'a pas d'origine : un
     * `href="/fr/echeancier/…"` s'y résout contre le domaine du client de
     * messagerie, c'est-à-dire nulle part. Le défaut est invisible au rendu — le
     * lien s'affiche normalement — et ne se découvre qu'au clic.
     */
    expect(attendu.startsWith("https://")).toBe(true);
    expect(rendu.html).toContain(`href="${attendu}"`);
    // En texte brut il n'y a pas d'ancre : l'adresse doit être écrite en clair.
    expect(rendu.text).toContain(attendu);
  });
});

// ─── Confidentialité ─────────────────────────────────────────────────────────

describe("aucune donnée confidentielle dans un courriel", () => {
  /*
   * ⚠️ `SubmissionRejected` EST LA SEULE EXCEPTION, ET ELLE EST ARRÊTÉE. Le
   * motif d'un rejet est une appréciation sur le travail, pas une donnée
   * fiscale ; l'omettre obligerait le destinataire à ouvrir l'application pour
   * apprendre ce qu'il aurait dû lire. L'exception est NOMMÉE, donc visible.
   */
  const SANS_MOTIF = ALL.filter(([key]) => key !== "SubmissionRejected");

  it.each(SANS_MOTIF)("%s ne laisse passer aucun motif détaillé", async (_key, payload) => {
    const rendu = await renderEmail(payload);
    expect(`${rendu.subject}\n${rendu.html}\n${rendu.text}`).not.toContain(SECRET.detailedReason);
  });

  it("SubmissionRejected porte le motif — et RIEN d'autre de confidentiel", async () => {
    const rendu = await renderEmail(PAYLOADS.SubmissionRejected);
    const corpus = `${rendu.subject}\n${rendu.html}\n${rendu.text}`;

    // L'exception assumée.
    expect(corpus).toContain(SECRET.detailedReason);
    // Tout le reste demeure interdit.
    expect(corpus).not.toContain(SECRET.documentName);
    expect(corpus).not.toContain(SECRET.amount);
    expect(corpus).not.toContain(SECRET.reference);
  });

  it.each(ALL)(
    "%s ne contient ni nom de fichier, ni montant, ni numéro de référence",
    async (_key, payload) => {
      const rendu = await renderEmail(payload);

      /*
       * ⚠️ Analyse du TEXTE BRUT et non du HTML : le HTML porte des couleurs
       * hexadécimales et des entités numériques qui ressemblent à des références
       * sans en être. Le texte, lui, ne contient que ce que le destinataire lit —
       * c'est exactement la matière que ces motifs doivent surveiller.
       *
       * Ces motifs ne sont pas décoratifs : le jour où quelqu'un ajoute
       * `{props.documentName}` à un gabarit et qu'un nom de pièce le traverse,
       * `NOM_DE_FICHIER` le voit, quel que soit le nom du champ.
       */
      expect(rendu.text).not.toMatch(NOM_DE_FICHIER);
      expect(rendu.text).not.toMatch(MONTANT);
      expect(rendu.text).not.toMatch(NUMERO);
      expect(rendu.subject).not.toMatch(NOM_DE_FICHIER);
    },
  );

  it("les motifs de détection reconnaissent ce qu'ils cherchent", () => {
    /*
     * ⚠️ CONTRE-ÉPREUVE. Trois motifs qui ne trouvent jamais rien passent aussi
     * bien quand ils sont justes que quand ils sont faux. On leur soumet donc les
     * sentinelles : s'ils ne les reconnaissent pas, les tests ci-dessus sont
     * décoratifs et ce test le dit.
     */
    expect(`Pièce jointe : ${SECRET.documentName}`).toMatch(NOM_DE_FICHIER);
    expect(`Montant déclaré : ${SECRET.amount}`).toMatch(MONTANT);
    expect(`Référence : ${SECRET.reference}`).toMatch(NUMERO);

    // Et qu'ils ne se déclenchent pas sur ce qu'un courriel porte légitimement.
    expect("Échéance interne : 13/02/2026").not.toMatch(NUMERO);
    expect("Période : 2026-01").not.toMatch(NOM_DE_FICHIER);
    expect("Obligation : Declaration mensuelle G50 (G50)").not.toMatch(MONTANT);
  });

  it("la charge utile d'un gabarit ne porte QUE des champs vérifiés", () => {
    for (const [key, payload] of ALL) {
      expect(Object.keys(payload).sort(), `charge utile de ${key}`).toEqual(
        [...CHAMPS_AUTORISES[key]].sort(),
      );
    }
  });

  it("aucun gabarit n'accède à un champ interdit", () => {
    /*
     * ⚠️ C'EST CE TEST QUI ÉCHOUE si l'on ajoute un nom de document dans un
     * gabarit. Les deux précédents surveillent les VALEURS rendues ; celui-ci
     * surveille le CODE, donc il attrape aussi le cas où la valeur d'essai serait
     * anodine — un test qui rendrait `documentName: "note.txt"` passerait le
     * filtre de motifs, pas celui-ci.
     */
    const fautifs = fichiersSource("src/emails")
      .map((chemin) => [chemin, champsInterdits(readFileSync(chemin, "utf8"))] as const)
      .filter(([, mots]) => mots.length > 0);

    expect(fautifs).toEqual([]);
  });

  it("le contrat d'envoi ne déclare AUCUNE pièce jointe", () => {
    /*
     * ⚠️ L'INTERDICTION EST DANS LE TYPE, pas dans une consigne. `EmailMessage`
     * n'a pas de champ de pièce jointe : les deux fournisseurs ne peuvent donc
     * pas en transmettre, et il n'y a rien à discipliner. Ce test garde la porte —
     * ajouter le champ demanderait de supprimer cette ligne, ce qui se voit en
     * revue, là où un `attachments?:` glissé dans une interface ne se voit pas.
     */
    expect(
      champsInterdits(readFileSync("src/services/notifications/providers/types.ts", "utf8")),
    ).toEqual([]);

    for (const fichier of ["dispatcher.ts", "scheduler.ts"]) {
      const source = readFileSync(join("src/services/notifications", fichier), "utf8");
      expect(champsInterdits(source), fichier).toEqual([]);
    }
  });

  it("le détecteur de champs interdits fonctionne dans les deux sens", () => {
    // Il trouve ce qu'il doit trouver…
    expect(champsInterdits("<EmailText>{props.documentName}</EmailText>")).toContain(
      "documentName",
    );
    expect(champsInterdits("const total = invoice.amount;")).toContain("amount");
    expect(champsInterdits("send({ ...message, attachments: [file] });")).toContain("attachments");

    // …et il ignore la documentation de la règle, qui emploie les mêmes mots.
    expect(champsInterdits("// jamais de documentName ici")).toEqual([]);
    expect(champsInterdits("/* ni attachments, ni amount */")).toEqual([]);
  });
});

// ─── Variantes ───────────────────────────────────────────────────────────────

describe("variantes d'un même gabarit", () => {
  /*
   * ⚠️ CE SONT LES CAS OÙ UNE DONNÉE MANQUE, et ce sont ceux qui cassent. Un
   * gabarit se relit avec son jeu de données complet ; la ligne qui affiche
   * « null » ou qui saute un bloc entier n'apparaît qu'en production, dans le
   * courriel d'une obligation sans organisme ou d'une installation qui n'a
   * jamais sauvegardé.
   */

  it("une obligation SANS organisme ne laisse pas de ligne vide", async () => {
    const rendu = await renderEmail({
      template: "UpcomingDeadline",
      daysBefore: 7,
      ...FACTS,
      authorityName: null,
    });

    expect(rendu.text).not.toContain("Organisme");
    expect(rendu.text).not.toContain("null");
    // Les autres faits restent : c'est une ligne en moins, pas un bloc en moins.
    expect(rendu.text).toContain("Échéance interne");
  });

  it("un résumé hebdomadaire VIDE dit qu'il n'y a rien, plutôt que rien", async () => {
    const rendu = await renderEmail({
      template: "WeeklyDigest",
      recipientName: "Amine Cherif",
      weekLabel: "Semaine du 09/02/2026",
      sections: [],
      dashboardUrl: `${BASE_URL}/fr/dashboard`,
    });

    /*
     * ⚠️ Un résumé vide est une INFORMATION. Un message sans corps se confond
     * avec une panne d'envoi, et le destinataire finit par écrire pour demander
     * si le système fonctionne encore.
     */
    expect(rendu.text).toContain("Aucune échéance");
    expect(rendu.text.trim().length).toBeGreaterThan(80);
  });

  it("une section tronquée annonce ce qu'elle ne montre pas", async () => {
    const rendu = await renderEmail(PAYLOADS.WeeklyDigest);

    // Le jeu d'essai porte `hiddenCount: 4` sur la seconde section.
    expect(rendu.text).toContain("4");
    expect(rendu.text).toContain("autre");
  });

  it("une installation qui n'a JAMAIS sauvegardé le lit en toutes lettres", async () => {
    const rendu = await renderEmail({
      template: "BackupFailureAlert",
      lastSuccessAt: null,
      hoursSinceSuccess: 173,
      reportUrl: `${BASE_URL}/fr/admin/jobs`,
    });

    // « Jamais » n'est pas « inconnu », et surtout pas un tiret.
    expect(rendu.text).toContain("jamais");
    expect(rendu.text).not.toContain("null");
  });

  it("les gabarits de la triade omettent aussi l'organisme absent", async () => {
    // Le bloc de faits de la triade est distinct de celui des occurrences : il
    // se vérifie donc pour lui-même, sans quoi la correction faite d'un côté
    // laisserait l'autre afficher « null ».
    for (const cle of ["AbsenceRouting", "DeputyNotice"] as const) {
      const rendu = await renderEmail(
        cle === "AbsenceRouting"
          ? {
              template: cle,
              absentName: "Karim Belhadj",
              offsetDays: 3,
              ...FACTS,
              authorityName: null,
            }
          : { template: cle, ownerName: "Karim Belhadj", ...FACTS, authorityName: null },
      );
      expect(rendu.text, cle).not.toContain("Organisme");
      expect(rendu.text, cle).not.toContain("null");
    }
  });

  it("une clé de gabarit inconnue est reconnue comme telle", () => {
    /*
     * ⚠️ `template_key` EST UNE COLONNE, donc une donnée saisissable par un
     * administrateur. `isTemplateKey` est le seul point où une valeur fantaisiste
     * est arrêtée : sans lui, le rendu produirait un courriel vide que personne
     * ne remarquerait.
     */
    expect(isTemplateKey("UpcomingDeadline")).toBe(true);
    expect(isTemplateKey("AbsenceRouting")).toBe(true);
    expect(isTemplateKey("RappelGentil")).toBe(false);
    expect(isTemplateKey("")).toBe(false);
  });

  it("AbsenceRouting parle en jours RESTANTS quand l'échéance est à venir", async () => {
    const routage = (offsetDays: number): EmailPayload => ({
      template: "AbsenceRouting",
      absentName: "Karim Belhadj",
      offsetDays,
      ...FACTS,
    });

    const avant = await renderEmail(routage(-7));
    const apres = await renderEmail(routage(3));

    /*
     * ⚠️ Le déroutement s'applique aux DEUX moitiés de la chaîne : les rappels
     * qui précèdent l'échéance comme les relances qui la suivent. Un gabarit qui
     * annoncerait « en retard de -7 jours » à un suppléant lui apprendrait que le
     * système ne se relit pas.
     */
    expect(avant.text).toContain("dans 7 jour(s)");
    expect(apres.text).toContain("depuis 3 jour(s)");
  });
});

// ─── Gabarits de la triade ───────────────────────────────────────────────────

describe("gabarits de la triade", () => {
  it("AbsenceRouting NOMME l'absent et dit à quel titre on reçoit l'alerte", async () => {
    const rendu = await renderEmail(PAYLOADS.AbsenceRouting);

    /*
     * ⚠️ Sans le nom, la mention ne dit rien d'utile : le suppléant reçoit une
     * alerte sur un dossier dont il n'est pas responsable et cherche d'abord ce
     * qu'il a lui-même oublié de faire.
     */
    expect(rendu.text).toContain("Karim Belhadj");
    expect(rendu.text).toContain("suppléant");
    expect(rendu.text).toContain("absent");
  });

  it("AbsenceRouting dit que l'absent garde la notification dans l'application", async () => {
    const rendu = await renderEmail(PAYLOADS.AbsenceRouting);

    /*
     * Sans cette phrase, le suppléant peut croire qu'il doit prévenir son collègue
     * à son retour, et le collègue peut croire qu'on a traité son dossier dans son
     * dos. L'in-app n'est PAS déroutée — c'est la contrepartie de l'acheminement,
     * et elle doit s'énoncer.
     */
    expect(rendu.text).toContain("l'application");
  });

  it("AbsenceRouting porte les mêmes faits que l'alerte qu'il remplace", async () => {
    const deroute = await renderEmail(PAYLOADS.AbsenceRouting);
    const ordinaire = await renderEmail(PAYLOADS.OverdueAlert);

    // Le déroutement change le destinataire et la mention, jamais le contenu.
    for (const fait of [FACTS.obligationCode, FACTS.periodLabel, FACTS.internalDueDate]) {
      expect(deroute.text).toContain(fait);
      expect(ordinaire.text).toContain(fait);
    }
  });

  it("DeputyNotice annonce que les droits sont IMMÉDIATS", async () => {
    const rendu = await renderEmail(PAYLOADS.DeputyNotice);

    /*
     * ⚠️ C'est le malentendu que ce courriel existe pour dissiper : le suppléant
     * n'attend aucune absence pour agir. Le lui apprendre le jour où une alerte
     * lui tombe dessus serait tardif.
     */
    expect(rendu.text).toContain("sans attendre");
    expect(rendu.text).toContain("Karim Belhadj");
  });
});
