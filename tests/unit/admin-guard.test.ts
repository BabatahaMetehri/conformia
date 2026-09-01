import { afterEach, describe, expect, it } from "vitest";

import {
  ADMIN_CLIENT_MISUSE_MESSAGE,
  assertLoadedFromJobs,
  isJobContext,
  isLoadedFromJobs,
  markJobContext,
  resetJobContext,
} from "@/lib/supabase/admin-guard";

/** Pile d'appels réaliste, telle que V8 la produit au chargement d'un module. */
function stackFrom(...frames: readonly string[]): string {
  return ["Error", ...frames.map((frame) => `    at Object.<anonymous> (${frame})`)].join("\n");
}

describe("isLoadedFromJobs", () => {
  it("accepte un chargement depuis un script de jobs (chemin POSIX)", () => {
    expect(
      isLoadedFromJobs(
        stackFrom(
          "/app/src/lib/supabase/admin.ts:40:30",
          "/app/src/server/jobs/generate-occurrences.ts:3:1",
        ),
      ),
    ).toBe(true);
  });

  it("accepte un chargement depuis un script de jobs (chemin Windows)", () => {
    expect(
      isLoadedFromJobs(
        stackFrom(
          "C:\\app\\src\\lib\\supabase\\admin.ts:40:30",
          "C:\\app\\src\\server\\jobs\\purge-retention.ts:3:1",
        ),
      ),
    ).toBe(true);
  });

  it("refuse un chargement depuis une Server Action", () => {
    expect(
      isLoadedFromJobs(
        stackFrom(
          "/app/src/lib/supabase/admin.ts:40:30",
          "/app/src/features/occurrences/actions/submit.ts:12:5",
        ),
      ),
    ).toBe(false);
  });

  it("refuse un chargement depuis un Route Handler", () => {
    expect(isLoadedFromJobs(stackFrom("/app/src/app/api/cron/route.ts:8:1"))).toBe(false);
  });

  it("refuse un dossier au nom voisin", () => {
    expect(isLoadedFromJobs(stackFrom("/app/src/server/jobs-helpers/x.ts:1:1"))).toBe(false);
    expect(isLoadedFromJobs(stackFrom("/app/src/serverjobs/x.ts:1:1"))).toBe(false);
  });

  it("échoue fermé quand la pile est indisponible", () => {
    expect(isLoadedFromJobs(undefined)).toBe(false);
    expect(isLoadedFromJobs("")).toBe(false);
  });
});

describe("assertLoadedFromJobs", () => {
  it("laisse passer un script de jobs", () => {
    expect(() => {
      assertLoadedFromJobs(stackFrom("/app/src/server/jobs/send-notifications.ts:1:1"));
    }).not.toThrow();
  });

  it("lève ailleurs, en expliquant pourquoi", () => {
    expect(() => {
      assertLoadedFromJobs(stackFrom("/app/src/components/layout/sidebar.tsx:1:1"));
    }).toThrow(ADMIN_CLIENT_MISUSE_MESSAGE);
  });

  it("mentionne l'alternative soumise à la RLS", () => {
    expect(ADMIN_CLIENT_MISUSE_MESSAGE).toContain("@/lib/supabase/server");
  });
});

describe("marqueur de contexte job", () => {
  afterEach(() => {
    resetJobContext();
  });

  it("est ABSENT par défaut", () => {
    expect(isJobContext()).toBe(false);
  });

  it("autorise le client de service une fois posé, MÊME sans chemin dans la pile", () => {
    /*
     * ⚠️ LE FAUX POSITIF QUE CE MARQUEUR CORRIGE. La lecture de pile ne survit
     * pas au bundling Next.js : les chemins deviennent
     * `.next/server/chunks/8340.js`, et `/server/jobs/` disparaît. La garde
     * refusait donc un job LÉGITIME dès qu'il était invoqué depuis le serveur
     * applicatif — constaté sur la route de secours de génération, qui rendait
     * une erreur 500.
     */
    expect(() => {
      assertLoadedFromJobs("at .next/server/chunks/8340.js:1:238");
    }).toThrow(ADMIN_CLIENT_MISUSE_MESSAGE);

    markJobContext();
    expect(() => {
      assertLoadedFromJobs("at .next/server/chunks/8340.js:1:238");
    }).not.toThrow();
  });

  it("n'affaiblit RIEN : sans marqueur ni chemin, le refus tient", () => {
    // La barrière principale reste la règle ESLint, qui interdit statiquement
    // d'importer le marqueur hors de `src/server/jobs/`.
    expect(isLoadedFromJobs("at src/app/page.tsx:12:3")).toBe(false);
    expect(() => {
      assertLoadedFromJobs("at src/app/page.tsx:12:3");
    }).toThrow(ADMIN_CLIENT_MISUSE_MESSAGE);
  });
});
