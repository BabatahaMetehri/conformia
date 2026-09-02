// @vitest-environment node

import { describe, expect, it } from "vitest";

import { AppError, mapPostgrestError, SCRUBBED, scrubDetails, toClientError } from "@/lib/errors";

/**
 * ⚠️ AUCUNE RÉPONSE D'ERREUR NE DOIT PORTER D'INFRASTRUCTURE.
 *
 * Ni trace de pile, ni nom de table, ni requête SQL, ni chemin serveur. Ce n'est
 * pas une préférence esthétique : ces éléments décrivent la forme de la base à
 * quiconque sait provoquer une erreur, et c'est la première étape de toute
 * intrusion sérieuse.
 *
 * Le fichier `errors.ts` portait auparavant la consigne en commentaire — « ne
 * placez jamais d'information d'infrastructure dans `details` ». Une consigne
 * s'oublie un vendredi. Ces tests la rendent exécutable.
 */

const BACKSLASH = String.fromCharCode(92);

/** Ce qu'un `catch` attrape réellement en production. */
const REAL_STACK = [
  "TypeError: Cannot read properties of null",
  "    at loadOccurrence (/srv/conformia/.next/server/chunks/8340.js:1:75048)",
  "    at async Object.handler (/srv/conformia/node_modules/next/dist/server/route.js:120:5)",
].join("\n");

const REAL_SQL =
  "select oc.id, oc.status from public.obligation_occurrences oc where oc.owner_id = $1";

describe("projection vers le client", () => {
  it("NE SÉRIALISE JAMAIS `cause`", () => {
    const error = AppError.internal({ cause: new Error(REAL_STACK) });
    const client = toClientError(error);

    // La forme sérialisée est ce qui part réellement dans la réponse.
    const serialised = JSON.stringify(client);
    expect(serialised).not.toContain("at loadOccurrence");
    expect(serialised).not.toContain("srv/conformia");
    expect(Object.keys(client)).not.toContain("cause");
  });

  it("rend `details` OPAQUE pour une erreur interne", () => {
    const error = AppError.internal({ cause: new Error("boom") });
    expect(toClientError(error).details).toBeUndefined();
  });

  it("ne porte qu'une CLÉ i18n comme message, jamais une phrase technique", () => {
    for (const error of [
      AppError.internal(),
      AppError.forbidden(),
      AppError.notFound("occurrence", "abc"),
      AppError.conflict(),
      mapPostgrestError({ code: "23505", message: REAL_SQL, details: "", hint: "" }),
    ]) {
      expect(toClientError(error).message).toMatch(/^errors\.[a-zA-Z]+$/);
    }
  });

  it("une erreur Postgres ne laisse passer que son CODE", () => {
    const error = mapPostgrestError({
      code: "23505",
      message: `duplicate key value violates unique constraint "obligation_types_code_key"`,
      details: `Key (code)=(G50) already exists in public.obligation_types.`,
      hint: "",
    });

    const serialised = JSON.stringify(toClientError(error));
    expect(serialised).toContain("23505");
    expect(serialised).not.toContain("obligation_types");
    expect(serialised).not.toContain("G50");
  });
});

describe("nettoyage des détails", () => {
  it("EFFACE UNE TRACE DE PILE", () => {
    const cleaned = scrubDetails({ hint: REAL_STACK });
    expect(cleaned["hint"]).toBe(SCRUBBED);
  });

  it("EFFACE UN FRAGMENT SQL", () => {
    expect(scrubDetails({ query: REAL_SQL })["query"]).toBe(SCRUBBED);
    expect(scrubDetails({ q: "insert into documents (id) values ($1)" })["q"]).toBe(SCRUBBED);
  });

  it("EFFACE UN CHEMIN SERVEUR, POSIX comme Windows", () => {
    expect(scrubDetails({ path: "/var/www/conformia/app.js" })["path"]).toBe(SCRUBBED);
    expect(scrubDetails({ path: `C:${BACKSLASH}Users${BACKSLASH}app` })["path"]).toBe(SCRUBBED);
    expect(scrubDetails({ path: `node_modules${BACKSLASH}next` })["path"]).toBe(SCRUBBED);
    expect(scrubDetails({ path: "node_modules/next/dist" })["path"]).toBe(SCRUBBED);
  });

  it("EFFACE UN NOM D'OBJET POSTGRES", () => {
    expect(scrubDetails({ detail: "public.obligation_occurrences" })["detail"]).toBe(SCRUBBED);
    expect(scrubDetails({ detail: "pg_catalog" })["detail"]).toBe(SCRUBBED);
  });

  it("LAISSE INTACT ce qui est utile à l'utilisateur", () => {
    // Le nettoyage doit être chirurgical : s'il emportait les messages
    // actionnables, on aurait remplacé une fuite par une interface muette.
    const cleaned = scrubDetails({
      field: "legalDueDate",
      reason: "EXPORT_EMPTY",
      dbCode: "23505",
      min: 10,
      entity: "occurrence",
      remedy: "Renseigner RESEND_API_KEY, ou passer le réglage à 'smtp'.",
    });

    expect(cleaned).toEqual({
      field: "legalDueDate",
      reason: "EXPORT_EMPTY",
      dbCode: "23505",
      min: 10,
      entity: "occurrence",
      remedy: "Renseigner RESEND_API_KEY, ou passer le réglage à 'smtp'.",
    });
  });

  it("descend dans les tableaux et les objets imbriqués", () => {
    const cleaned = scrubDetails({
      fields: [{ path: "reason", key: "validation.reasonTooShort" }],
      nested: { trace: REAL_STACK },
      list: [REAL_SQL, "valeur saine"],
    });

    expect((cleaned["nested"] as Record<string, unknown>)["trace"]).toBe(SCRUBBED);
    expect(cleaned["list"]).toEqual([SCRUBBED, "valeur saine"]);
    // Les anomalies de champ traversent intactes : elles SONT le message utile.
    expect(cleaned["fields"]).toEqual([{ path: "reason", key: "validation.reasonTooShort" }]);
  });

  it("s'arrête en profondeur plutôt que de boucler", () => {
    // Une structure anormalement profonde est déjà un défaut ; la sérialiser
    // entière ferait tourner la réponse en boucle.
    const deep = { a: { b: { c: { d: { e: { f: REAL_STACK } } } } } };
    expect(() => scrubDetails(deep)).not.toThrow();
  });
});

describe("balayage de toutes les erreurs nommées", () => {
  it("aucune ne fuit, quel que soit ce qu'on lui donne à porter", () => {
    /*
     * ⚠️ Le test qui compte : on nourrit CHAQUE constructeur nommé avec de vraies
     * traces et de vrais fragments SQL, et on vérifie la forme sérialisée. Un
     * constructeur ajouté plus tard sans précaution fera échouer ce test.
     */
    const poison = { trace: REAL_STACK, sql: REAL_SQL, path: "/etc/conformia/secret.env" };

    const errors = [
      AppError.unauthenticated({ details: poison }),
      AppError.forbidden({ details: poison }),
      AppError.notFound("occurrence", "abc", { details: poison }),
      AppError.validationFailed({ ...poison }),
      AppError.conflict({ details: poison }),
      AppError.periodLocked("2026-01", { details: poison }),
      AppError.invalidTransition("TODO", "ARCHIVED", { details: poison }),
      AppError.storageFailed("upload", { details: poison }),
      AppError.integrityCheckFailed("abc", { details: poison }),
      AppError.rateLimited(60, { details: poison }),
      AppError.externalServiceFailed("resend", { details: poison }),
      AppError.internal({ details: poison }),
    ];

    for (const error of errors) {
      const serialised = JSON.stringify(toClientError(error));

      expect(serialised, error.code).not.toContain("at loadOccurrence");
      expect(serialised, error.code).not.toContain("obligation_occurrences");
      expect(serialised, error.code).not.toContain("/etc/conformia");
      expect(serialised, error.code).not.toContain("node_modules");
      expect(serialised, error.code).not.toMatch(/\bselect\b[\s\S]*\bfrom\b/i);
    }
  });
});
