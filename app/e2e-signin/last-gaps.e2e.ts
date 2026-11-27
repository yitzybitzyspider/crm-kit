// team hub, issue 47 (B13): the attachments bucket and the sign-up list's
// refusal, through the API and the screens. Runs in .github/workflows/signin.yml
// with signin.e2e.ts, against the same throwaway stack. Not serial on purpose:
// a failure here does not hide the cases after it.
import { test, expect } from "@playwright/test";
import {
  admin,
  API,
  PUBLIC_KEY,
  SIGNUPS,
  counts,
  createFirstUser,
  expectSignedIn,
  fillLogin,
  freshPage,
  newPassword,
  passwordGrant,
  quote,
  resetAll,
  setAllowList,
  sql,
  teammate,
} from "./helpers";

const ADMIN = "admin@example-test.example.org";
const STRANGER = "stranger@example-test.example.org";
const TEAMMATE = "teammate@example-test.example.org";
const THIRD = "third@example-test.example.org";

test.beforeEach(async () => {
  await resetAll();
});

async function tokenOf(email: string, password: string) {
  const { status, json } = await passwordGrant(email, password);
  expect(status, JSON.stringify(json)).toBe(200);
  return json.access_token as string;
}

// What the service key reads of one file, or null when it is not there.
async function fileText(name: string) {
  const { data, error } = await admin.storage.from("attachments").download(name);
  return error || !data ? null : await data.text();
}

test.describe("issue 47, sign-ups switched off", () => {
  test.skip(SIGNUPS !== "off", "needs a stack started with sign-ups off");

  test("item 1: a signed in teammate cannot upload, read, change or delete a file in the attachments bucket", async () => {
    const password = newPassword();
    await createFirstUser(ADMIN, password);
    const token = await tokenOf(ADMIN, password);
    const asTeammate = { apikey: PUBLIC_KEY, authorization: `Bearer ${token}` };

    // a file already there (the cloud has none; an old one is what this guards)
    const kept = `old-${crypto.randomUUID()}.txt`;
    const placed = await admin.storage.from("attachments").upload(kept, "made up old file", { contentType: "text/plain" });
    expect(placed.error, JSON.stringify(placed.error)).toBeNull();

    const fresh = `new-${crypto.randomUUID()}.txt`;
    const upload = await fetch(`${API}/storage/v1/object/attachments/${fresh}`, {
      method: "POST",
      headers: { ...asTeammate, "content-type": "text/plain" },
      body: "put there by a teammate",
    });
    const read = await fetch(`${API}/storage/v1/object/authenticated/attachments/${kept}`, { headers: asTeammate });
    const change = await fetch(`${API}/storage/v1/object/attachments/${kept}`, {
      method: "PUT",
      headers: { ...asTeammate, "content-type": "text/plain" },
      body: "changed by a teammate",
    });
    const remove = await fetch(`${API}/storage/v1/object/attachments/${kept}`, { method: "DELETE", headers: asTeammate });
    const listed = await fetch(`${API}/storage/v1/object/list/attachments`, {
      method: "POST",
      headers: { ...asTeammate, "content-type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 100 }),
    });
    const names = listed.ok ? ((await listed.json()) as { name: string }[]).map((f) => f.name) : [];
    console.log(
      `a signed in teammate and the attachments bucket: upload ${upload.status}, read ${read.status}, ` +
        `change ${change.status}, delete ${remove.status}, list ${listed.status} naming ${names.length} file(s)`,
    );

    expect(upload.status, "upload").toBeGreaterThanOrEqual(400);
    expect(await fileText(fresh), "the uploaded file is not there").toBeNull();
    expect(read.status, "read").toBeGreaterThanOrEqual(400);
    expect(change.status, "change").toBeGreaterThanOrEqual(400);
    expect(names, "the list shows the teammate nothing").toEqual([]);
    expect(await fileText(kept), "the old file is still there, unchanged, after the delete").toBe("made up old file");
  });

  test("item 4: neither the public key nor a signed in teammate reaches a large object function through the API", async () => {
    const password = newPassword();
    await createFirstUser(ADMIN, password);
    const token = await tokenOf(ADMIN, password);
    const before = sql("select count(*) from pg_catalog.pg_largeobject_metadata");
    for (const bearer of [PUBLIC_KEY, token]) {
      for (const [fn, args] of [
        ["lo_creat", { "": -1 }],
        ["lo_from_bytea", { "": 0 }],
        ["lo_create", { "": 0 }],
      ] as const) {
        const call = await fetch(`${API}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify(args),
        });
        expect([401, 403, 404], `${fn} answered ${call.status}`).toContain(call.status);
      }
    }
    expect(sql("select count(*) from pg_catalog.pg_largeobject_metadata")).toBe(before);
  });

  test("item 6: inviting an email that is not on the hub's list says so in plain words", async ({ browser }) => {
    const password = newPassword();
    await createFirstUser(ADMIN, password);
    const page = await freshPage(browser);
    await fillLogin(page, ADMIN, password);
    await expectSignedIn(page);
    await page.goto("/#/sales");
    await page.getByRole("link", { name: "New user" }).click();
    await page.getByLabel("First name").fill("Sam");
    await page.getByLabel("Last name").fill("Stranger");
    await page.getByLabel("Email").fill(STRANGER);
    const answered = page.waitForResponse((r) => r.url().includes("/functions/v1/users") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save" }).click();
    const response = await answered;
    console.log(`inviting an email not on the list: the users function answers ${response.status()} ${await response.text()}`);
    await expect(page.getByText(/this email is not on the hub's list/i)).toBeVisible();
    await expect(page.getByText(/database error/i)).toHaveCount(0);
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });
});

// The router's addition to issue 47: the administrator makes each teammate's
// account in the Supabase dashboard, which calls the administrator API with
// an id of its own. Run where sign-ups are off, as on the cloud project.
test.describe("issue 47, a teammate's account made from the dashboard", () => {
  test.skip(SIGNUPS !== "off", "needs a stack started with sign-ups off");

  const dashboardCreates = (email: string) =>
    admin.auth.admin.createUser({ email, password: newPassword(), email_confirm: true });

  test("an invited address on the list gets an account as teammate 2", async () => {
    await createFirstUser(ADMIN, newPassword());
    // what the administrator runs in the SQL editor (before issue 47 there
    // was no such function, and the account below was refused all the same)
    try {
      sql(`select public.invite_teammate_email(${quote(TEAMMATE)})`);
    } catch (error) {
      console.log(`invite_teammate_email could not be run: ${String(error).slice(0, 200)}`);
    }
    const { error } = await dashboardCreates(TEAMMATE);
    console.log(`the dashboard making an invited account on the list: ${JSON.stringify(error)}`);
    expect(error, JSON.stringify(error)).toBeNull();
    expect(counts()).toEqual({ users: 2, sales: 2 });
    expect(teammate(TEAMMATE)?.administrator).toBe(false);
  });

  test("an address on the list that was not invited is refused after the first user", async () => {
    await createFirstUser(ADMIN, newPassword());
    setAllowList([ADMIN, TEAMMATE, THIRD]);
    const { error } = await dashboardCreates(THIRD);
    console.log(`the dashboard making an account on the list but not invited: ${JSON.stringify(error)}`);
    expect(error).not.toBeNull();
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("an invited address that is not on the list is refused", async () => {
    await createFirstUser(ADMIN, newPassword());
    sql(`select public.invite_teammate_email(${quote(STRANGER)})`);
    const { error } = await dashboardCreates(STRANGER);
    expect(error).not.toBeNull();
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("neither the public key nor a signed in teammate can invite through the API", async () => {
    const password = newPassword();
    await createFirstUser(ADMIN, password);
    const token = await tokenOf(ADMIN, password);
    for (const bearer of [PUBLIC_KEY, token]) {
      const call = await fetch(`${API}/rest/v1/rpc/invite_teammate_email`, {
        method: "POST",
        headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ user_email: STRANGER }),
      });
      expect([401, 403, 404], `invite_teammate_email answered ${call.status}`).toContain(call.status);
    }
    expect(sql("select count(*) from hub_private.invited_emails")).toBe("0");
  });
});

test.describe("issue 47, the trigger alone, sign-ups left on", () => {
  test.skip(SIGNUPS !== "on", "needs a stack started with sign-ups on");

  test("item 6: a stranger on the first user form is told the email is not on the hub's list", async ({ page }) => {
    expect(counts()).toEqual({ users: 0, sales: 0 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible({ timeout: 20_000 });
    await page.locator("#first_name").fill("Sam");
    await page.locator("#last_name").fill("Stranger");
    await page.locator("#email").fill(STRANGER);
    await page.locator("#password").fill(newPassword());
    const answered = page.waitForResponse((r) => r.url().includes("/auth/v1/signup"));
    await page.getByRole("button", { name: "Create account" }).click();
    const response = await answered;
    console.log(`the first user form, a stranger: the sign-up endpoint answers ${response.status()} ${await response.text()}`);
    expect(response.status()).toBe(500);
    await expect(page.getByText(/this email is not on the hub's list/i)).toBeVisible();
    await expect(page.getByText(/database error/i)).toHaveCount(0);
    expect(counts()).toEqual({ users: 0, sales: 0 });
  });
});
