// @vitest-environment node

import { describe, expect, it } from "vitest";

import { groupPending } from "@/services/notifications/dispatcher";
import { isDigestDue } from "@/services/notifications/digest";
import { hourBucket, toPayload } from "@/services/notifications/scheduler";
import type { NotificationCandidate, PendingEmail } from "@/data/queries/notifications";

/**
 * Les fonctions PURES du module de notification : celles dont dépendent la
 * déduplication, le regroupement et l'heure d'envoi. Le reste — insertion,
 * envoi, escalade — se vérifie contre une vraie base, dans la suite
 * d'intégration : une file d'attente ne se teste pas avec des objets simulés.
 */

function candidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return {
    occurrenceId: "11111111-1111-1111-1111-111111111111",
    ruleId: "22222222-2222-2222-2222-222222222222",
    escalationPolicyId: null,
    recipientId: "33333333-3333-3333-3333-333333333333",
    channel: "EMAIL",
    kind: "UPCOMING_DEADLINE",
    templateKey: "UpcomingDeadline",
    offsetDays: -30,
    obligationCode: "G50",
    obligationName: "Déclaration mensuelle G50",
    authorityName: "DGI",
    criticality: "HIGH",
    periodKey: "2026-09",
    internalDueDate: "2026-10-13",
    legalDueDate: "2026-10-20",
    status: "TODO",
    recipientEmail: "agent@agroespace.dz",
    recipientName: "Agent",
    ownerName: "Agent",
    ...overrides,
  };
}

function pending(overrides: Partial<PendingEmail> = {}): PendingEmail {
  return {
    id: 1,
    recipientId: "33333333-3333-3333-3333-333333333333",
    recipientEmail: "agent@agroespace.dz",
    recipientName: "Agent",
    subject: "G50 — échéance dans 30 jour(s)",
    bodyHtml: "<p>x</p>",
    bodyText: "x",
    scheduledFor: "2026-09-02T08:00:00.000Z",
    retryCount: 0,
    ...overrides,
  };
}

describe("clé de regroupement horaire", () => {
  it("ramène tout instant au début de son heure UTC", () => {
    expect(hourBucket(new Date("2026-09-02T08:37:41.512Z")).toISOString()).toBe(
      "2026-09-02T08:00:00.000Z",
    );
  });

  it("donne la MÊME clé à deux alertes du même cycle", () => {
    /*
     * ⚠️ C'est ce qui rend le regroupement possible. Avec `now()` tel quel,
     * deux alertes du même cycle porteraient des horodatages distincts à la
     * milliseconde près et ne seraient jamais « dans la même heure ».
     */
    const a = hourBucket(new Date("2026-09-02T08:00:00.001Z"));
    const b = hourBucket(new Date("2026-09-02T08:59:59.999Z"));
    expect(a.getTime()).toBe(b.getTime());
  });

  it("sépare deux cycles consécutifs", () => {
    const a = hourBucket(new Date("2026-09-02T08:59:59.999Z"));
    const b = hourBucket(new Date("2026-09-02T09:00:00.000Z"));
    expect(a.getTime()).not.toBe(b.getTime());
  });
});

describe("traduction d'une candidate en gabarit", () => {
  it("compte les jours RESTANTS pour un jalon préventif", () => {
    // L'offset est négatif en base ; le destinataire lit « dans 30 jours ».
    const payload = toPayload(candidate({ offsetDays: -30 }));
    expect(payload.ok).toBe(true);
    if (payload.ok && payload.value.template === "UpcomingDeadline") {
      expect(payload.value.daysBefore).toBe(30);
    }
  });

  it("compte les jours ÉCOULÉS pour un rappel de retard", () => {
    const payload = toPayload(
      candidate({ offsetDays: 3, templateKey: "OverdueAlert", kind: "OVERDUE_ALERT" }),
    );
    expect(payload.ok).toBe(true);
    if (payload.ok && payload.value.template === "OverdueAlert") {
      expect(payload.value.daysAfter).toBe(3);
    }
  });

  it("ne fait sortir QUE le libellé, la période et les échéances", () => {
    /*
     * ⚠️ Le test qui garde l'interdiction : « aucune donnée confidentielle dans
     * un e-mail ». Il liste ce qui a le droit de franchir la frontière ; toute
     * clé ajoutée à la charge utile le fera échouer, ce qui est précisément le
     * moment où quelqu'un doit se demander si elle a sa place dans un courriel.
     */
    const payload = toPayload(candidate());
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    expect(Object.keys(payload.value).toSorted()).toEqual(
      [
        "authorityName",
        "daysBefore",
        "internalDueDate",
        "legalDueDate",
        "obligationCode",
        "obligationName",
        "occurrenceUrl",
        "periodLabel",
        "template",
      ].toSorted(),
    );
  });

  it("produit un lien ABSOLU vers le dossier", () => {
    const payload = toPayload(candidate());
    expect(payload.ok).toBe(true);
    // Le rétrécissement passe par le gabarit : `occurrenceUrl` n'existe que sur
    // les charges utiles qui parlent d'une occurrence, et c'est bien ce qu'on
    // veut — un résumé hebdomadaire n'en a pas.
    if (payload.ok && payload.value.template === "UpcomingDeadline") {
      // Un courriel n'a pas d'origine : un chemin relatif n'y est pas cliquable.
      expect(payload.value.occurrenceUrl).toMatch(
        /^https?:\/\/.+\/fr\/echeancier\/11111111-1111-1111-1111-111111111111$/,
      );
    }
  });

  it("nomme le porteur dans une escalade", () => {
    const payload = toPayload(
      candidate({
        templateKey: "EscalationNotice",
        kind: "ESCALATION",
        escalationPolicyId: "44444444-4444-4444-4444-444444444444",
        ruleId: null,
        offsetDays: 3,
        ownerName: "Nadia B.",
      }),
    );
    expect(payload.ok).toBe(true);
    if (payload.ok && payload.value.template === "EscalationNotice") {
      expect(payload.value.ownerName).toBe("Nadia B.");
    }
  });

  it("REFUSE une clé de gabarit inconnue plutôt que d'envoyer un message vide", () => {
    // La clé vient d'une colonne : un administrateur peut y saisir n'importe quoi.
    const payload = toPayload(candidate({ templateKey: "Inexistant" }));
    expect(payload.ok).toBe(false);
  });

  it("REFUSE un gabarit qu'aucun jalon ne peut déclencher", () => {
    // Un résumé hebdomadaire ne naît pas d'une échéance : le désigner dans une
    // règle est une erreur de saisie, signalée comme telle.
    const payload = toPayload(candidate({ templateKey: "WeeklyDigest" }));
    expect(payload.ok).toBe(false);
  });
});

describe("regroupement de la file d'envoi", () => {
  it("réunit les alertes d'un même destinataire dans la même heure", () => {
    const groups = groupPending([pending({ id: 1 }), pending({ id: 2 }), pending({ id: 3 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("sépare deux destinataires", () => {
    const groups = groupPending([
      pending({ id: 1 }),
      pending({ id: 2, recipientId: "55555555-5555-5555-5555-555555555555" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("sépare deux heures d'envoi pour un même destinataire", () => {
    // Une alerte de 8 h et une de 9 h sont deux messages : les fusionner ferait
    // arriver la première avec une heure de retard.
    const groups = groupPending([
      pending({ id: 1, scheduledFor: "2026-09-02T08:00:00.000Z" }),
      pending({ id: 2, scheduledFor: "2026-09-02T09:00:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("rend une liste vide pour une file vide", () => {
    expect(groupPending([])).toEqual([]);
  });
});

describe("créneau du résumé hebdomadaire", () => {
  // 2026-09-07 est un lundi. 06:00 UTC = 07:00 à Alger (UTC+1, sans heure d'été).
  const mondaySevenAlgiers = new Date("2026-09-07T06:00:00.000Z");

  it("reconnaît le créneau réglé, en heure d'ALGER", () => {
    expect(isDigestDue(mondaySevenAlgiers, 1, 7)).toBe(true);
  });

  it("refuse l'heure UTC correspondante, qui est 08 h à Alger", () => {
    /*
     * ⚠️ Le défaut que ce test empêche : lire l'heure en UTC ferait partir le
     * résumé à 08 h locales, ou — pour un réglage à 00 h — la veille au soir.
     * Personne ne ferait le lien entre « le résumé arrive le dimanche » et une
     * lecture de fuseau.
     */
    expect(isDigestDue(new Date("2026-09-07T07:00:00.000Z"), 1, 7)).toBe(false);
  });

  it("refuse le bon jour à la mauvaise heure", () => {
    expect(isDigestDue(new Date("2026-09-07T09:00:00.000Z"), 1, 7)).toBe(false);
  });

  it("refuse la bonne heure le mauvais jour", () => {
    // 2026-09-08 est un mardi.
    expect(isDigestDue(new Date("2026-09-08T06:00:00.000Z"), 1, 7)).toBe(false);
  });

  it("suit un réglage déplacé, sans changement de code", () => {
    // Jeudi 2026-09-10, 14 h à Alger = 13 h UTC.
    expect(isDigestDue(new Date("2026-09-10T13:00:00.000Z"), 4, 14)).toBe(true);
  });

  it("gère le dimanche, qui vaut 7 et non 0 en norme ISO", () => {
    // 2026-09-06 est un dimanche. `getDay()` rendrait 0 et ne correspondrait à
    // aucun réglage valide, rendant le dimanche impossible à choisir.
    expect(isDigestDue(new Date("2026-09-06T06:00:00.000Z"), 7, 7)).toBe(true);
  });
});
