import { describe, expect, it } from "vitest";

import { detectLocale } from "@/lib/locale-detection";

describe("detectLocale", () => {
  it("le cookie prime sur Accept-Language", () => {
    // Un choix explicite ne doit pas être redemandé à chaque visite, même depuis
    // un poste configuré autrement.
    expect(detectLocale("fr", "ar-DZ,ar;q=0.9")).toBe("fr");
    expect(detectLocale("ar", "fr-FR,fr;q=0.9")).toBe("ar");
  });

  it("ignore un cookie portant une locale non prise en charge", () => {
    expect(detectLocale("de", "ar;q=0.9")).toBe("ar");
    expect(detectLocale("", null)).toBe("fr");
  });

  it("retient la locale de plus forte qualité", () => {
    expect(detectLocale(undefined, "en;q=0.3,ar;q=0.8,fr;q=0.5")).toBe("ar");
  });

  it("fait correspondre une sous-balise régionale à sa langue", () => {
    expect(detectLocale(undefined, "fr-DZ")).toBe("fr");
    expect(detectLocale(undefined, "ar-DZ,en-US;q=0.5")).toBe("ar");
  });

  it("traite une qualité absente comme 1", () => {
    expect(detectLocale(undefined, "ar,fr;q=0.9")).toBe("ar");
  });

  it("ne se laisse pas désarmer par une entrée illisible", () => {
    // Une valeur de qualité invalide vaut 0 : elle passe derrière, elle
    // n'invalide pas l'en-tête entier.
    expect(detectLocale(undefined, "ar;q=abc,fr;q=0.9")).toBe("fr");
  });

  it("retombe sur le français quand rien ne correspond", () => {
    expect(detectLocale(undefined, "en-US,en;q=0.9,de;q=0.8")).toBe("fr");
    expect(detectLocale(undefined, "")).toBe("fr");
    expect(detectLocale(undefined, null)).toBe("fr");
  });
});
