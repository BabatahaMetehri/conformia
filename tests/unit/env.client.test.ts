import { describe, expect, it } from "vitest";

import { env, isServer } from "@/config/env";

/**
 * L'environnement jsdom fournit un `window` : `src/config/env.ts` emprunte donc
 * la même branche qu'un bundle navigateur. C'est ce qui permet de vérifier
 * réellement le garde-fou, sans le simuler.
 */
describe("env — périmètre client", () => {
  it("se sait côté navigateur", () => {
    expect(isServer).toBe(false);
  });

  it("expose les variables publiques", () => {
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("test-anon-key");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it.each([
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL",
    "SMTP_PASSWORD",
    "CRON_SECRET",
    "BACKUP_ENCRYPTION_KEY",
  ])("refuse la lecture du secret %s", (key) => {
    expect(() => {
      Reflect.get(env, key);
    }).toThrow(/bundle client/);
  });

  it("nomme la variable fautive dans le message", () => {
    expect(() => {
      Reflect.get(env, "CRON_SECRET");
    }).toThrow(/CRON_SECRET/);
  });

  it("ne laisse fuir aucun secret par énumération", () => {
    expect(Object.keys(env)).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_APP_URL",
    ]);
    expect(JSON.stringify(env)).not.toContain("test-service-role-key");
  });
});
