import { describe, expect, it } from "vitest";

import { sampleSize } from "@/lib/integrity-sampling";

/**
 * Taille de l'échantillon du contrôle d'intégrité mensuel.
 *
 * La règle est « 10 % ou 50 documents au minimum ». Les deux moitiés comptent :
 * le pourcentage seul ne prouve rien sur une petite installation, le plancher
 * seul ferait recalculer toute la base sur une grande.
 */
describe("sampleSize", () => {
  it("applique le plancher tant que le pourcentage est en dessous", () => {
    // 10 % de 200 font 20, moins que le plancher de 50.
    expect(sampleSize(200, 10, 50)).toBe(50);
  });

  it("applique le pourcentage dès qu'il dépasse le plancher", () => {
    expect(sampleSize(1000, 10, 50)).toBe(100);
  });

  it("ne dépasse JAMAIS le nombre de documents existants", () => {
    // ⚠️ Sans cette borne, une base de 12 pièces demanderait un échantillon de
    // 50 : la requête rendrait 12 lignes, et le rapport annoncerait une
    // couverture de 50 contrôles qui n'ont pas eu lieu.
    expect(sampleSize(12, 10, 50)).toBe(12);
    expect(sampleSize(1, 10, 50)).toBe(1);
  });

  it("ne demande rien quand il n'y a rien à contrôler", () => {
    expect(sampleSize(0, 10, 50)).toBe(0);
  });

  it("arrondit le pourcentage vers le HAUT", () => {
    // 10 % de 1005 font 100,5 : on contrôle 101, jamais 100.
    expect(sampleSize(1005, 10, 1)).toBe(101);
  });

  it("suit un réglage modifié en base, sans redéploiement", () => {
    // Le pourcentage et le plancher sont des app_settings : les faire varier
    // ici garantit qu'aucune des deux valeurs n'est figée dans le code.
    expect(sampleSize(1000, 25, 1)).toBe(250);
    expect(sampleSize(1000, 1, 300)).toBe(300);
  });
});
