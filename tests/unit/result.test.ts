import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { AppError, AppErrorCode } from "@/lib/errors";
import type { Err, Ok, Result } from "@/lib/result";
import {
  collect,
  err,
  flatMapResult,
  isErr,
  isOk,
  mapResult,
  ok,
  tryCatch,
  unwrapOr,
} from "@/lib/result";

describe("ok / err", () => {
  it("construit un succès", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it("construit un échec", () => {
    const error = AppError.forbidden();
    expect(err(error)).toEqual({ ok: false, error });
  });

  it("accepte une valeur nullable sans la confondre avec un échec", () => {
    const result = ok(null);
    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
  });
});

describe("isOk / isErr", () => {
  it("discrimine les deux branches", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isOk(err(AppError.internal()))).toBe(false);
    expect(isErr(err(AppError.internal()))).toBe(true);
  });

  /**
   * Les assertions de type passent par un paramètre de fonction : une `const`
   * initialisée par `ok(...)` serait déjà restreinte à `Ok<T>` par le flux de
   * contrôle, et la branche d'échec deviendrait `never` — on ne testerait rien.
   */
  it("restreint le type dans chaque branche", () => {
    const narrowViaGuard = (result: Result<number>): void => {
      if (isOk(result)) {
        expectTypeOf(result).toEqualTypeOf<Ok<number>>();
        expectTypeOf(result.value).toEqualTypeOf<number>();
      } else {
        expectTypeOf(result).toEqualTypeOf<Err<AppError>>();
        expectTypeOf(result.error).toEqualTypeOf<AppError>();
      }
    };

    const narrowViaField = (result: Result<string>): void => {
      if (result.ok) {
        expectTypeOf(result.value).toEqualTypeOf<string>();
      } else {
        expectTypeOf(result.error).toEqualTypeOf<AppError>();
      }
    };

    narrowViaGuard(ok(1));
    narrowViaGuard(err(AppError.internal()));
    narrowViaField(ok("x"));
    expect(true).toBe(true);
  });
});

describe("mapResult", () => {
  it("transforme la valeur d'un succès", () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
  });

  it("laisse un échec intact et n'appelle pas la transformation", () => {
    const transform = vi.fn<(value: number) => number>();
    const error = AppError.notFound("obligation", "abc");
    expect(mapResult(err(error), transform)).toEqual({ ok: false, error });
    expect(transform).not.toHaveBeenCalled();
  });

  it("propage le type transformé en conservant le type d'erreur", () => {
    const mapTyped = (input: Result<number>): void => {
      expectTypeOf(mapResult(input, (n) => String(n))).toEqualTypeOf<Result<string>>();
    };
    mapTyped(ok(2));
    expect(true).toBe(true);
  });
});

describe("flatMapResult", () => {
  it("enchaîne deux opérations réussies", () => {
    expect(flatMapResult(ok(2), (n) => ok(n + 1))).toEqual({ ok: true, value: 3 });
  });

  it("propage l'échec de la seconde opération", () => {
    const error = AppError.conflict();
    expect(flatMapResult(ok(2), () => err(error))).toEqual({ ok: false, error });
  });

  it("court-circuite si le premier a échoué", () => {
    const next = vi.fn<(value: number) => Result<number>>();
    const error = AppError.internal();
    expect(flatMapResult(err(error), next)).toEqual({ ok: false, error });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("unwrapOr", () => {
  it("rend la valeur d'un succès", () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
  });

  it("rend le repli d'un échec", () => {
    expect(unwrapOr(err(AppError.internal()), 0)).toBe(0);
  });
});

describe("collect", () => {
  it("agrège des succès en préservant l'ordre", () => {
    expect(collect([ok(1), ok(2), ok(3)])).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it("rend un tableau vide pour une entrée vide", () => {
    expect(collect<number, AppError>([])).toEqual({ ok: true, value: [] });
  });

  it("s'arrête au premier échec", () => {
    const first = AppError.notFound("obligation", "1");
    const second = AppError.notFound("obligation", "2");
    const result = collect<number, AppError>([ok(1), err(first), err(second)]);
    expect(result).toEqual({ ok: false, error: first });
  });

  it("infère Result<T[], E>", () => {
    const result = collect<number, AppError>([ok(1)]);
    expectTypeOf(result).toEqualTypeOf<Result<number[]>>();
  });
});

describe("tryCatch", () => {
  it("enveloppe une promesse résolue", async () => {
    await expect(tryCatch(Promise.resolve("ok"))).resolves.toEqual({
      ok: true,
      value: "ok",
    });
  });

  it("capture le rejet d'une promesse", async () => {
    const result = await tryCatch(Promise.reject(new Error("boom")));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("attendu : échec");
    expect(result.error.code).toBe(AppErrorCode.INTERNAL);
    expect(result.error.cause).toBeInstanceOf(Error);
  });

  it("capture une exception levée de façon synchrone par une fonction", async () => {
    const result = await tryCatch(() => {
      throw new Error("synchrone");
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("attendu : échec");
    expect(result.error.code).toBe(AppErrorCode.INTERNAL);
  });

  it("accepte une fonction asynchrone", async () => {
    await expect(tryCatch(() => Promise.resolve(5))).resolves.toEqual({
      ok: true,
      value: 5,
    });
  });

  it("accepte une fonction synchrone rendant une valeur", async () => {
    await expect(tryCatch(() => 5)).resolves.toEqual({ ok: true, value: 5 });
  });

  it("laisse passer une AppError existante sans la ré-emballer", async () => {
    const original = AppError.periodLocked("2026-01");
    const result = await tryCatch(() => {
      throw original;
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("attendu : échec");
    expect(result.error).toBe(original);
    expect(result.error.code).toBe(AppErrorCode.PERIOD_LOCKED);
  });

  it("respecte un mappeur d'erreur explicite", async () => {
    const result = await tryCatch(
      () => {
        throw new Error("indisponible");
      },
      () => AppError.externalServiceFailed("smtp"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("attendu : échec");
    expect(result.error.code).toBe(AppErrorCode.EXTERNAL_SERVICE_FAILED);
  });

  it("infère Promise<Result<T, AppError>>", async () => {
    const promise = tryCatch(() => 1);
    expectTypeOf(promise).toEqualTypeOf<Promise<Result<number>>>();
    await promise;
  });
});
