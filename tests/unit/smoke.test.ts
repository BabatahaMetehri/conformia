import { describe, expect, it } from "vitest";

import { APP_TIME_ZONE } from "@/config/constants";
import { toAppTimeZoneDateString } from "@/lib/dates";
import { appError } from "@/lib/errors";
import { err, isErr, isOk, ok, unwrapOr } from "@/lib/result";

/**
 * Test de chaîne : prouve que Vitest, jsdom, l'alias `@/` et le socle métier
 * fonctionnent ensemble. Il ne teste aucune règle métier.
 */
describe("chaîne d'outillage", () => {
  it("résout l'alias @/ vers src/", () => {
    expect(APP_TIME_ZONE).toBe("Africa/Algiers");
  });

  it("s'exécute dans un environnement jsdom", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
  });

  it("discrimine Ok et Err", () => {
    const success = ok(42);
    const failure = err(appError("NOT_FOUND", "errors.notFound"));

    expect(isOk(success)).toBe(true);
    expect(isErr(failure)).toBe(true);
    expect(unwrapOr(failure, 0)).toBe(0);
  });

  it("calcule les dates dans le fuseau Africa/Algiers, pas en UTC", () => {
    // 23h30 UTC le 31 décembre, c'est déjà le 1er janvier à Alger (UTC+1).
    expect(toAppTimeZoneDateString(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
  });
});
