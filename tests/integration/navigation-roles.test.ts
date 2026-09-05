// @vitest-environment node

/**
 * LE SOMMAIRE, RÔLE PAR RÔLE — LES SEPT, SANS EXCEPTION.
 *
 * ⚠️ UN TABLEAU DE CORRESPONDANCE, PAS UNE RÈGLE REJOUÉE. Le tableau ci-dessous
 * ÉNUMÈRE ce que chaque rôle doit voir. Il ne recalcule pas la condition de
 * visibilité : la recalculer reviendrait à écrire une seconde fois la règle
 * qu'on prétend éprouver, et deux formulations d'une même règle finissent
 * toujours par diverger — c'est alors la moins stricte qui gagne, en silence.
 *
 * Le tableau est donc une DÉCISION, écrite noir sur blanc — et il fait
 * RÉFÉRENCE. Ce qu'il énonce a été arbitré : voir `docs/security.md`, sections
 * « Ce que la Direction administre » et « Qui peut déléguer ». Modifier une
 * permission dans la matrice de rôles fait échouer ce fichier, et l'échec
 * réclame alors une décision explicite plutôt qu'un ajustement du tableau.
 *
 * ⚠️ LES PERMISSIONS SONT LUES DANS LA BASE, sous l'identité de chaque compte,
 * par `public.has_permission()` — la fonction dont dépendent les politiques RLS.
 * Rejouer la jointure à la main donnerait une seconde définition de « qui a le
 * droit de quoi », et c'est celle-là qui finirait par être fausse.
 *
 * Prérequis : `supabase start`. Lancement : `npm run test:rls`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { filterNavigation, flattenNavigation, NAVIGATION } from "@/config/navigation";
import { isPermission, type Permission } from "@/config/permissions";

import {
  ACTIVE_ROLES,
  createTestScope,
  destroyTestScope,
  type ActiveRole,
  type TestScope,
} from "../helpers/test-scope";

let scope: TestScope;

/** Un compte par rôle, créé une seule fois. */
const comptes = new Map<ActiveRole, string>();

async function permissionsOf(userId: string): Promise<ReadonlySet<Permission>> {
  const rows = await scope.asUser(userId, async (client) => {
    const result = await client.query<{ code: string }>(
      "select code from public.permissions where public.has_permission(code)",
    );
    return result.rows;
  });
  return new Set(rows.map((row) => row.code).filter(isPermission));
}

/** Identifiants des entrées visibles, groupes compris, pour ce rôle. */
async function sommaireDe(role: ActiveRole): Promise<string[]> {
  const granted = await permissionsOf(comptes.get(role) ?? "");
  return flattenNavigation(filterNavigation(NAVIGATION, granted)).map((item) => item.id);
}

async function detient(role: ActiveRole, permission: Permission): Promise<boolean> {
  const granted = await permissionsOf(comptes.get(role) ?? "");
  return granted.has(permission);
}

beforeAll(async () => {
  scope = await createTestScope();
  for (const role of ACTIVE_ROLES) {
    /*
     * ⚠️ UN DOMAINE EST DONNÉ AUX RÔLES QUI EN PRENNENT UN. Sans domaine, une
     * attribution reste valide mais ne porte sur rien : la lecture des
     * permissions rendrait un ensemble vide, et le sommaire serait faux pour une
     * raison qui n'est pas celle qu'on éprouve.
     */
    comptes.set(role, await scope.createUserWithRole(role, "FISCAL"));
  }
}, 120_000);

afterAll(async () => {
  await destroyTestScope(scope);
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════

/**
 * CE QUE CHAQUE RÔLE DOIT VOIR — ET RIEN D'AUTRE.
 *
 * Les listes sont EXHAUSTIVES : on compare des ensembles complets, pas des
 * présences isolées. Un simple « contient » laisserait passer l'entrée de trop,
 * c'est-à-dire précisément la faute qu'un sommaire peut commettre.
 */
const ATTENDU: Readonly<Record<ActiveRole, readonly string[]>> = {
  /*
   * ⚠️ ADMIN NE VOIT NI ÉCHÉANCIER, NI DOCUMENTS, NI À VALIDER, NI TABLEAU DE
   * BORD. Ce n'est pas un oubli : l'administration technique et le contenu
   * métier sont séparés. Un administrateur ouvre des comptes ; il ne lit pas les
   * déclarations fiscales de l'entreprise.
   *
   * Il voit en revanche le Référentiel et les Registres : ce sont les objets
   * qu'il ADMINISTRE, et non des dossiers.
   */
  ADMIN: [
    "my-tasks",
    "obligations",
    "registers",
    "absences",
    "admin",
    "admin-users",
    "admin-roles",
    "admin-delegations",
    "admin-referentials",
    "admin-notifications",
    "admin-settings",
    "admin-jobs",
    "admin-purge",
    "audit",
  ],

  /*
   * ⚠️ DIRECTION ADMINISTRE LE RÉFÉRENTIEL, ET C'EST DÉLIBÉRÉ.
   *
   * Le référentiel des obligations est du CONTENU MÉTIER, pas de la configuration
   * technique : ajouter une obligation ou corriger une échéance relève de la
   * Direction, qui doit pouvoir le faire sans passer par un administrateur. Le
   * lui interdire produirait le contournement habituel — on demande son mot de
   * passe à l'administrateur.
   *
   * Elle voit aussi les DÉLÉGATIONS parce qu'elle détient `occurrence.validate` :
   * on ne délègue que ce que l'on détient.
   *
   * ⚠️ Ce qu'elle ne voit PAS : Utilisateurs et Rôles. Elle surveille et décide,
   * elle n'ouvre pas de comptes.
   */
  DIRECTION: [
    "dashboard",
    "my-tasks",
    "occurrences",
    "validation",
    "obligations",
    "registers",
    "absences",
    "documents",
    "reports",
    "admin",
    "admin-delegations",
    "admin-referentials",
    "audit",
  ],

  /*
   * ⚠️ RESPONSABLE ET SUPPLÉANT VOIENT RIGOUREUSEMENT LE MÊME SOMMAIRE. Le
   * suppléant n'est pas un rôle diminué : il porte le dossier quand le
   * responsable est absent, et un sommaire amputé le lui apprendrait au pire
   * moment. Ce qui les sépare est une colonne du dossier, pas une entrée de menu.
   */
  RESPONSABLE: [
    "dashboard",
    "my-tasks",
    "occurrences",
    "obligations",
    "registers",
    "absences",
    "documents",
    "reports",
  ],
  SUPPLEANT: [
    "dashboard",
    "my-tasks",
    "occurrences",
    "obligations",
    "registers",
    "absences",
    "documents",
    "reports",
  ],

  /*
   * ⚠️ SUPERVISEUR VOIT « À VALIDER », LE RESPONSABLE NON. C'est la séparation
   * des pouvoirs rendue visible : qui prépare ne valide pas. Administration ne
   * lui apparaît que pour les délégations — on ne délègue que ce que l'on détient.
   */
  SUPERVISEUR: [
    "dashboard",
    "my-tasks",
    "occurrences",
    "validation",
    "obligations",
    "registers",
    "absences",
    "documents",
    "reports",
    "admin",
    "admin-delegations",
  ],

  /** L'auditeur lit, et ne fait que lire — y compris le journal. */
  AUDITOR: [
    "dashboard",
    "my-tasks",
    "occurrences",
    "obligations",
    "registers",
    "absences",
    "documents",
    "reports",
    "admin",
    "audit",
  ],

  /**
   * L'intervenant EXTERNE — un cabinet comptable — n'a rien d'administratif et
   * ne produit aucun export. La RLS borne ce qu'il LIT aux dossiers qui lui sont
   * confiés ; le sommaire, lui, ne masque pas les sections correspondantes — les
   * masquer ferait croire à une application différente plutôt qu'à un périmètre
   * plus étroit.
   */
  EXTERNAL: [
    "dashboard",
    "my-tasks",
    "occurrences",
    "obligations",
    "registers",
    "absences",
    "documents",
  ],
};

describe("sommaire par rôle — les sept rôles attribuables", () => {
  it.each([...ACTIVE_ROLES])("%s voit EXACTEMENT ce qui lui est déclaré", async (role) => {
    expect(await sommaireDe(role)).toEqual([...ATTENDU[role]]);
  });

  it("le tableau couvre les sept rôles, sans oubli ni surplus", () => {
    /*
     * ⚠️ SÉCURITÉ DU TEST LUI-MÊME. Un rôle ajouté à la matrice sans être ajouté
     * ici ne serait éprouvé par rien, et le fichier resterait vert — ce qui est
     * pire que rouge : il affirmerait une couverture qu'il n'a pas.
     */
    expect(Object.keys(ATTENDU).sort()).toEqual([...ACTIVE_ROLES].sort());
  });
});

describe("les cas contre-intuitifs, nommés", () => {
  it("ADMIN ne voit ni Échéancier, ni Documents, ni À valider, ni Tableau de bord", async () => {
    const ids = await sommaireDe("ADMIN");
    for (const absent of ["occurrences", "documents", "validation", "dashboard"]) {
      expect(ids, absent).not.toContain(absent);
    }
  });

  it("DIRECTION administre le référentiel, mais ni Utilisateurs ni Rôles", async () => {
    const ids = await sommaireDe("DIRECTION");
    expect(ids).toContain("admin");
    expect(ids).toContain("audit");
    // Le référentiel est du contenu métier : la Direction l'administre.
    expect(ids).toContain("admin-referentials");
    // Les comptes et les rôles, non : elle surveille, elle n'administre pas.
    expect(ids).not.toContain("admin-users");
    expect(ids).not.toContain("admin-roles");

    /*
     * Et le lien du groupe mène à son PREMIER enfant accessible — les
     * délégations, ici. Le `href` déclaré (`/admin`) conduirait à un écran que la
     * garde de route lui refuserait : le sommaire proposerait une porte fermée.
     */
    const granted = await permissionsOf(comptes.get("DIRECTION") ?? "");
    const groupe = filterNavigation(NAVIGATION, granted).find((item) => item.id === "admin");
    expect(groupe?.href).toBe("/admin/delegations");
  });

  it("RESPONSABLE et SUPPLEANT voient rigoureusement le MÊME sommaire", async () => {
    expect(await sommaireDe("SUPPLEANT")).toEqual(await sommaireDe("RESPONSABLE"));
  });

  it("SUPERVISEUR voit « À valider », RESPONSABLE ne le voit pas", async () => {
    expect(await sommaireDe("SUPERVISEUR")).toContain("validation");
    expect(await sommaireDe("RESPONSABLE")).not.toContain("validation");
  });

  it("seuls ADMIN et DIRECTION tiennent les registres EN ÉCRITURE", async () => {
    /*
     * ⚠️ LA DISTINCTION N'EST PAS DANS LE SOMMAIRE, ET C'EST VOULU. L'entrée
     * « Registres » est ouverte à quiconque suit des échéances : savoir de quel
     * établissement relève un dossier fait partie du travail. C'est l'ÉCRITURE
     * qui est réservée — un registre de commerce n'est pas une donnée qu'un
     * préparateur corrige au passage.
     */
    for (const role of ACTIVE_ROLES) {
      const attendu = role === "ADMIN" || role === "DIRECTION";
      expect(await detient(role, "register.manage"), role).toBe(attendu);
    }

    // La lecture, elle, suit l'entrée de sommaire : ouverte au-delà de ces deux.
    expect(await sommaireDe("RESPONSABLE")).toContain("registers");
  });
});

/**
 * QUI PEUT DÉLÉGUER — ET POUR QUI.
 *
 * ⚠️ LA PORTE EST `occurrence.validate`, ET C'EST LA BONNE. Une délégation dit
 * « je délègue MON pouvoir de validation pendant mon absence » : celui qui peut
 * valider est exactement celui qui peut déléguer. L'énoncé initial du module de
 * validation la plaçait sous `role.manage`, donc réservée à l'administrateur —
 * c'était une erreur : elle imposait un délai administratif à un mécanisme dont
 * la raison d'être est précisément d'éviter un blocage, et produisait le
 * contournement qu'on connaît, le prêt de mot de passe.
 *
 * On l'éprouve ici plutôt que de la laisser en état de fait.
 */
describe("délégation : la porte et son périmètre", () => {
  /** Tente l'insertion SOUS L'IDENTITÉ de l'appelant : c'est la RLS qui tranche. */
  async function tenteDelegation(auteur: ActiveRole, delegant: ActiveRole): Promise<boolean> {
    const auteurId = comptes.get(auteur) ?? "";
    const delegantId = comptes.get(delegant) ?? "";
    const delegataire = comptes.get("SUPPLEANT") ?? "";

    return scope.asUser(auteurId, async (client) => {
      try {
        await client.query(
          `insert into public.validation_delegations
             (entity_id, delegator_id, delegate_id, starts_at, ends_at, reason, created_by)
           values ($1, $2, $3, current_date, current_date + 5, 'Congé annuel du responsable', $4)`,
          [scope.entityId, delegantId, delegataire, auteurId],
        );
        return true;
      } catch {
        return false;
      }
    });
  }

  it("la porte du sommaire est `occurrence.validate`, pas `role.manage`", async () => {
    /*
     * ⚠️ VÉRIFIÉ SUR LES SEPT RÔLES, et non sur un exemple. L'entrée apparaît à
     * qui peut valider ou qui gère les comptes — et à personne d'autre. Un
     * SUPERVISEUR sans `role.manage` doit la voir ; c'est tout le propos.
     */
    for (const role of ACTIVE_ROLES) {
      const granted = await permissionsOf(comptes.get(role) ?? "");
      const attendu = granted.has("occurrence.validate") || granted.has("user.manage");
      expect((await sommaireDe(role)).includes("admin-delegations"), role).toBe(attendu);
    }

    // Et le SUPERVISEUR, qui n'administre rien, la voit bien.
    const superviseur = await permissionsOf(comptes.get("SUPERVISEUR") ?? "");
    expect(superviseur.has("role.manage")).toBe(false);
    expect(await sommaireDe("SUPERVISEUR")).toContain("admin-delegations");
  });

  it("un SUPERVISEUR crée sa PROPRE délégation", async () => {
    expect(await tenteDelegation("SUPERVISEUR", "SUPERVISEUR")).toBe(true);
  });

  it("il ne délègue PAS le pouvoir d'un autre", async () => {
    /*
     * ⚠️ ON NE DÉLÈGUE QUE CE QUE L'ON DÉTIENT. Insérer pour autrui reviendrait
     * à disposer du pouvoir d'un tiers sans qu'il l'ait consenti — et la trace
     * d'audit désignerait le délégant, pas l'auteur.
     */
    expect(await tenteDelegation("SUPERVISEUR", "DIRECTION")).toBe(false);
  });

  it("MÊME un ADMIN ne délègue pas à la place d'autrui", async () => {
    /*
     * ⚠️ PLUS STRICT QUE L'ARBITRAGE NE LE SUPPOSAIT, et c'est défendable. La
     * politique `validation_delegations_insert` n'ouvre AUCUNE exception : ni
     * `user.manage`, ni `absence.manage`. Le consentement du délégant n'est pas
     * délégable ; un administrateur qui arrangerait l'autorité d'un tiers ferait
     * exactement ce que ce mécanisme existe pour éviter.
     *
     * L'exception `user.manage` existe bien, mais sur la LECTURE et la
     * RÉVOCATION : on peut défaire une délégation d'autrui, jamais la consentir.
     */
    expect(await tenteDelegation("ADMIN", "SUPERVISEUR")).toBe(false);

    const admin = await permissionsOf(comptes.get("ADMIN") ?? "");
    expect(admin.has("user.manage")).toBe(true);
  });
});

describe("invariants du sommaire", () => {
  it("aucun groupe VIDE n'est proposé, pour aucun rôle", async () => {
    /*
     * ⚠️ LA RÈGLE CORRIGÉE. Un groupe était visible dès qu'il satisfaisait sa
     * PROPRE condition — laquelle résume ses enfants sans se superposer à eux.
     * On pouvait donc ouvrir un dossier qui ne menait à rien. Un sommaire qui
     * propose une porte sans pièce derrière apprend à se méfier du sommaire.
     */
    for (const role of ACTIVE_ROLES) {
      const granted = await permissionsOf(comptes.get(role) ?? "");
      for (const item of flattenNavigation(filterNavigation(NAVIGATION, granted))) {
        if (item.children === undefined) continue;
        expect(item.children.length, `${role} / ${item.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("le lien d'un groupe mène TOUJOURS à un enfant réellement visible", async () => {
    for (const role of ACTIVE_ROLES) {
      const granted = await permissionsOf(comptes.get(role) ?? "");
      const arbre = filterNavigation(NAVIGATION, granted);

      for (const item of flattenNavigation(arbre)) {
        if (item.children === undefined) continue;
        const destinations = flattenNavigation(item.children)
          .filter((enfant) => enfant.children === undefined)
          .map((enfant) => enfant.href);
        expect(destinations, `${role} / ${item.id}`).toContain(item.href);
      }
    }
  });
});
