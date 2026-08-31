import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Suite end-to-end. Exige la pile Supabase locale ET un build de production :
 * l'accessibilite se verifie sur le rendu reel, pas sur celui du mode dev.
 *
 * Lancement : `npm run test:e2e`.
 */
const PORT = 3210;

/**
 * Charge `.env.local`.
 *
 * ⚠️ Sans cela, `SUPABASE_SERVICE_ROLE_KEY` est absent du processus de test et
 * TOUS les scénarios exigeant une session se marquent « skipped ». La suite
 * affiche alors un vert trompeur : elle n'a rien vérifié. Next charge ce fichier
 * pour l'application, jamais pour le lanceur de tests — c'est à lui de le faire.
 *
 * Les valeurs déjà présentes dans l'environnement l'emportent : en CI, les
 * secrets viennent du coffre, pas d'un fichier absent du dépôt.
 */
function loadEnvLocal(): void {
  let raw: string;
  try {
    // `process.cwd()` et non `import.meta.url` : Playwright transpile sa
    // configuration en CommonJS, où `import.meta` n'existe pas.
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    process.env[key] ??= value;
  }
}

loadEnvLocal();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/fr/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
