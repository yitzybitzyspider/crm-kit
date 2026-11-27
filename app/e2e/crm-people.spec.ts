// team hub (issue 23): the people pipeline, end to end, against the
// throwaway stack of the app workflow. Not upstream's file.
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

const SHOTS = path.join("test-results", "kit");

// The first teammate the fixture makes gets the first free handle, alpha,
// whose prefix is SK.
const PREFIX = "AA";

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("john@doe-com.example.org");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("people-board")).toBeVisible();
};

const card = (page: Page, code: string) =>
  page.locator(`[data-testid="person-card"][data-person-code="${code}"]`);

const column = (page: Page, status: string) =>
  page.getByTestId(`people-column-${status}`);

const goToBoard = async (page: Page) => {
  await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByTestId("people-board")).toBeVisible();
};

// Moves a card with the keyboard, the way the board library supports it:
// space lifts, the arrows move one column, space drops.
const drag = async (page: Page, code: string, columnsRight: number) => {
  await card(page, code).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  for (let step = 0; step < columnsRight; step++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Space");
};

const addPerson = async (
  page: Page,
  firstName: string,
  lastName: string,
  more: { title?: string; company?: string; email?: string } = {},
) => {
  await page.getByRole("link", { name: "Add a person" }).first().click();
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill(lastName);
  if (more.title) {
    await page.getByLabel("Title").fill(more.title);
  }
  if (more.company) {
    await page.getByLabel("Company").click();
    await page.getByPlaceholder("Search").fill(more.company);
    await page.getByText(`Create ${more.company}`).click();
  }
  if (more.email) {
    await page
      .getByRole("group", { name: "Email addresses" })
      .getByRole("textbox", { name: "Email" })
      .fill(more.email);
  }
  await page.getByRole("button", { name: "Save" }).click();
};

const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
  expect(fs.statSync(file).size).toBeGreaterThan(5000);
};

test.describe("the people pipeline", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "The whole flow is covered on desktop; the narrow window has its own test",
  );

  test("a person is added, touched and moved; what the database refuses comes back", async ({
    page,
    baseURL,
    createSales,
    dismissToast,
  }, testInfo) => {
    await createSales({
      first_name: "John",
      last_name: "Doe",
      email: "john@doe-com.example.org",
      password: "password",
    });

    // case 16: every request of the whole run, held against the two hosts
    const allowed = new Set([
      new URL(baseURL!).host,
      new URL(process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341").host,
    ]);
    const elsewhere: string[] = [];
    let requests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "data:" || url.protocol === "blob:") return;
      requests += 1;
      if (!allowed.has(url.host)) elsewhere.push(request.url());
    });

    await signIn(page);

    // the board with nobody on it: seven columns and a prompt
    await expect(page.locator('[data-testid^="people-column-"] h3')).toHaveText(
      [
        "To contact",
        "Contacted",
        "Replied",
        "Scheduled",
        "Interviewed",
        "Declined",
        "Do not contact",
      ],
    );
    await expect(page.getByText(/Nobody is on file yet/)).toBeVisible();

    // case 11: add Maria Okafor
    await addPerson(page, "Maria", "Okafor", {
      email: "maria.okafor@example-test.example.org",
    });
    await dismissToast("Element created");
    await expect(page.locator("h5")).toContainText("Maria Okafor");
    await expect(page.locator("h5")).toContainText(`${PREFIX}-01`);
    await goToBoard(page);
    await expect(
      column(page, "to-contact").locator(card(page, `${PREFIX}-01`)),
    ).toBeVisible();
    await expect(card(page, `${PREFIX}-01`)).toContainText("Maria Okafor");
    await expect(card(page, `${PREFIX}-01`)).toContainText("alpha");

    // case 12: open her and log a touch by email with a next step and a due date
    await card(page, `${PREFIX}-01`).click();
    await expect(page.locator("h5")).toContainText("Maria Okafor");
    await page
      .getByPlaceholder("Add a note")
      .fill("Wrote to Maria about the study <b>not bold</b>");
    await page.getByRole("combobox", { name: /Channel/ }).click();
    await page.getByRole("option", { name: "Email" }).click();
    await page.getByLabel("Next step").fill("Follow up");
    await page.getByLabel("Due by").fill("2026-12-15");
    await page.getByRole("button", { name: "Add this note" }).click();
    await dismissToast("Note added");
    const touch = page.getByTestId("touch").first();
    await expect(touch).toContainText(
      "Wrote to Maria about the study <b>not bold</b>",
    );
    await expect(touch).toContainText("You added a note");
    await expect(touch).toContainText("Email");
    await expect(touch).toContainText("Follow up");
    await expect(touch).toContainText("2026-12-15");
    // case 17: the person page
    await shoot(page, testInfo, "person-page");

    await goToBoard(page);
    await expect(
      column(page, "contacted").locator(card(page, `${PREFIX}-01`)),
    ).toBeVisible();
    await expect(card(page, `${PREFIX}-01`)).toContainText("Follow up");
    await expect(card(page, `${PREFIX}-01`)).toContainText("2026-12-15");

    // case 13: drag her to replied; after a reload she is still there
    await drag(page, `${PREFIX}-01`, 1);
    await expect(
      column(page, "replied").locator(card(page, `${PREFIX}-01`)),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(
      column(page, "replied").locator(card(page, `${PREFIX}-01`)),
    ).toBeVisible();
    await expect(
      column(page, "contacted").getByTestId("person-card"),
    ).toHaveCount(0);

    // case 14: a second person with no touch cannot be dragged to scheduled
    // (with a role, a new organization and an email: saving a person or a
    // company must ask no other host for a picture or an icon, case 16)
    await addPerson(page, "Sam", "Rivera", {
      title: "Charge nurse",
      company: "Riverbend Clinic",
      email: "sam.rivera@example-test.example.org",
    });
    await dismissToast("Element created");
    await expect(page.locator("h5")).toContainText(`${PREFIX}-02`);
    await goToBoard(page);
    await expect(
      column(page, "to-contact").locator(card(page, `${PREFIX}-02`)),
    ).toBeVisible();
    await expect(card(page, `${PREFIX}-02`)).toContainText(
      "Charge nurse, Riverbend Clinic",
    );
    await drag(page, `${PREFIX}-02`, 3);
    await expect(
      page.getByText("the status scheduled needs at least one touch on file"),
    ).toBeVisible();
    await expect(
      column(page, "to-contact").locator(card(page, `${PREFIX}-02`)),
    ).toBeVisible();
    await expect(
      column(page, "scheduled").getByTestId("person-card"),
    ).toHaveCount(0);
    // case 17: the board, with two people, a next step and the refusal on it
    await shoot(page, testInfo, "board");
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(
      column(page, "to-contact").locator(card(page, `${PREFIX}-02`)),
    ).toBeVisible();
    await expect(page.getByTestId("person-card")).toHaveCount(2);

    // case 15: the same person under a title and a credential is refused by name
    await addPerson(page, "Dr. Maria", "Okafor, MD");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: `this person is already on file as ${PREFIX}-01` }),
    ).toBeVisible();
    await expect(page.getByLabel("First name")).toHaveValue("Dr. Maria");
    await expect(page.getByLabel("Last name")).toHaveValue("Okafor, MD");
    await goToBoard(page);
    await expect(page.getByTestId("person-card")).toHaveCount(2);

    // edge: a deals address typed by hand is not a working deals screen
    await page.goto("/#/deals");
    await expect(page.getByRole("link", { name: "People" })).toBeVisible();
    await expect(page.locator("[data-rfd-droppable-id]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create deal" })).toHaveCount(
      0,
    );

    // case 16
    await page.waitForLoadState("networkidle");
    expect(requests).toBeGreaterThan(20);
    expect(elsewhere).toEqual([]);
  });
});

test.describe("the people board in a narrow window", () => {
  test.skip(({ isMobile }) => !isMobile, "Covered by the desktop flow");

  test("the board scrolls sideways and a card still opens the person", async ({
    page,
    createSales,
    createContact,
  }) => {
    const teammate = await createSales({
      first_name: "John",
      last_name: "Doe",
      email: "john@doe-com.example.org",
      password: "password",
    });
    await createContact({
      first_name: "Maria",
      last_name: "Okafor",
      title: "Charge nurse",
      sales_id: teammate.id,
    });

    await signIn(page);
    await expect(card(page, `${PREFIX}-01`)).toContainText("Maria Okafor");

    const sideways = await page
      .getByTestId("people-board")
      .evaluate((board) => board.scrollWidth > board.clientWidth);
    expect(sideways).toBe(true);
    const pageFits = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    );
    expect(pageFits).toBe(true);

    await card(page, `${PREFIX}-01`).click();
    await expect(page.locator("h2")).toContainText("Maria Okafor");
    await expect(page.locator("h2")).toContainText(`${PREFIX}-01`);
  });
});
