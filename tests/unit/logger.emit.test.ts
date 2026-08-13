import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REDACTED } from "@/lib/logger";

interface CapturedLine {
  readonly stream: "log" | "warn" | "error";
  readonly text: string;
}

let captured: CapturedLine[] = [];

/**
 * Le niveau minimal est résolu au chargement du module : chaque scénario
 * recharge donc `@/lib/logger` avec l'environnement voulu.
 */
async function loadLogger(overrides: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  return import("@/lib/logger");
}

beforeEach(() => {
  captured = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.push({ stream: "log", text: String(args[0]) });
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    captured.push({ stream: "warn", text: String(args[0]) });
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push({ stream: "error", text: String(args[0]) });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function linesOn(stream: CapturedLine["stream"]): readonly string[] {
  return captured.filter((line) => line.stream === stream).map((line) => line.text);
}

function onlyLine(stream: CapturedLine["stream"]): string {
  const [first] = linesOn(stream);
  if (first === undefined) throw new Error(`aucune écriture sur console.${stream}`);
  return first;
}

/** Décode une ligne JSON en objet sans passer par `any`. */
function parseRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("objet JSON attendu");
  }
  return { ...parsed };
}

describe("filtrage par niveau", () => {
  it("ignore ce qui est sous le seuil configuré", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "warn", NODE_ENV: "production" });

    logger.debug("invisible");
    logger.info("invisible");
    expect(linesOn("log")).toHaveLength(0);

    logger.warn("visible");
    logger.error("visible");
    expect(linesOn("warn")).toHaveLength(1);
    expect(linesOn("error")).toHaveLength(1);
  });

  it("laisse tout passer en debug", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });
    logger.debug("visible");
    logger.info("visible");
    expect(linesOn("log")).toHaveLength(2);
  });

  it("retombe sur un seuil sain si LOG_LEVEL est absurde", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "bavard", NODE_ENV: "production" });
    logger.info("visible");
    expect(linesOn("log")).toHaveLength(1);
  });
});

describe("format production", () => {
  it("écrit une seule ligne JSON structurée", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.info("occurrence créée", { occurrenceId: "o-1" });
    const line = onlyLine("log");

    expect(line).not.toContain("\n");
    expect(parseRecord(line)).toMatchObject({
      level: "info",
      message: "occurrence créée",
      context: { occurrenceId: "o-1" },
    });
  });

  it("horodate en ISO UTC", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });
    logger.info("ping");
    expect(String(parseRecord(onlyLine("log"))["timestamp"])).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
    );
  });

  it("hisse requestId et userId au premier niveau", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.info("action", { requestId: "r-1", userId: "u-1", detail: "x" });

    expect(parseRecord(onlyLine("log"))).toMatchObject({
      requestId: "r-1",
      userId: "u-1",
      context: { detail: "x" },
    });
  });

  it("omet la clé context quand il n'y a rien à joindre", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });
    logger.info("nu");
    expect(Object.keys(parseRecord(onlyLine("log")))).not.toContain("context");
  });

  it("masque les secrets avant écriture", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.error("échec authentification", {
      userId: "u-1",
      password: "hunter2",
      nested: { apiKey: "sk-live-1234" },
    });
    const line = onlyLine("error");

    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("sk-live-1234");
    expect(line).toContain(REDACTED);
    expect(line).toContain("u-1");
  });
});

describe("format développement", () => {
  it("écrit une ligne lisible et colorée", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "development" });

    logger.warn("échéance proche", { occurrenceId: "o-1" });
    const line = onlyLine("warn");

    expect(line).toContain("WARN");
    expect(line).toContain("échéance proche");
    expect(line).toContain("o-1");
    // Séquence ANSI de réinitialisation : la sortie est bien colorée.
    expect(line).toContain(`${String.fromCharCode(27)}[0m`);
    expect(() => {
      JSON.parse(line);
    }).toThrow();
  });

  it("n'ajoute pas d'accolades quand le contexte est vide", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "development" });
    logger.info("simple");
    expect(onlyLine("log")).not.toContain("{");
  });
});

describe("logger.child", () => {
  it("propage les liaisons permanentes", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.child({ requestId: "r-9", userId: "u-9" }).info("dans la requête");
    expect(parseRecord(onlyLine("log"))).toMatchObject({
      requestId: "r-9",
      userId: "u-9",
    });
  });

  it("laisse le contexte d'appel surcharger la liaison", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.child({ userId: "u-1" }).info("changement", { userId: "u-2" });
    expect(parseRecord(onlyLine("log"))).toMatchObject({ userId: "u-2" });
  });

  it("se compose sans perdre les liaisons parentes", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.child({ requestId: "r-1" }).child({ userId: "u-1" }).info("imbriqué");
    expect(parseRecord(onlyLine("log"))).toMatchObject({
      requestId: "r-1",
      userId: "u-1",
    });
  });

  it("n'altère pas le logger parent", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.child({ requestId: "r-1" }).info("enfant");
    logger.info("parent");

    const [childLine, parentLine] = linesOn("log");
    if (childLine === undefined || parentLine === undefined) {
      throw new Error("deux lignes attendues");
    }
    expect(Object.keys(parseRecord(childLine))).toContain("requestId");
    expect(Object.keys(parseRecord(parentLine))).not.toContain("requestId");
  });
});

describe("routage console", () => {
  it("dirige chaque niveau vers le bon flux", async () => {
    const { logger } = await loadLogger({ LOG_LEVEL: "debug", NODE_ENV: "production" });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(linesOn("log")).toHaveLength(2);
    expect(linesOn("warn")).toHaveLength(1);
    expect(linesOn("error")).toHaveLength(1);
  });
});
