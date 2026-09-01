import { describe, expect, it } from "vitest";

import {
  filterNavigation,
  firstLeafPath,
  flattenNavigation,
  NAVIGATION,
  requirementForPath,
} from "@/config/navigation";
import type { Permission } from "@/config/permissions";

/**
 * Filtrage de la navigation.
 *
 * Ces tests travaillent sur des ensembles de permissions écrits à la main : ils
 * vérifient la MÉCANIQUE de filtrage. Que ces ensembles correspondent aux rôles
 * réels est une autre question, vérifiée contre la base dans
 * `tests/integration/navigation.test.ts` — un test qui ne lirait que ce fichier
 * validerait le filtre contre ses propres hypothèses.
 */

const permissionsOf = (...permissions: Permission[]): ReadonlySet<Permission> =>
  new Set(permissions);

function idsOf(granted: ReadonlySet<Permission>): string[] {
  return flattenNavigation(filterNavigation(NAVIGATION, granted)).map((item) => item.id);
}

describe("filterNavigation", () => {
  it("ne rend RIEN de plus que ce que les permissions autorisent", () => {
    const ids = idsOf(permissionsOf());
    // Sans aucune permission, seule « Mes tâches » subsiste : elle est déclarée
    // toujours visible.
    expect(ids).toEqual(["my-tasks"]);
  });

  it("ouvre le tableau de bord sur dashboard.view_all OU occurrence.read", () => {
    expect(idsOf(permissionsOf("dashboard.view_all"))).toContain("dashboard");
    expect(idsOf(permissionsOf("occurrence.read"))).toContain("dashboard");
    expect(idsOf(permissionsOf("user.manage"))).not.toContain("dashboard");
  });

  it("masque un groupe dont aucun enfant n'est autorisé", () => {
    expect(idsOf(permissionsOf("occurrence.read"))).not.toContain("admin");
  });

  it("conserve un groupe dès qu'un seul enfant survit", () => {
    // audit.read seul : la condition du groupe Administration n'est pas
    // satisfaite, mais son enfant « Journal d'audit » l'est.
    const ids = idsOf(permissionsOf("audit.read"));
    expect(ids).toContain("admin");
    expect(ids).toContain("audit");
    expect(ids).not.toContain("admin-users");
  });

  it("ne laisse jamais un enfant non autorisé dans un groupe autorisé", () => {
    const items = filterNavigation(NAVIGATION, permissionsOf("user.manage"));
    const admin = items.find((item) => item.id === "admin");
    expect(admin?.children?.map((child) => child.id)).toEqual(["admin-users"]);
  });

  it("rend un objet NEUF, sans muter l'arbre source", () => {
    const before = JSON.stringify(NAVIGATION);
    filterNavigation(NAVIGATION, permissionsOf("user.manage"));
    expect(JSON.stringify(NAVIGATION)).toBe(before);
  });
});

describe("firstLeafPath", () => {
  const landing = (...permissions: Permission[]) =>
    firstLeafPath(filterNavigation(NAVIGATION, permissionsOf(...permissions)));

  it("dépose un profil métier sur son tableau de bord", () => {
    expect(landing("occurrence.read", "obligation.read")).toBe("/dashboard");
  });

  it("dépose un ADMIN ailleurs : il n'a pas de tableau de bord", () => {
    // Le jeu de permissions d'ADMIN, tel que la matrice le donne. Le test
    // d'intégration vérifie que ce jeu est bien celui de la base.
    const path = landing(
      "obligation.read",
      "referential.manage",
      "audit.read",
      "user.manage",
      "role.manage",
      "settings.manage",
    );

    expect(path).not.toBe("/dashboard");
    expect(path).toBe("/mes-taches");
  });

  it("ne renvoie jamais vers un groupe, qui n'est pas une page", () => {
    expect(landing("user.manage")).not.toBe("/admin");
  });

  it("retombe sur /my-tasks quand rien n'est ouvert", () => {
    expect(firstLeafPath([])).toBe("/mes-taches");
  });
});

describe("requirementForPath", () => {
  it("retrouve la condition d'une section, enfants compris", () => {
    expect(requirementForPath("/echeancier")).toEqual({
      kind: "all",
      permissions: ["occurrence.read"],
    });
    expect(requirementForPath("/admin/users")).toEqual({
      kind: "all",
      permissions: ["user.manage"],
    });
  });

  it("rend null pour un chemin hors sommaire", () => {
    expect(requirementForPath("/profile")).toBeNull();
  });
});

describe("cohérence de l'arbre", () => {
  it("n'a ni identifiant ni chemin en double", () => {
    const all = flattenNavigation(NAVIGATION);
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    expect(new Set(all.map((item) => item.href)).size).toBe(all.length);
  });

  it("ne déclare que des chemins absolus, sans préfixe de locale", () => {
    for (const item of flattenNavigation(NAVIGATION)) {
      expect(item.href.startsWith("/")).toBe(true);
      // `/fr/...` trahirait une locale codée en dur dans l'arbre.
      expect(item.href).not.toMatch(/^\/(fr|ar)(\/|$)/);
    }
  });
});
