// team hub (issue 50): the CRM Kit brand in the built app, end to end,
// against the throwaway stack of the app workflow. Not upstream's file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as plain, type Locator, type Page } from "@playwright/test";
import type { TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..", "dist");
const SHOTS = path.join("test-results", "kit");
const NAME = "team hub";
const BESIDE = "Hub";

// What the window shows, never fullPage (docs/FINDINGS.md, issue 24 reopened).
const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
  expect(fs.statSync(file).size).toBeGreaterThan(5000);
};

// The logo is the CRM Kit file and the browser drew it: a broken image has a
// natural width of zero.
const expectLogoLoads = async (logo: Locator, file: RegExp) => {
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", file);
  await expect
    .poll(() =>
      logo.evaluate((img) =>
        (img as HTMLImageElement).complete
          ? (img as HTMLImageElement).naturalWidth
          : 0,
      ),
    )
    .toBeGreaterThan(0);
};

const LIGHT_LOGO = /\/crm-logo-(?!reversed-)[\w-]{6,12}\.svg$/;
const DARK_LOGO = /\/crm-logo-reversed-[\w-]{6,12}\.svg$/;

test.describe("the CRM Kit brand", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "The sign-in page draws its logo only in a wide window; the desktop run covers the brand",
  );

  test.beforeEach(async ({ createSales }) => {
    await createSales({
      first_name: "John",
      last_name: "Doe",
      email: "john@doe-com.example.org",
      password: "password",
    });
  });

  test("case 6 and 7: the sign-in page shows the CRM Kit logo and the tab says team hub", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page).toHaveTitle(NAME);
    const logo = page.getByRole("img", { name: NAME });
    await expectLogoLoads(logo, DARK_LOGO);
    // the logo says CRM Kit; beside it only "Hub"
    await expect(logo.locator("..")).toHaveText(BESIDE);
    await shoot(page, testInfo, "brand-sign-in");
    await expectLogoLoads(logo, DARK_LOGO);
  });

  test("case 5: the header shows the CRM Kit logo, in light and in dark", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.getByLabel("Email").fill("john@doe-com.example.org");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByTestId("people-board")).toBeVisible();
    await expect(page).toHaveTitle(NAME);

    const logo = page.locator("header").getByRole("img", { name: NAME });
    await expectLogoLoads(logo, LIGHT_LOGO);
    await expect(page.locator("header h1")).toHaveText(BESIDE);
    await shoot(page, testInfo, "brand-header-light");
    await expectLogoLoads(logo, LIGHT_LOGO);

    // The theme follows the system until someone picks one; it is read when
    // the page loads.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(page.getByTestId("people-board")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expectLogoLoads(logo, DARK_LOGO);
    await shoot(page, testInfo, "brand-header-dark");
    await expectLogoLoads(logo, DARK_LOGO);
  });
});

// License text the build carries, which keeps the name (issue 50):
// upstream's CHANGELOG.md, bundled whole for its changelog screen, and the
// credit on the demo-only welcome card (src/components/atomic-crm/dashboard/
// Welcome.tsx, drawn only when config.isDemo).
// The card's two mentions: its link to upstream, followed by "is a template
// designed", and the sentence "Atomic CRM is fully open-source". Read by the
// words near them, since the build's form differs: the app workflow builds
// with NODE_ENV=CI, which keeps React's development JSX (file names, line
// numbers) between the link and the sentence.
const isCredit = (text: string, at: number, length: number) =>
  /^ is fully open-source/.test(text.slice(at + length, at + length + 25)) ||
  (text.slice(Math.max(0, at - 150), at).includes("marmelab.com/atomic-crm") &&
    text.slice(at + length, at + length + 300).includes("is a template designed"));
const flat = (text: string) => text.replace(/\\r|\r/g, "");
const CHANGELOG = flat(fs.readFileSync(path.resolve(HERE, "..", "CHANGELOG.md"), "utf8"));
const fromChangelog = (text: string, at: number, length: number) =>
  CHANGELOG.includes(flat(text.slice(Math.max(0, at - 30), at + length + 30)));
const WORDS = /Atomic CRM|logo_atomic_crm/g;
// Source maps hold upstream's source with its comments; no page shows them.
const READ = /\.(html|js|mjs|json|css|svg|txt|webmanifest)$/;

const filesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });

const atomicWordsIn = (text: string) =>
  [...text.matchAll(WORDS)]
    .filter((m) => {
      if (m[0] !== "Atomic CRM") return true;
      if (isCredit(text, m.index!, m[0].length)) return false;
      return !fromChangelog(text, m.index!, m[0].length);
    })
    .map((m) =>
      text.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40),
    );

plain.describe("the built app", () => {
  plain.skip(({ isMobile }) => isMobile, "One reading of the build is enough");

  plain("names no Atomic CRM outside license text", () => {
    // the reading itself, on made up text
    expect(
      atomicWordsIn(
        'href:`https://marmelab.com/atomic-crm`,className:`underline`,children:`Atomic CRM`}),` `,`is a template designed b Install Atomic CRM c, Atomic CRM is fully open-source. url("logo_atomic_crm_dark.svg")',
      ),
    ).toHaveLength(2);
    // the development form the app workflow builds
    expect(
      atomicWordsIn(
        'href:`https://marmelab.com/atomic-crm`,className:`underline hover:no-underline`,children:`Atomic CRM`},void 0,!1,{fileName:gX,lineNumber:10,columnNumber:9},this),` `,`is a template designed to help you`',
      ),
    ).toEqual([]);
    // a link to upstream alone does not excuse the name
    expect(
      atomicWordsIn('href:`https://marmelab.com/atomic-crm`,children:`Atomic CRM`}) and more'),
    ).toHaveLength(1);
    // a stretch of the changelog as the bundle holds it, carriage returns
    // written as \r, is license text; the same words outside it are not
    const at = CHANGELOG.indexOf("Atomic CRM");
    expect(at).toBeGreaterThan(-1);
    const bundled = CHANGELOG.slice(Math.max(0, at - 200), at + 200).replace(/\n/g, "\\r\n");
    expect(atomicWordsIn(`x = \`${bundled}\`; y = "Welcome to Atomic CRM"`)).toEqual([
      expect.stringContaining("Welcome to Atomic CRM"),
    ]);

    expect(fs.existsSync(path.join(DIST, "index.html"))).toBe(true);
    const files = filesUnder(DIST).filter((f) => READ.test(f));
    expect(files.some((f) => /assets\/index-.*\.js$/.test(f))).toBe(true);
    expect(files.some((f) => f.endsWith("manifest.json"))).toBe(true);
    const found = files.flatMap((f) =>
      atomicWordsIn(fs.readFileSync(f, "utf8")).map(
        (hit) => `${path.relative(DIST, f)}: ${hit}`,
      ),
    );
    expect(found).toEqual([]);
    // no file of the build is named after Atomic CRM's logo either
    expect(filesUnder(DIST).filter((f) => /atomic/i.test(path.basename(f)))).toEqual([]);
  });
});
