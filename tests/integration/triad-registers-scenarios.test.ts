// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateOccurrences } from "@/services/scheduling/generator";

import { createTestScope, destroyTestScope, type TestScope } from "../helpers/test-scope";

/**
 * SCÉNARIOS ISSUS DE LA TRIADE ET DES REGISTRES — migrations 0018 et 0019.
 *
 * ⚠️ CE FICHIER EST LE PREMIER ÉCRIT ENTIÈREMENT SUR `createTestScope()`, et il
 * sert de modèle aux suivants. Rien de ce qu'il affirme ne dépend de l'état
 * initial de la base : chaque comptage est borné à l'entité que le fichier a
 * créée, si bien qu'il donne le même verdict sur une base vide, sur une base
 * chargée du référentiel AGROESPACE, et au deuxième lancement d'affilée.
 *
 * Les six scénarios couverts sont ceux qu'aucun test ne tenait encore :
 *
 *   1. une obligation PER_REGISTER avec trois registres produit trois dossiers
 *      par période — le défaut de comptage le plus coûteux, puisqu'il se
 *      découvre au moment où l'on compte les déclarations déposées ;
 *   2. un registre RADIÉ cesse de produire SANS effacer ce qu'il a produit ;
 *   3. le suppléant prépare, et ne valide pas ;
 *   4. une transition faite par le suppléant porte `acted_as = 'SUPPLEANT'` ;
 *   5. une absence déclarée ne change AUCUNE permission ;
 *   6. le superviseur qui a préparé ne peut pas valider — le contrôle porte sur
 *      l'acte, pas sur le rôle.
 */

let scope: TestScope;

beforeAll(async () => {
  scope = await createTestScope();
}, 120_000);

afterAll(async () => {
  await destroyTestScope(scope);
}, 120_000);

// ═════════════════════════════════════════════════════════════════════════════

describe("génération par registre", () => {
  it("trois registres actifs produisent trois dossiers par période", async () => {
    const obligation = await scope.createObligation({
      scope: "PER_REGISTER",
      periodicity: "ANNUAL",
      domain: "REGLEMENTAIRE",
      dueRule: { anchor: "PERIOD_END", offset_days: 30 },
    });

    await scope.createRegister({ registerType: "PRINCIPAL" });
    await scope.createRegister();
    await scope.createRegister();

    const report = await generateOccurrences(scope.admin, obligation, 24);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.failed).toBe(0);

    /*
     * ⚠️ On compte PAR PÉRIODE, et l'assertion porte sur l'entité du test.
     * Compter le total dirait « il y a des dossiers » ; compter par période dit
     * « il y en a exactement un par établissement », qui est la règle.
     */
    const { rows } = await scope.pool.query<{ period_key: string; n: number }>(
      `select period_key, count(*)::int as n
         from public.obligation_occurrences
        where entity_id = $1 and obligation_type_id = $2
        group by period_key order by period_key`,
      [scope.entityId, obligation],
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.n, `période ${row.period_key}`).toBe(3);
    }

    // Et chaque dossier d'une période vise un registre DIFFÉRENT : trois
    // dossiers pointant le même établissement seraient un doublon, pas une
    // couverture.
    const { rows: distincts } = await scope.pool.query<{ period_key: string; n: number }>(
      `select period_key, count(distinct commercial_register_id)::int as n
         from public.obligation_occurrences
        where entity_id = $1 and obligation_type_id = $2
        group by period_key`,
      [scope.entityId, obligation],
    );
    for (const row of distincts) {
      expect(row.n, `période ${row.period_key}`).toBe(3);
    }
  }, 120_000);

  it("un registre RADIÉ cesse de produire, sans effacer ce qu'il a produit", async () => {
    const obligation = await scope.createObligation({
      scope: "PER_REGISTER",
      periodicity: "ANNUAL",
      domain: "REGLEMENTAIRE",
      dueRule: { anchor: "PERIOD_END", offset_days: 30 },
    });

    await scope.createRegister();
    await scope.createRegister();
    const condamne = await scope.createRegister();

    const premier = await generateOccurrences(scope.admin, obligation, 24);
    expect(premier.ok).toBe(true);

    const avant = await scope.pool.query<{ n: number }>(
      `select count(*)::int as n from public.obligation_occurrences
        where entity_id = $1 and obligation_type_id = $2 and commercial_register_id = $3`,
      [scope.entityId, obligation, condamne],
    );
    expect(avant.rows[0]?.n ?? 0).toBeGreaterThan(0);

    await scope.pool.query(
      "update public.commercial_registers set status = 'RADIE' where id = $1",
      [condamne],
    );

    /*
     * ⚠️ On génère sur un horizon PLUS LOIN, sans quoi l'idempotence suffirait
     * à expliquer l'absence de nouveaux dossiers et le test ne prouverait rien.
     */
    const second = await generateOccurrences(scope.admin, obligation, 48);
    expect(second.ok).toBe(true);

    const apres = await scope.pool.query<{ actifs: number; radie: number }>(
      `select
         count(*) filter (where cr.status = 'ACTIF')::int as actifs,
         count(*) filter (where cr.status = 'RADIE')::int as radie
       from public.obligation_occurrences oc
       join public.commercial_registers cr on cr.id = oc.commercial_register_id
      where oc.entity_id = $1 and oc.obligation_type_id = $2`,
      [scope.entityId, obligation],
    );

    // Les dossiers du registre radié SURVIVENT : une radiation arrête l'avenir,
    // elle ne réécrit pas le passé — les déclarations déposées ont existé.
    expect(apres.rows[0]?.radie ?? 0).toBe(avant.rows[0]?.n ?? 0);
    expect(apres.rows[0]?.actifs ?? 0).toBeGreaterThan(0);
  }, 120_000);
});

// ═════════════════════════════════════════════════════════════════════════════

describe("le suppléant prépare, il ne valide pas", () => {
  it("il prend en charge un dossier comme le ferait le responsable", async () => {
    const suppleant = await scope.createUserWithRole("SUPPLEANT");
    const obligation = await scope.createObligation();
    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "2026-04",
      status: "TODO",
      deputyId: suppleant,
    });

    await scope.asUser(suppleant, async (client) => {
      const result = await client.query(
        "update public.obligation_occurrences set status = 'IN_PROGRESS' where id = $1",
        [dossier],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it("il ne valide pas, faute d'occurrence.validate", async () => {
    const suppleant = await scope.createUserWithRole("SUPPLEANT");
    const responsable = await scope.createUserWithRole("RESPONSABLE");
    const obligation = await scope.createObligation();
    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "2026-05",
      status: "PENDING_VALIDATION",
      ownerId: responsable,
      submittedForValidationAt: new Date().toISOString(),
    });

    await scope.asUser(suppleant, async (client) => {
      await expect(
        client.query(
          "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
          [dossier],
        ),
      ).rejects.toThrow();
    });
  });

  it("ses permissions sont EXACTEMENT celles du responsable", async () => {
    const responsable = await scope.createUserWithRole("RESPONSABLE");
    const suppleant = await scope.createUserWithRole("SUPPLEANT");

    const lire = async (userId: string): Promise<string[]> =>
      scope.asUser(userId, async (client) => {
        const { rows } = await client.query<{ code: string }>(
          "select code from public.permissions where public.has_permission(code) order by code",
        );
        return rows.map((row) => row.code);
      });

    const droitsResponsable = await lire(responsable);
    const droitsSuppleant = await lire(suppleant);

    expect(droitsSuppleant).toEqual(droitsResponsable);
    expect(droitsSuppleant.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("la trace dit à quel titre on a agi", () => {
  it("une transition faite par le suppléant porte acted_as = SUPPLEANT", async () => {
    const suppleant = await scope.createUserWithRole("SUPPLEANT");
    const obligation = await scope.createObligation();
    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "2026-06",
      status: "TODO",
      deputyId: suppleant,
    });

    /*
     * ⚠️ La transition est faite HORS transaction annulée, parce qu'on doit
     * relire la trace qu'elle a produite. `conformia.actor_id` porte l'acteur :
     * c'est le paramètre que lit `app_actor_id()`, et donc `record_status_transition`.
     */
    const client = await scope.pool.connect();
    try {
      await client.query("select set_config('conformia.actor_id', $1, false)", [suppleant]);
      await client.query(
        "update public.obligation_occurrences set status = 'IN_PROGRESS' where id = $1",
        [dossier],
      );
    } finally {
      await client
        .query("select set_config('conformia.actor_id', '', false)")
        .catch(() => undefined);
      client.release();
    }

    const { rows } = await scope.pool.query<{ acted_as: string | null; actor_id: string }>(
      `select acted_as, actor_id from public.occurrence_transitions
        where occurrence_id = $1 order by created_at desc limit 1`,
      [dossier],
    );

    expect(rows[0]?.actor_id).toBe(suppleant);
    // La relation au dossier prime sur le rôle global : cette personne est LE
    // suppléant de CE dossier, et la trace doit le dire.
    expect(rows[0]?.acted_as).toBe("SUPPLEANT");
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("une absence n'accorde ni ne retire aucun droit", () => {
  it("les permissions du suppléant sont identiques, absence déclarée ou non", async () => {
    const responsable = await scope.createUserWithRole("RESPONSABLE");
    const suppleant = await scope.createUserWithRole("SUPPLEANT");

    const lire = async (): Promise<string[]> =>
      scope.asUser(suppleant, async (client) => {
        const { rows } = await client.query<{ code: string }>(
          "select code from public.permissions where public.has_permission(code) order by code",
        );
        return rows.map((row) => row.code);
      });

    const avant = await lire();
    await scope.createAbsence({ userId: responsable });
    const apres = await lire();

    /*
     * ⚠️ Une absence est une information d'ORGANISATION. Le suppléant tient ses
     * droits de son RÔLE ; les faire dépendre d'une déclaration créerait une
     * habilitation qui s'accorde et se retire hors de toute traçabilité de
     * rôle — et un dossier bloqué le jour où personne n'a pensé à déclarer.
     */
    expect(apres).toEqual(avant);
    expect(apres.length).toBeGreaterThan(0);
  });

  it("aucune politique n'interroge is_absent_on", async () => {
    const { rows } = await scope.pool.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public'
          and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%is_absent_on%'`,
    );
    expect(rows).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("séparation des pouvoirs : le contrôle porte sur l'acte", () => {
  it("un superviseur valide le dossier préparé par un AUTRE", async () => {
    const superviseur = await scope.createUserWithRole("SUPERVISEUR");
    const responsable = await scope.createUserWithRole("RESPONSABLE");
    const obligation = await scope.createObligation();
    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "2026-07",
      status: "PENDING_VALIDATION",
      ownerId: responsable,
      submittedForValidationAt: new Date().toISOString(),
    });

    await scope.asUser(superviseur, async (client) => {
      const result = await client.query(
        "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
        [dossier],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it("le MÊME superviseur ne valide pas le dossier qu'il a préparé", async () => {
    /*
     * ⚠️ C'EST LE CŒUR DE LA DÉCISION. Le superviseur détient `occurrence.write`
     * ET `occurrence.validate` : rien dans son RÔLE ne l'empêche d'enchaîner. Ce
     * qui l'en empêche est l'ACTE — il est le responsable de CE dossier-là.
     */
    const superviseur = await scope.createUserWithRole("SUPERVISEUR");
    const obligation = await scope.createObligation();
    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "2026-08",
      status: "PENDING_VALIDATION",
      ownerId: superviseur,
      submittedForValidationAt: new Date().toISOString(),
    });

    await scope.asUser(superviseur, async (client) => {
      await expect(
        client.query(
          "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
          [dossier],
        ),
      ).rejects.toThrow(/[Ss]éparation des tâches/);
    });
  });

  it("le superviseur SUPPLÉANT d'un dossier ne le valide pas davantage", async () => {
    const superviseur = await scope.createUserWithRole("SUPERVISEUR");
    const responsable = await scope.createUserWithRole("RESPONSABLE");
    const obligation = await scope.createObligation();
    const dossier = await scope.createOccurrence({
      obligationId: obligation,
      periodKey: "2026-09",
      status: "PENDING_VALIDATION",
      ownerId: responsable,
      deputyId: superviseur,
      submittedForValidationAt: new Date().toISOString(),
    });

    await scope.asUser(superviseur, async (client) => {
      await expect(
        client.query(
          "update public.obligation_occurrences set status = 'VALIDATED' where id = $1",
          [dossier],
        ),
      ).rejects.toThrow(/[Ss]éparation des tâches/);
    });
  });
});
