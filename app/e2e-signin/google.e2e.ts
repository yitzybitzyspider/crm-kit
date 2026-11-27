// team hub, issue 58: the "Sign in with Google" button on the sign-in page,
// against the throwaway stack, where Google is switched off. Runs on both
// stacks of .github/workflows/signin.yml. A whole sign-in through an OAuth
// provider, linking and refusals included, is google-linking.e2e.ts.
import { test, expect, type Page } from "@playwright/test";
import {
  API,
  PUBLIC_KEY,
  SIGNUPS,
  createFirstUser,
  expectSignedIn,
  fillLogin,
  freshPage,
  newPassword,
  resetAll,
} from "./helpers";
import {
  GOOGLE_CANCELLED,
  GOOGLE_FAILED,
  GOOGLE_OFF,
} from "../src/components/kit/googleSignIn";

const APP = "http://localhost:5175";
// The sentence the issue settled, written out here rather than read from the
// code under test.
const NOT_ON_LIST =
  "This Google account is not on the team hub's list. Ask your hub administrator to add you.";

const googleButton = (page: Page) =>
  page.getByRole("button", { name: "Sign in with Google" });

// Supabase's settings answer, with Google switched on: what the cloud project
// says once the administrator has done the steps in docs/DEPLOY.md.
async function googleSwitchedOn(page: Page) {
  await page.route("**/auth/v1/settings*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        external: { email: true, google: true },
        disable_signup: true,
      }),
    }),
  );
}

// Stands in for Google's page: records where the button sent the browser.
async function catchAuthorize(page: Page) {
  const asked: string[] = [];
  await page.route("**/auth/v1/authorize*", (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Google</title><p>Google stand-in</p>",
    });
  });
  return asked;
}

// The hub as it is live: a first user exists. On an empty database the app
// sends every visitor to its first user page instead of the sign-in page.
const ADMIN = "admin@example-test.example.org";
let adminPassword = "";

test.beforeEach(async () => {
  await resetAll();
  adminPassword = newPassword();
  await createFirstUser(ADMIN, adminPassword);
});

test("the sign-in page shows Sign in with Google above the email form", async ({ browser }) => {
  const page = await freshPage(browser);
  await page.goto("/");
  await expect(googleButton(page)).toBeVisible({ timeout: 20_000 });
  const email = page.getByLabel("Email");
  await expect(email).toBeVisible();
  const button = await googleButton(page).boundingBox();
  const field = await email.boundingBox();
  expect(button && field && button.y + button.height <= field.y, "the button is above the email field").toBeTruthy();
  // The email and password form is still there, as the fallback.
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("pressing it asks Supabase for provider google, returning to the hub's address", async ({ browser }) => {
  const page = await freshPage(browser);
  await googleSwitchedOn(page);
  const asked = await catchAuthorize(page);
  await page.goto("/");
  await googleButton(page).click();
  await expect(page.getByText("Google stand-in")).toBeVisible();
  expect(asked).toHaveLength(1);
  const url = new URL(asked[0]);
  expect(`${url.origin}${url.pathname}`).toBe(`${API}/auth/v1/authorize`);
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toBe(`${APP}/`);
});

test("on this stack Google is switched off, and the button says so in a sentence", async ({ browser }) => {
  // Configured off: Supabase's own settings say so.
  const settings = await fetch(`${API}/auth/v1/settings`, {
    headers: { apikey: PUBLIC_KEY },
  });
  expect(settings.status).toBe(200);
  const json: any = await settings.json();
  expect(json.external?.google, JSON.stringify(json.external)).toBe(false);

  const page = await freshPage(browser);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/auth/v1/authorize")) asked.push(request.url());
  });
  await page.goto("/");
  await googleButton(page).click();
  await expect(page.getByText(GOOGLE_OFF)).toBeVisible();
  // Still the sign-in page, not a blank page or Supabase's raw answer.
  expect(page.url().startsWith(APP)).toBe(true);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(googleButton(page)).toBeEnabled();
  expect(asked).toEqual([]);
});

test("back from Google's page without signing in, the sign-in page works again", async ({ browser }) => {
  const page = await freshPage(browser);
  await googleSwitchedOn(page);
  await catchAuthorize(page);
  await page.goto("/");
  await googleButton(page).click();
  await expect(page.getByText("Google stand-in")).toBeVisible();
  await page.goBack();
  await expect(googleButton(page)).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByLabel("Email")).toBeVisible();
});

// Each return address shaped the way Supabase's auth service builds it after
// a refused Google sign-in: the error in the query and in the fragment.
const REFUSALS: [string, string, string][] = [
  ["sign-ups off and no account", "error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance", NOT_ON_LIST],
  ["the allow list's refusal", "error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user", NOT_ON_LIST],
  ["no such user", "error=invalid_request&error_code=user_not_found&error_description=User+not+found", NOT_ON_LIST],
  ["a missing identity", "error=invalid_request&error_code=identity_not_found&error_description=Identity+not+found", NOT_ON_LIST],
  ["a teammate switched off", "error=access_denied&error_code=user_banned&error_description=User+is+banned", NOT_ON_LIST],
  ["Cancel on Google's screen", "error=access_denied&error_description=The+user+cancelled", GOOGLE_CANCELLED],
  ["the provider switched off", "error=invalid_request&error_code=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled", GOOGLE_OFF],
  ["anything else", "error=server_error&error_code=unexpected_failure&error_description=Something+odd+at+line+42", GOOGLE_FAILED],
];

for (const [label, query, sentence] of REFUSALS) {
  test(`coming back refused (${label}) shows the plain sentence`, async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto(`/?${query}#${query}`);
    await expect(page.getByText(sentence)).toBeVisible({ timeout: 20_000 });
    // On the sign-in page, with nothing raw on it.
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByText(/line 42|Signups not allowed|Database error/)).toHaveCount(0);
    // The error is taken off the address, so a reload does not show it again.
    await expect.poll(() => page.url()).not.toContain("error=");
  });
}

test("an allow-listed user with an account still signs in by password", async ({ browser }) => {
  test.skip(SIGNUPS !== "off", "the sign-ups off stack is the one the issue names");
  const page = await freshPage(browser);
  await fillLogin(page, ADMIN, adminPassword);
  await expectSignedIn(page);
});
