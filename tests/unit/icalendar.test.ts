import { describe, expect, it } from "vitest";

import {
  escapeText,
  foldLine,
  nextIsoDay,
  serializeCalendar,
  toIcsDate,
  toIcsTimestamp,
} from "@/lib/icalendar";

/**
 * Le format iCalendar se vérifie caractère par caractère, parce que c'est ainsi
 * qu'il est lu : un agenda qui n'aime pas un flux ne le signale pas, il cesse
 * simplement de l'afficher. Aucun de ces cas ne se serait vu à l'œil nu dans un
 * fichier de trois cents lignes.
 */

const STAMP = new Date("2026-09-02T08:30:00.000Z");

function baseEvent() {
  return {
    uid: "occurrence-1@conformia.agroespace.dz",
    date: "2026-09-20",
    summary: "G50 — Déclaration mensuelle",
    description: "Organisme : DGI",
    alarmDaysBefore: 7,
    alarmText: "Échéance dans une semaine.",
    lastModified: new Date("2026-09-01T10:00:00.000Z"),
  };
}

describe("échappement", () => {
  it("échappe la barre oblique AVANT les autres caractères", () => {
    // Dans l'autre ordre, on échapperait les barres qu'on vient d'introduire :
    // « a;b » deviendrait « a\\\\;b », soit une barre littérale suivie d'un
    // séparateur — c'est-à-dire un champ coupé en deux.
    expect(escapeText("a\\b;c")).toBe("a\\\\b\\;c");
  });

  it("échappe virgule, point-virgule et saut de ligne", () => {
    expect(escapeText("a,b;c\nd")).toBe("a\\,b\\;c\\nd");
    expect(escapeText("a\r\nb")).toBe("a\\nb");
  });

  it("laisse intact un texte ordinaire", () => {
    expect(escapeText("Déclaration mensuelle")).toBe("Déclaration mensuelle");
  });
});

describe("pliage des lignes", () => {
  it("laisse une ligne courte telle quelle", () => {
    expect(foldLine("SUMMARY:court")).toBe("SUMMARY:court");
  });

  it("plie à 75 octets, la suite préfixée d'une espace", () => {
    const folded = foldLine(`SUMMARY:${"a".repeat(200)}`);
    const segments = folded.split("\r\n");

    expect(segments.length).toBeGreaterThan(1);
    expect(new TextEncoder().encode(segments[0] ?? "").length).toBeLessThanOrEqual(75);
    for (const segment of segments.slice(1)) expect(segment.startsWith(" ")).toBe(true);
  });

  it("compte en OCTETS et ne coupe jamais un caractère accentué en deux", () => {
    /*
     * ⚠️ Le cas qui justifie tout ce code. « é » pèse deux octets : compter en
     * caractères ferait dépasser la limite, et couper au milieu de la paire
     * produirait un octet UTF-8 orphelin. L'agenda affiche alors un losange, ou
     * refuse le fichier entier.
     */
    const folded = foldLine(`DESCRIPTION:${"é".repeat(80)}`);

    for (const segment of folded.split("\r\n")) {
      expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(75);
    }
    // Aucun caractère de remplacement : la chaîne se recompose à l'identique.
    expect(folded.replaceAll("\r\n ", "")).toBe(`DESCRIPTION:${"é".repeat(80)}`);
  });
});

describe("dates", () => {
  it("convertit une date ISO en date iCalendar", () => {
    expect(toIcsDate("2026-09-20")).toBe("20260920");
  });

  it("horodate en UTC, secondes comprises", () => {
    expect(toIcsTimestamp(STAMP)).toBe("20260902T083000Z");
  });

  it("calcule le lendemain, y compris en fin de mois et en année bissextile", () => {
    expect(nextIsoDay("2026-09-30")).toBe("2026-10-01");
    expect(nextIsoDay("2026-12-31")).toBe("2027-01-01");
    expect(nextIsoDay("2028-02-28")).toBe("2028-02-29");
  });
});

describe("sérialisation", () => {
  const calendar = serializeCalendar({
    name: "CONFORMIA — mes échéances",
    description: "Échéances internes",
    events: [baseEvent()],
    stamp: STAMP,
  });

  it("ouvre et ferme le calendrier, en CRLF", () => {
    expect(calendar.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // Aucun saut de ligne isolé : la RFC impose CRLF, et Outlook l'applique.
    expect(/[^\r]\n/.test(calendar)).toBe(false);
  });

  it("produit un événement d'une JOURNÉE, avec un DTEND exclusif au lendemain", () => {
    expect(calendar).toContain("DTSTART;VALUE=DATE:20260920");
    expect(calendar).toContain("DTEND;VALUE=DATE:20260921");
    // Aucune heure : une échéance administrative n'en a pas, et lui en donner
    // une la ferait glisser d'un jour pour un agenda réglé sur un autre fuseau.
    expect(calendar).not.toContain("DTSTART:2026");
  });

  it("porte un rappel à J-7", () => {
    expect(calendar).toContain("BEGIN:VALARM");
    expect(calendar).toContain("TRIGGER:-P7D");
    expect(calendar).toContain("ACTION:DISPLAY");
  });

  it("n'occupe pas la journée dans l'agenda", () => {
    // Douze échéances rendraient l'agenda inutilisable pour qui y cherche une
    // disponibilité.
    expect(calendar).toContain("TRANSP:TRANSPARENT");
  });

  it("horodate chaque événement", () => {
    expect(calendar).toContain(`DTSTAMP:${toIcsTimestamp(STAMP)}`);
  });

  it("omet le bloc de rappel quand il n'y en a pas", () => {
    const withoutAlarm = serializeCalendar({
      name: "n",
      description: "d",
      events: [{ ...baseEvent(), alarmDaysBefore: null }],
      stamp: STAMP,
    });
    expect(withoutAlarm).not.toContain("BEGIN:VALARM");
  });

  it("reste valide sans aucun événement", () => {
    // Le cas d'un jeton révoqué : la route rend un calendrier vide plutôt qu'une
    // erreur, et il doit rester lisible par un agenda déjà abonné.
    const empty = serializeCalendar({ name: "n", description: "d", events: [], stamp: STAMP });
    expect(empty).toContain("BEGIN:VCALENDAR");
    expect(empty).toContain("END:VCALENDAR");
    expect(empty).not.toContain("BEGIN:VEVENT");
  });

  it("échappe le contenu des événements", () => {
    const risky = serializeCalendar({
      name: "n",
      description: "d",
      events: [{ ...baseEvent(), summary: "G50; TVA, acompte" }],
      stamp: STAMP,
    });
    expect(risky).toContain("SUMMARY:G50\\; TVA\\, acompte");
  });
});
