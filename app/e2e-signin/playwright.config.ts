// team hub, issue 25 (B6): the runner config of the sign-in tests.
// Kept apart from app/e2e because these need a stack whose sign-ups are
// switched off (.github/workflows/signin.yml). Run from app/:
//   npx playwright test -c e2e-signin/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
// upstream's published values for a throwaway stack on 127.0.0.1
dotenv.config({ path: path.resolve(here, "..", ".env.e2e") });

export default defineConfig({
  testDir: here,
  // Not *.spec.ts: the app's browser tests (vitest.config.ts) pick up every
  // spec file outside app/e2e and fail to load this one in a browser.
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retry: a sign-in test that passes on the second try has not passed.
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:5175",
    trace: "off",
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.CI && { channel: "chromium-headless-shell" }),
      },
    },
  ],
});
