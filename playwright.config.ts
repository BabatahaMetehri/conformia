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
    /*
     * ⚠️ CAPTURE D'ÉCRAN À L'ÉCHEC, systématiquement. Un échec de bout en bout
     * se lit mal dans une pile d'appels : la question est « qu'affichait la page
     * à cet instant ». Sans image, on rejoue le scénario à la main pour la
     * découvrir — et sur une machine différente, il ne se reproduit pas.
     */
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    /*
     * ⚠️ FIREFOX ne double pas la couverture : il éprouve ce que Chromium ne
     * peut pas voir. Les deux moteurs divergent sur les propriétés logiques en
     * RTL, la sérialisation des dates dans un `input[type=date]`, et le moment
     * exact où l'hydratation attache un gestionnaire — précisément le défaut
     * corrigé à la phase précédente.
     *
     * Seuls les PARCOURS CRITIQUES y tournent : y passer toute la suite
     * doublerait le temps de vérification pour un gain marginal sur des écrans
     * dont la mécanique est déjà couverte.
     */
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /critical-journeys\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npx next start --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/fr/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
