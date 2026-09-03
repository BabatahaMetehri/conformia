import { describe, expect, it } from "vitest";

import type { Permission } from "@/config/permissions";
import {
  PERMISSIONS,
  ROLE_CODES,
  hasAllPermissions,
  hasPermission,
  isPermission,
  isRoleCode,
} from "@/config/permissions";

describe("vocabulaire d'autorisation", () => {
  it("déclare exactement les 20 permissions arrêtées", () => {
    // ⚠️ Dix-huit jusqu'à 0019, vingt depuis : `register.manage` et
    // `absence.manage` accompagnent la matrice des rôles.
    expect(PERMISSIONS).toHaveLength(20);
    expect(new Set(PERMISSIONS).size).toBe(20);
  });

  it("déclare exactement les 12 rôles arrêtés", () => {
    /*
     * ⚠️ Neuf jusqu'à la migration 0018, douze depuis. La triade s'AJOUTE : les
     * cinq rôles par service sont désactivés en base, pas retirés du
     * vocabulaire. `user_roles` et `audit_log` portent leurs identifiants, et un
     * historique doit rester typable.
     */
    expect(ROLE_CODES).toHaveLength(12);
    expect(new Set(ROLE_CODES).size).toBe(12);
    expect(ROLE_CODES).toContain("ADMIN");
    expect(ROLE_CODES).toContain("EXTERNAL");

    // La triade d'affectation.
    for (const code of ["RESPONSABLE", "SUPPLEANT", "SUPERVISEUR"]) {
      expect(ROLE_CODES).toContain(code);
    }
    // Et les rôles par service, toujours déclarés bien que désactivés.
    for (const code of [
      "COMPTA_AGENT",
      "COMPTA_MANAGER",
      "RH_AGENT",
      "RH_MANAGER",
      "REGLEMENTAIRE",
    ]) {
      expect(ROLE_CODES).toContain(code);
    }
  });

  it("nomme les permissions en `domaine.action`", () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe("hasPermission", () => {
  const granted: readonly Permission[] = ["occurrence.read", "document.upload"];

  it("reconnaît une permission accordée", () => {
    expect(hasPermission(granted, "occurrence.read")).toBe(true);
  });

  it("refuse une permission absente", () => {
    expect(hasPermission(granted, "occurrence.unlock")).toBe(false);
  });

  it("refuse tout sur un ensemble vide", () => {
    expect(hasPermission([], "obligation.read")).toBe(false);
  });

  it("accepte n'importe quel itérable, dont un Set", () => {
    expect(hasPermission(new Set<Permission>(["audit.read"]), "audit.read")).toBe(true);
  });
});

describe("hasAllPermissions", () => {
  const granted: readonly Permission[] = ["occurrence.read", "occurrence.write", "document.read"];

  it("exige la totalité des permissions demandées", () => {
    expect(hasAllPermissions(granted, ["occurrence.read", "document.read"])).toBe(true);
    expect(hasAllPermissions(granted, ["occurrence.read", "occurrence.validate"])).toBe(false);
  });

  it("est vrai pour une exigence vide", () => {
    expect(hasAllPermissions([], [])).toBe(true);
  });
});

describe("gardes de type", () => {
  it("valide une permission connue", () => {
    expect(isPermission("occurrence.validate")).toBe(true);
    expect(isPermission("occurrence.destroy")).toBe(false);
  });

  it("valide un rôle connu", () => {
    expect(isRoleCode("COMPTA_MANAGER")).toBe(true);
    expect(isRoleCode("comptable")).toBe(false);
  });
});
