// @vitest-environment node

import { describe, expect, it } from "vitest";

import { env, isServer } from "@/config/env";

/**
 * Côté serveur, `env` expose l'union des variables publiques et des secrets.
 * Les valeurs proviennent de `test.env` dans vitest.config.mts.
 */
describe("env — périmètre serveur", () => {
  it("se sait côté serveur", () => {
    expect(isServer).toBe(true);
  });

  it("expose les variables publiques", () => {
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("expose les secrets serveur", () => {
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("test-service-role-key");
    expect(env.DATABASE_URL).toContain("postgresql://");
    expect(env.CRON_SECRET).toHaveLength(32);
    expect(env.BACKUP_ENCRYPTION_KEY).toHaveLength(32);
  });

  it("convertit SMTP_PORT en nombre", () => {
    expect(env.SMTP_PORT).toBe(1025);
    expect(typeof env.SMTP_PORT).toBe("number");
  });

  it("applique les valeurs par défaut", () => {
    expect(env.NODE_ENV).toBe("test");
    expect(env.LOG_LEVEL).toBe("error");
  });

  it("est figé : aucune réécriture à chaud", () => {
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      // @ts-expect-error — vérification du gel à l'exécution, interdite au typage.
      env.CRON_SECRET = "compromis";
    }).toThrow();
  });
});
