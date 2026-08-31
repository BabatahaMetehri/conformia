import { defineConfig, devices } from "@playwright/test";

/**
 * Suite end-to-end. Exige la pile Supabase locale ET un build de production :
 * l'accessibilite se verifie sur le rendu reel, pas sur celui du mode dev.
 *
 * Lancement : `npm run test:e2e`.
 */
const PORT = 3210;

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
