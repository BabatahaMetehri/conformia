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
  it("déclare exactement les 18 permissions arrêtées", () => {
    expect(PERMISSIONS).toHaveLength(18);
    expect(new Set(PERMISSIONS).size).toBe(18);
  });

  it("déclare exactement les 9 rôles arrêtés", () => {
    expect(ROLE_CODES).toHaveLength(9);
    expect(new Set(ROLE_CODES).size).toBe(9);
    expect(ROLE_CODES).toContain("ADMIN");
    expect(ROLE_CODES).toContain("EXTERNAL");
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
