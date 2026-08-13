import { describe, expect, it } from "vitest";

import {
  AppError,
  AppErrorCode,
  HTTP_STATUS_BY_CODE,
  isAppError,
  mapPostgrestError,
  toClientError,
} from "@/lib/errors";

describe("AppError", () => {
  it("porte un code, une clé i18n et un statut HTTP", () => {
    const error = new AppError(AppErrorCode.NOT_FOUND, "errors.notFound");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("errors.notFound");
    expect(error.httpStatus).toBe(404);
  });

  it("reste une Error, donc capturable et dotée d'une pile", () => {
    const error = AppError.internal();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.stack).toBeDefined();
  });

  it("attribue à chaque code son statut HTTP", () => {
    expect(HTTP_STATUS_BY_CODE.UNAUTHENTICATED).toBe(401);
    expect(HTTP_STATUS_BY_CODE.FORBIDDEN).toBe(403);
    expect(HTTP_STATUS_BY_CODE.VALIDATION_FAILED).toBe(422);
    expect(HTTP_STATUS_BY_CODE.CONFLICT).toBe(409);
    expect(HTTP_STATUS_BY_CODE.PERIOD_LOCKED).toBe(423);
    expect(HTTP_STATUS_BY_CODE.RATE_LIMITED).toBe(429);
    expect(HTTP_STATUS_BY_CODE.INTERNAL).toBe(500);
  });

  it("accepte une surcharge explicite du statut", () => {
    expect(AppError.forbidden({ httpStatus: 404 }).httpStatus).toBe(404);
  });

  it("conserve la cause d'origine", () => {
    const cause = new Error("pg: duplicate key");
    expect(AppError.conflict({ cause }).cause).toBe(cause);
  });
});

describe("constructeurs nommés", () => {
  it("notFound renseigne l'entité et l'identifiant", () => {
    const error = AppError.notFound("obligation", "g50-2026-01");
    expect(error.code).toBe(AppErrorCode.NOT_FOUND);
    expect(error.details).toEqual({ entity: "obligation", id: "g50-2026-01" });
  });

  it("invalidTransition renseigne les deux états", () => {
    const error = AppError.invalidTransition("TODO", "SUBMITTED");
    expect(error.code).toBe(AppErrorCode.INVALID_TRANSITION);
    expect(error.details).toEqual({ from: "TODO", to: "SUBMITTED" });
  });

  it("periodLocked nomme le champ `period`, non masqué par le logger", () => {
    const error = AppError.periodLocked("2026-01");
    expect(error.code).toBe(AppErrorCode.PERIOD_LOCKED);
    expect(error.details).toEqual({ period: "2026-01" });
  });

  it("validationFailed transporte le détail des champs", () => {
    const error = AppError.validationFailed({ amount: "REQUIRED" });
    expect(error.code).toBe(AppErrorCode.VALIDATION_FAILED);
    expect(error.details).toEqual({ amount: "REQUIRED" });
  });

  it("integrityCheckFailed identifie le document", () => {
    expect(AppError.integrityCheckFailed("doc-1").details).toEqual({ documentId: "doc-1" });
  });

  it("rateLimited indique le délai d'attente", () => {
    expect(AppError.rateLimited(30).details).toEqual({ retryAfterSeconds: 30 });
  });

  it("externalServiceFailed nomme le service", () => {
    expect(AppError.externalServiceFailed("smtp").details).toEqual({ service: "smtp" });
  });

  it("storageFailed nomme l'opération", () => {
    expect(AppError.storageFailed("upload").details).toEqual({ operation: "upload" });
  });

  it("unauthenticated et forbidden n'exigent aucun contexte", () => {
    expect(AppError.unauthenticated().code).toBe(AppErrorCode.UNAUTHENTICATED);
    expect(AppError.forbidden().code).toBe(AppErrorCode.FORBIDDEN);
  });
});

describe("AppError.from / isAppError", () => {
  it("laisse passer une AppError inchangée", () => {
    const original = AppError.conflict();
    expect(AppError.from(original)).toBe(original);
  });

  it("emballe toute autre valeur en INTERNAL", () => {
    const wrapped = AppError.from("chaîne inattendue");
    expect(wrapped.code).toBe(AppErrorCode.INTERNAL);
    expect(wrapped.cause).toBe("chaîne inattendue");
  });

  it("reconnaît une AppError", () => {
    expect(isAppError(AppError.internal())).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError({ code: "INTERNAL" })).toBe(false);
  });
});

describe("toClientError", () => {
  it("ne sérialise jamais la cause, quel que soit le code", () => {
    const error = AppError.conflict({
      cause: new Error("duplicate key value violates unique constraint « obligations_pkey »"),
      details: { field: "code" },
    });
    const client = toClientError(error);

    expect(Object.keys(client)).not.toContain("cause");
    expect(JSON.stringify(client)).not.toContain("obligations_pkey");
  });

  it("conserve les détails d'une erreur métier", () => {
    expect(toClientError(AppError.notFound("obligation", "42"))).toEqual({
      code: "NOT_FOUND",
      message: "errors.notFound",
      httpStatus: 404,
      details: { entity: "obligation", id: "42" },
    });
  });

  it("retire les détails d'une erreur INTERNAL", () => {
    const error = AppError.internal({
      details: { query: "select * from documents where secret = $1" },
      cause: new Error("connection refused 10.0.0.4:5432"),
    });

    expect(toClientError(error)).toEqual({
      code: "INTERNAL",
      message: "errors.internal",
      httpStatus: 500,
    });
  });

  it("produit un objet strictement sérialisable", () => {
    const client = toClientError(AppError.rateLimited(30));
    expect(JSON.parse(JSON.stringify(client))).toEqual(client);
  });
});

describe("mapPostgrestError", () => {
  it.each([
    ["23505", AppErrorCode.CONFLICT],
    ["23503", AppErrorCode.CONFLICT],
    ["23502", AppErrorCode.VALIDATION_FAILED],
    ["23514", AppErrorCode.VALIDATION_FAILED],
    ["22P02", AppErrorCode.VALIDATION_FAILED],
    ["42501", AppErrorCode.FORBIDDEN],
    ["28000", AppErrorCode.UNAUTHENTICATED],
    ["40001", AppErrorCode.CONFLICT],
    ["40P01", AppErrorCode.CONFLICT],
    ["P0001", AppErrorCode.CONFLICT],
    ["PGRST116", AppErrorCode.NOT_FOUND],
    ["PGRST301", AppErrorCode.UNAUTHENTICATED],
  ])("traduit %s en %s", (dbCode, expected) => {
    const error = mapPostgrestError({ code: dbCode, message: "erreur base" });
    expect(error.code).toBe(expected);
    expect(error.details).toEqual({ dbCode });
  });

  it("classe en INTERNAL un code inconnu", () => {
    expect(mapPostgrestError({ code: "99999", message: "?" }).code).toBe(AppErrorCode.INTERNAL);
  });

  it("classe en INTERNAL une valeur qui n'est pas une erreur PostgREST", () => {
    expect(mapPostgrestError("boom").code).toBe(AppErrorCode.INTERNAL);
    expect(mapPostgrestError(null).code).toBe(AppErrorCode.INTERNAL);
    expect(mapPostgrestError({ message: "sans code" }).code).toBe(AppErrorCode.INTERNAL);
  });

  it("garde l'erreur d'origine en cause, hors de portée du client", () => {
    const source = { code: "23505", message: "duplicate key", details: "Key (code)=(G50)" };
    const error = mapPostgrestError(source);
    expect(error.cause).toBe(source);
    expect(JSON.stringify(toClientError(error))).not.toContain("G50");
  });

  it("n'expose pas le code base pour une erreur non classée", () => {
    const client = toClientError(mapPostgrestError({ code: "42P01", message: "no table" }));
    expect(client.code).toBe(AppErrorCode.INTERNAL);
    expect(client.details).toBeUndefined();
  });
});
