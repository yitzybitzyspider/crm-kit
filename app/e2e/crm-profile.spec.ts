// team hub (issue 62): the profile, end to end, against the throwaway stack
// of the app workflow. Not upstream's file.
//
// Case 9: the profile shows the teammate's real name and nothing about
// upstream's MCP server, which was never deployed here.
// Case 12: a name edited on the profile is still there after signing out and
// in again. A sign-in updates the auth user, and upstream's trigger used to
// rewrite the name from the user's metadata, falling back to "Pending".
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("john@doe-com.example.org");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("people-board")).toBeVisible();
};

// The desktop profile is /profile; in a narrow window it is the settings page.
// The app's routes are hash routes.
const openProfile = async (page: Page, isMobile: boolean) => {
  await page.goto(isMobile ? "/#/settings" : "/#/profile");
  await expect(page.getByText("Profile", { exact: true }).first()).toBeVisible();
};

// react-admin's English text for signing out is "Logout".
const signOut = async (page: Page, isMobile: boolean) => {
  if (isMobile) {
    await page.getByRole("button", { name: "Logout" }).click();
  } else {
    await page
      .locator('header [data-slot="dropdown-menu-trigger"]')
      .last()
      .click();
    await page.getByRole("menuitem", { name: "Logout" }).click();
  }
  await expect(page.getByLabel("Password")).toBeVisible();
};

// Soft, so one run reports every part that is wrong, not only the first.
const expectName = async (page: Page, first: string, last: string) => {
  await expect.soft(page.getByText(first, { exact: true }).first()).toBeVisible();
  await expect.soft(page.getByText(last, { exact: true }).first()).toBeVisible();
  await expect.soft(page.getByText("Pending")).toHaveCount(0);
};

test.describe("the profile", () => {
  test.beforeEach(async ({ createSales }) => {
    // The fixture writes the name into public.sales only, as a name typed
    // there by hand would be: the auth user's metadata holds none.
    await createSales({
      first_name: "John",
      last_name: "Doe",
      email: "john@doe-com.example.org",
      password: "password",
    });
  });

  test("case 9 profile_has_no_mcp: the real name, and no text MCP", async ({
    page,
    isMobile,
  }) => {
    await signIn(page);
    await openProfile(page, isMobile);
    await expect.soft(page.locator("body")).not.toContainText("MCP");
    await expect.soft(page.locator("body")).not.toContainText("functions/v1/mcp");
    await expectName(page, "John", "Doe");
  });

  test("case 12 profile_edit_survives_sign_in: an edited name is still shown after signing out and in", async ({
    page,
    isMobile,
  }) => {
    await signIn(page);
    await openProfile(page, isMobile);
    if (isMobile) {
      await page.getByText("First name", { exact: true }).click();
      const input = page.locator("input:focus");
      await input.fill("Renée");
      await input.press("Enter");
      await expect(page.getByText("Renée", { exact: true })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("First name").fill("Renée");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Your profile has been updated")).toBeVisible();
    }
    await page.waitForLoadState("networkidle");

    await signOut(page, isMobile);
    await signIn(page);
    await openProfile(page, isMobile);
    await expectName(page, "Renée", "Doe");
  });
});
