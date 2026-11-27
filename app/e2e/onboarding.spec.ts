import { test, expect } from "./fixtures";

test("user onboarding", async ({
  page,
  isMobile,
  menu,
  dismissToast,
  giveHandle,
}) => {
  await page.goto("/");

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/team hub/);
  await expect(page.getByText("Welcome to team hub")).toBeVisible();

  await page.getByLabel("First name").fill("John");
  await page.getByLabel("Last name").fill("Doe");
  await page.getByLabel("Email").fill("john@doe-com.example.org");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Create account" }).click();

  // team hub (issue 23): a teammate lands on the people board; the
  // dashboard and its first steps are one click away
  await menu.goToDashboard();

  await expect(page.getByText("What's next?")).toBeVisible();
  // team hub (issue 21): a teammate needs a handle before they can own a person
  giveHandle("john@doe-com.example.org");
  await expect(page.getByText("1/3 done")).toBeVisible();
  await expect(page.getByText("Install team hub")).toBeVisible();
  await expect(page.getByText("Add your first contact")).toBeVisible();
  await expect(page.getByText("Add your first note")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import data" })).toBeVisible();

  await page
    .getByRole(isMobile ? "button" : "link", { name: "Add contact" })
    .click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("radio", { name: "She/Her" }).click();
  await page.getByLabel("First name").fill("Jane");
  await page.getByLabel("Last name").fill("Smith");
  await page.getByLabel("Title").fill("CEO");
  await page.getByLabel("Company").click();
  await page.getByPlaceholder("Search").fill("Smith Corp");
  await page.getByText("Create Smith Corp").click();
  await page
    .getByRole("group", { name: "Email addresses" })
    .getByRole("textbox", { name: "Email" })
    .fill("jane@smithcorp-com.example.org");
  await page
    .getByRole("group", { name: "Email addresses" })
    .getByRole("button", { name: "Add" })
    .click();

  await page
    .getByRole("group", { name: "Phone numbers" })
    .getByRole("textbox", { name: "Phone number" })
    .fill("+1234567890");
  await page
    .getByRole("group", { name: "Phone numbers" })
    .getByRole("button", { name: "Add" })
    .click();

  await page
    .getByLabel("LinkedIn URL")
    .fill("https://www.linkedin.com/in/jane-smith");

  await page
    .getByLabel("Background info (bio, how you met, etc)")
    .fill("Met at a conference.");

  await page.getByRole("switch", { name: "Has newsletter" }).check();

  await expect(page.getByLabel("Account manager *")).toHaveText("John Doe");

  await page.getByRole("button", { name: "Save" }).click();

  // Mobile shows no success snackbar
  if (!isMobile) {
    await dismissToast("Element created");
  }

  // team hub (issue 23): the person code stands beside the name
  await expect(page.locator(isMobile ? "h2" : "h5")).toContainText(
    "Jane Smith",
  );
  await expect(page.getByText("CEO at Smith Corp")).toBeVisible();

  await menu.goToDashboard();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("2/3 done")).toBeVisible();

  await page
    .getByRole(isMobile ? "button" : "link", { name: "Add note" })
    .click();

  await page.waitForLoadState("networkidle");

  await page.getByPlaceholder("Add a note").fill("This is a note about Jane.");
  // team hub (issue 23): a touch needs a channel
  await page.getByRole("combobox", { name: /Channel/ }).click();
  await page.getByRole("option", { name: "Email" }).click();
  await page
    .getByRole("button", { name: isMobile ? "Save" : "Add this note" })
    .click();

  // Mobile shows no success snackbar
  if (!isMobile) {
    await dismissToast("Note added");
  }

  await expect(
    page.getByText(isMobile ? "Me" : "You added a note", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("This is a note about Jane.")).toBeVisible();

  await menu.goToDashboard();

  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Latest Activity")).toBeVisible();
  await expect(
    page.getByText("Latest Activity").locator("xpath=../.."),
  ).toHaveText(/You added company Smith Corp today at/);

  await expect(
    page.getByText("Latest Activity").locator("xpath=../.."),
  ).toHaveText(/You added Jane Smith to Smith Corp today at/);

  await expect(
    page.getByText("Latest Activity").locator("xpath=../.."),
  ).toHaveText(/You added a note about Jane Smith today at/);
});
