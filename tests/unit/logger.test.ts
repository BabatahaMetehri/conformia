import { describe, expect, it } from "vitest";

import { REDACTED, redact } from "@/lib/logger";

describe("redact — masquage des champs sensibles", () => {
  it("masque les mots listés au premier niveau", () => {
    expect(
      redact({
        password: "hunter2",
        token: "abc",
        secret: "s3cr3t",
        authorization: "Bearer xyz",
        cookie: "sid=1",
      }),
    ).toEqual({
      password: REDACTED,
      token: REDACTED,
      secret: REDACTED,
      authorization: REDACTED,
      cookie: REDACTED,
    });
  });

  it("masque quelle que soit la convention de nommage", () => {
    const result = redact({
      apiKey: "a",
      api_key: "b",
      "x-api-key": "c",
      SUPABASE_SERVICE_ROLE_KEY: "d",
      accessToken: "e",
      userPassword: "f",
    });
    expect(Object.values(result).every((value) => value === REDACTED)).toBe(true);
  });

  it("masque à n'importe quelle profondeur", () => {
    expect(
      redact({
        request: {
          headers: {
            authorization: "Bearer xyz",
            "user-agent": "vitest",
          },
          body: { nested: { deeper: { apiKey: "leak" } } },
        },
      }),
    ).toEqual({
      request: {
        headers: { authorization: REDACTED, "user-agent": "vitest" },
        body: { nested: { deeper: { apiKey: REDACTED } } },
      },
    });
  });

  it("masque à l'intérieur des tableaux", () => {
    expect(redact({ users: [{ id: "1", token: "t" }, { id: "2" }] })).toEqual({
      users: [{ id: "1", token: REDACTED }, { id: "2" }],
    });
  });

  it("laisse intacts les champs non sensibles", () => {
    const context = {
      userId: "u-1",
      occurrenceId: "o-1",
      period: "2026-01",
      count: 3,
      done: false,
      missing: null,
    };
    expect(redact(context)).toEqual(context);
  });

  it("masque volontairement tout champ contenant le mot « key »", () => {
    // Comportement documenté : sur-masquer plutôt que fuir. Les champs non
    // secrets doivent donc éviter le suffixe `Key`.
    expect(redact({ foreignKey: "fk-1", idempotencyKey: "idem-1" })).toEqual({
      foreignKey: REDACTED,
      idempotencyKey: REDACTED,
    });
  });
});

describe("redact — structures particulières", () => {
  it("sérialise les dates en ISO plutôt qu'en objet vide", () => {
    expect(redact({ at: new Date("2026-01-15T10:00:00Z") })).toEqual({
      at: "2026-01-15T10:00:00.000Z",
    });
  });

  it("réduit une Error à son nom et son message, sans pile", () => {
    const result = redact({ error: new TypeError("cassé") });
    expect(result).toEqual({ error: { name: "TypeError", message: "cassé" } });
    expect(JSON.stringify(result)).not.toContain("stack");
  });

  it("survit à une référence circulaire", () => {
    const node: Record<string, unknown> = { id: "1" };
    node["self"] = node;
    expect(redact({ node })).toEqual({ node: { id: "1", self: "[circular]" } });
  });

  it("parcourt les Map et les Set", () => {
    expect(
      redact({
        fromMap: new Map<string, unknown>([
          ["token", "t"],
          ["id", "1"],
        ]),
        fromSet: new Set(["a", "b"]),
      }),
    ).toEqual({
      fromMap: { token: REDACTED, id: "1" },
      fromSet: ["a", "b"],
    });
  });

  it("borne la profondeur d'exploration", () => {
    let deep: Record<string, unknown> = { value: "fond" };
    for (let index = 0; index < 15; index += 1) {
      deep = { nested: deep };
    }
    expect(JSON.stringify(redact(deep))).toContain("[max-depth]");
  });

  it("accepte un contexte vide", () => {
    expect(redact({})).toEqual({});
  });
});
