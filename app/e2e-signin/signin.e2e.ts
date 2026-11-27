// team hub, issue 25 (B6): who can get in, and who cannot.
// Runs in .github/workflows/signin.yml against a throwaway stack. The numbers
// in the titles are the test cases of issue 25. HUB_SIGNUPS says how the
// stack was started: "off" (cases 1 to 11) or "on" (case 12, the database
// trigger alone).
import { test, expect } from "@playwright/test";
import {
  admin,
  API,
  PUBLIC_KEY,
  SIGNUPS,
  auth,
  counts,
  createFirstUser,
  expectNotSignedIn,
  expectSignedIn,
  fillLogin,
  freshPage,
  linkFromMail,
  mailCount,
  newPassword,
  passwordGrant,
  quote,
  resetAll,
  setAllowList,
  signedIn,
  sql,
  stranger,
  teammate,
  usersFunction,
} from "./helpers";

const ADMIN = "admin@example-test.example.org";
const TEAMMATE = "teammate@example-test.example.org";
const STRANGER = "stranger@example-test.example.org";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await resetAll();
});

const settings = async () =>
  (await fetch(`${API}/auth/v1/settings`, { headers: { apikey: PUBLIC_KEY } })).json();

// The administrator invites the teammate from the Users screen, and the
// teammate sets a password at the link in the mail. Gives back what later
// cases need.
async function inviteThroughTheScreens(browser: import("@playwright/test").Browser) {
  const adminPassword = newPassword();
  await createFirstUser(ADMIN, adminPassword);
  const adminPage = await freshPage(browser);
  await fillLogin(adminPage, ADMIN, adminPassword);
  await expectSignedIn(adminPage);
  await adminPage.goto("/#/sales");
  await adminPage.getByRole("link", { name: "New user" }).click();
  await adminPage.getByLabel("First name").fill("Tess");
  await adminPage.getByLabel("Last name").fill("Mate");
  await adminPage.getByLabel("Email").fill(TEAMMATE);
  await adminPage.getByRole("button", { name: "Save" }).click();
  await expect(adminPage.getByText(/^User created/)).toBeVisible();
  const link = await linkFromMail(TEAMMATE);
  return { adminPassword, adminPage, link };
}

async function setPasswordAt(page: import("@playwright/test").Page, link: string, password: string) {
  await page.goto(link);
  await expect(page.getByText("Choose your password")).toBeVisible({ timeout: 20_000 });
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole("button", { name: "Save" }).click();
}

async function tokenOf(email: string, password: string) {
  const { status, json } = await passwordGrant(email, password);
  expect(status, JSON.stringify(json)).toBe(200);
  return json.access_token as string;
}

test.describe("sign-ups switched off", () => {
  test.skip(SIGNUPS !== "off", "needs a stack started with sign-ups off");

  test("case 1: a stranger posting to the sign-up endpoint is refused, before and after the first user", async () => {
    expect((await settings()).disable_signup, "the stack says sign-ups are off").toBe(true);

    // on an empty database: only the setting can refuse, the trigger would let a first user in
    const first = await auth("signup", { email: STRANGER, password: newPassword() });
    expect(first.status, JSON.stringify(first.json)).toBeGreaterThanOrEqual(400);
    expect(first.json?.error_code).toBe("signup_disabled");
    expect(counts()).toEqual({ users: 0, sales: 0 });

    // the order that works: sign-ups off, then the first user made by the administrator API
    await createFirstUser(ADMIN, newPassword());
    expect(counts()).toEqual({ users: 1, sales: 1 });
    expect(teammate(ADMIN)?.administrator).toBe(true);

    const second = await auth("signup", { email: STRANGER, password: newPassword() });
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.json?.error_code).toBe("signup_disabled");
    const { error } = await stranger().auth.signUp({ email: STRANGER, password: newPassword() });
    expect(error).not.toBeNull();
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("case 2: the app offers no sign-up, and its address typed by hand creates nobody", async ({ page }) => {
    // no user at all: upstream sends the visitor to its first user form. Submitting it creates nobody.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible({ timeout: 20_000 });
    await page.locator("#first_name").fill("Sam");
    await page.locator("#last_name").fill("Stranger");
    await page.locator("#email").fill(STRANGER);
    await page.locator("#password").fill(newPassword());
    const answered = page.waitForResponse((r) => r.url().includes("/auth/v1/signup"));
    await page.getByRole("button", { name: "Create account" }).click();
    expect((await answered).status()).toBeGreaterThanOrEqual(400);
    expect(counts()).toEqual({ users: 0, sales: 0 });
    await expect(signedIn(page)).toHaveCount(0);

    // once a first user exists: the login form, with no way to the sign-up form
    await createFirstUser(ADMIN, newPassword());
    const visitor = await freshPage(page.context().browser()!);
    await visitor.goto("/");
    await expect(visitor.getByRole("button", { name: "Sign in", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(visitor.getByRole("button", { name: "Create account" })).toHaveCount(0);
    await expect(visitor.getByRole("link", { name: /sign.?up|create/i })).toHaveCount(0);
    await visitor.goto("/#/sign-up");
    await expect(visitor.getByRole("button", { name: "Sign in", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(visitor.getByRole("button", { name: "Create account" })).toHaveCount(0);
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("case 3: an email that was never invited is refused in the words a wrong password gets", async ({ page }) => {
    const adminPassword = newPassword();
    await createFirstUser(ADMIN, adminPassword);

    const unknown = await passwordGrant(STRANGER, newPassword());
    const wrong = await passwordGrant(ADMIN, newPassword());
    expect(unknown.status).toBe(400);
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.json).toEqual(unknown.json);

    await fillLogin(page, STRANGER, newPassword());
    await expect(page.getByText(/invalid login credentials/i).first()).toBeVisible();
    await expectNotSignedIn(page);
    const wrongPage = await freshPage(page.context().browser()!);
    await fillLogin(wrongPage, ADMIN, newPassword());
    await expect(wrongPage.getByText(/invalid login credentials/i).first()).toBeVisible();
    await expectNotSignedIn(wrongPage);

    // an empty form asks nothing of the server
    const emptyPage = await freshPage(page.context().browser()!);
    await emptyPage.goto("/");
    let asked = false;
    emptyPage.on("request", (r) => {
      if (r.url().includes("/auth/v1/token")) asked = true;
    });
    await emptyPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expectNotSignedIn(emptyPage);
    expect(asked).toBe(false);

    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("case 4: forgot password for an unknown email creates nobody and answers as for a known one", async ({ page }) => {
    await createFirstUser(ADMIN, newPassword());

    const unknown = await auth("recover", { email: STRANGER });
    const known = await auth("recover", { email: ADMIN });
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(unknown.status);
    expect(known.json).toEqual(unknown.json);
    await linkFromMail(ADMIN);
    expect(await mailCount(STRANGER)).toBe(0);
    expect(counts()).toEqual({ users: 1, sales: 1 });

    await page.goto("/#/forgot-password");
    await page.getByLabel("Email").fill("another-stranger@example-test.example.org");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText(/If you're a registered user/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("cases 5 and 6: an invitation arrives, its link sets a password once, and a second use is refused", async ({ browser }) => {
    const { link } = await inviteThroughTheScreens(browser);
    expect(counts()).toEqual({ users: 2, sales: 2 });

    const password = newPassword();
    const teammatePage = await freshPage(browser);
    await setPasswordAt(teammatePage, link, password);
    await expectSignedIn(teammatePage);

    // the teammate signs in afresh with the password they chose
    const later = await freshPage(browser);
    await fillLogin(later, TEAMMATE, password);
    await expectSignedIn(later);
    expect(teammate(TEAMMATE)?.administrator).toBe(false);

    // case 6: the same link again
    const again = await fetch(link, { redirect: "manual" });
    const where = again.headers.get("location") ?? "";
    console.log(`a used invitation link answers ${again.status} and sends the browser to: ${where.replace(/access_token=[^&]+/, "access_token=<hidden>")}`);
    expect(where).toMatch(/error/);
    expect(where).not.toMatch(/access_token=/);
    const second = await freshPage(browser);
    await second.goto(link);
    await second.waitForLoadState("networkidle");
    await expect(second.getByText("Choose your password")).toHaveCount(0);
    await expect(signedIn(second)).toHaveCount(0);
    console.log(`what the page shows after a used link: ${(await second.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
  });

  test("case 6, expired: a link past its time is refused, and forgot password gives the teammate a new one", async ({ browser }) => {
    const { link } = await inviteThroughTheScreens(browser);
    // make the invitation as old as two days, as the database sees it
    sql(
      `update auth.users set invited_at = now() - interval '2 days',
              confirmation_sent_at = now() - interval '2 days'
       where email = ${quote(TEAMMATE)}`,
    );
    const expired = await fetch(link, { redirect: "manual" });
    const where = expired.headers.get("location") ?? "";
    expect(where).toMatch(/error/);
    expect(where).not.toMatch(/access_token=/);

    // the teammate asks for a new link from the login page
    const page = await freshPage(browser);
    await page.goto("/#/forgot-password");
    await page.getByLabel("Email").fill(TEAMMATE);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText(/If you're a registered user/)).toBeVisible();
    const fresh = await linkFromMail(TEAMMATE, 2);
    expect(fresh).not.toBe(link);
    const password = newPassword();
    const setPage = await freshPage(browser);
    await setPasswordAt(setPage, fresh, password);
    await expectSignedIn(setPage);
    const later = await freshPage(browser);
    await fillLogin(later, TEAMMATE, password);
    await expectSignedIn(later);
  });

  test("case 7: an invited teammate who has not set a password cannot sign in", async ({ browser }) => {
    await inviteThroughTheScreens(browser);
    for (const guess of ["", "password", newPassword()]) {
      const { status } = await passwordGrant(TEAMMATE, guess);
      expect(status).toBeGreaterThanOrEqual(400);
    }
    const page = await freshPage(browser);
    await fillLogin(page, TEAMMATE, newPassword());
    await expect(page.getByText(/invalid login credentials/i).first()).toBeVisible();
    await expectNotSignedIn(page);
  });

  test("case 8: a new teammate has no handle until set_teammate_handle gives one", async ({ browser }) => {
    const { link } = await inviteThroughTheScreens(browser);
    const password = newPassword();
    const page = await freshPage(browser);
    await setPasswordAt(page, link, password);
    await expectSignedIn(page);

    const before = teammate(TEAMMATE);
    expect(before.handle).toBeNull();
    expect(before.id_prefix).toBeNull();
    // a teammate with no handle cannot yet add a person
    const token = await tokenOf(TEAMMATE, password);
    const early = await fetch(`${API}/rest/v1/rpc/add_person`, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Made Up Person" }),
    });
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await early.json())).toContain("no handle yet");

    // the line of docs/INVITE.md, as the SQL editor would run it
    sql(`select public.set_teammate_handle(${quote(TEAMMATE)}, 'bravo')`);
    const after = teammate(TEAMMATE);
    expect(after.handle).toBe("bravo");
    expect(after.id_prefix).toBe("BB");
  });

  test("case 9: a teammate marked disabled cannot sign in, and a session they hold stops writing", async ({ browser }) => {
    const { link, adminPassword } = await inviteThroughTheScreens(browser);
    const password = newPassword();
    const page = await freshPage(browser);
    await setPasswordAt(page, link, password);
    await expectSignedIn(page);
    sql(`select public.set_teammate_handle(${quote(TEAMMATE)}, 'bravo')`);
    const held = await passwordGrant(TEAMMATE, password);
    expect(held.status).toBe(200);
    const row = teammate(TEAMMATE);

    // what the Users screen sends when the administrator ticks Disabled
    const adminToken = await tokenOf(ADMIN, adminPassword);
    const patched = await usersFunction("PATCH", adminToken, {
      sales_id: row.id,
      email: TEAMMATE,
      first_name: "Tess",
      last_name: "Mate",
      administrator: false,
      disabled: true,
    });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    expect(teammate(TEAMMATE).disabled).toBe(true);

    const refused = await passwordGrant(TEAMMATE, password);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    console.log(`sign-in of a disabled teammate answers ${refused.status}: ${JSON.stringify(refused.json)}`);
    const again = await freshPage(browser);
    await fillLogin(again, TEAMMATE, password);
    await expectNotSignedIn(again);

    // the session they already hold
    const headers = {
      apikey: PUBLIC_KEY,
      authorization: `Bearer ${held.json.access_token}`,
      "content-type": "application/json",
    };
    const action = await fetch(`${API}/rest/v1/rpc/add_person`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Made Up Person" }),
    });
    expect(action.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await action.json())).toContain("disabled");
    const refresh = await auth("token?grant_type=refresh_token", { refresh_token: held.json.refresh_token });
    console.log(`a disabled teammate's refresh answers ${refresh.status}: ${JSON.stringify(refresh.json?.error_code ?? refresh.json?.msg ?? "a new session")}`);
    expect(refresh.status).toBeGreaterThanOrEqual(400);
    // recorded, not required: what a held session can still do outside the fixed actions
    const read = await fetch(`${API}/rest/v1/contacts?select=id&limit=1`, { headers });
    const direct = await fetch(`${API}/rest/v1/companies`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Written while disabled" }),
    });
    console.log(`with the session held from before: a read of people answers ${read.status}, a direct insert of a company answers ${direct.status}`);
  });

  test("case 10: the right password signs in, the wrong one does not, capitals are the same teammate", async ({ browser }) => {
    const { link } = await inviteThroughTheScreens(browser);
    const password = newPassword();
    const page = await freshPage(browser);
    await setPasswordAt(page, link, password);
    await expectSignedIn(page);

    const right = await passwordGrant(TEAMMATE, password);
    expect(right.status).toBe(200);
    const wrong = await passwordGrant(TEAMMATE, `${password}x`);
    expect(wrong.status).toBe(400);
    const capitals = await passwordGrant(TEAMMATE.toUpperCase(), password);
    expect(capitals.status).toBe(200);
    expect(capitals.json.user.id).toBe(right.json.user.id);

    const typed = await freshPage(browser);
    await fillLogin(typed, `  ${TEAMMATE.toUpperCase()}  `, password);
    await expectSignedIn(typed);
    const wrongPage = await freshPage(browser);
    await fillLogin(wrongPage, TEAMMATE, `${password}x`);
    await expectNotSignedIn(wrongPage);
    expect(counts()).toEqual({ users: 2, sales: 2 });

    // a password of one character is refused; the answer names the minimum
    const short = await auth("user", { password: "a" }, right.json.access_token, "PUT");
    expect(short.status).toBeGreaterThanOrEqual(400);
    console.log(`a one character password answers ${short.status}: ${JSON.stringify(short.json)}`);
    const stillRight = await passwordGrant(TEAMMATE, password);
    expect(stillRight.status).toBe(200);
  });

  test("what a stranger holding the public key can reach through the API", async () => {
    const adminPassword = newPassword();
    await createFirstUser(ADMIN, adminPassword);
    const key = { apikey: PUBLIC_KEY, authorization: `Bearer ${PUBLIC_KEY}`, "content-type": "application/json" };

    // the one thing the sign-in page asks before sign-in
    const init = await fetch(`${API}/rest/v1/init_state?select=is_initialized`, { headers: key });
    expect(init.status).toBe(200);
    expect(await init.json()).toEqual([{ is_initialized: 1 }]);

    // every table, view and function of the hub: refused, not merely empty
    for (const name of [
      "sales", "contacts", "contact_notes", "companies", "interviews", "interview_transcripts",
      "interview_hypotheses", "call_inbox", "audit_log", "follow_ups", "contacts_summary",
      "companies_summary", "activity_log", "deals", "deal_notes", "tasks", "tags", "configuration",
      "user_invitations",
    ]) {
      const read = await fetch(`${API}/rest/v1/${name}?select=*&limit=1`, { headers: key });
      expect([401, 403, 404], `${name} answered ${read.status}`).toContain(read.status);
    }
    for (const [fn, args] of [
      ["find_person", { query: "a" }],
      ["add_person", { name: "Made Up Person" }],
      ["set_teammate_handle", { user_email: ADMIN, handle: "delta" }],
      ["merge_contacts", { loser_id: 1, winner_id: 2 }],
      ["is_admin", {}],
      ["http_get", { uri: "http://127.0.0.1:1/" }],
    ] as const) {
      const call = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: "POST", headers: key, body: JSON.stringify(args) });
      expect([401, 403, 404], `${fn} answered ${call.status}`).toContain(call.status);
    }

    // what the API describes of itself to a stranger
    const root = await fetch(`${API}/rest/v1/`, { headers: key });
    const described = root.ok ? Object.keys((await root.json()).paths ?? {}).sort() : [];
    console.log(`the API's own description, asked with the public key, answers ${root.status} and lists: ${described.join(" ") || "nothing"}`);
    for (const path of described) {
      expect(["/", "/init_state"]).toContain(path);
    }

    // GraphQL, the other door of the API: what it offers a stranger
    const graphql = await fetch(`${API}/graphql/v1`, {
      method: "POST",
      headers: key,
      body: JSON.stringify({
        query: "{ __schema { queryType { fields { name } } mutationType { fields { name } } } }",
      }),
    });
    const schema = (await graphql.json().catch(() => null))?.data?.__schema;
    const offered = [
      ...(schema?.queryType?.fields ?? []),
      ...(schema?.mutationType?.fields ?? []),
    ].map((f: { name: string }) => f.name).sort();
    console.log(`GraphQL, asked with the public key, answers ${graphql.status} and offers: ${offered.join(" ") || "nothing"}`);
    for (const name of offered) {
      expect(["node", "initStateCollection"], `GraphQL offers ${name} to a stranger`).toContain(name);
    }

    // files: one is put in the attachments bucket with the service key. Since
    // issue 47 a signed in teammate cannot upload there (last-gaps.e2e.ts).
    const adminToken = await tokenOf(ADMIN, adminPassword);
    const fileName = `probe-${crypto.randomUUID()}.txt`;
    const upload = await admin.storage.from("attachments").upload(fileName, "made up text", { contentType: "text/plain" });
    expect(upload.error, JSON.stringify(upload.error)).toBeNull();
    // a stranger cannot list the bucket, change the file or remove it
    const list = await fetch(`${API}/storage/v1/object/list/attachments`, {
      method: "POST",
      headers: key,
      body: JSON.stringify({ prefix: "", limit: 100 }),
    });
    const listed = list.ok ? await list.json() : [];
    expect(listed, `listing answered ${list.status}`).toEqual([]);
    const overwrite = await fetch(`${API}/storage/v1/object/attachments/${fileName}`, {
      method: "PUT",
      headers: { ...key, "content-type": "text/plain" },
      body: "changed by a stranger",
    });
    expect(overwrite.status).toBeGreaterThanOrEqual(400);
    const remove = await fetch(`${API}/storage/v1/object/attachments/${fileName}`, { method: "DELETE", headers: key });
    expect(remove.status).toBeGreaterThanOrEqual(400);
    const upAsStranger = await fetch(`${API}/storage/v1/object/attachments/stranger-${crypto.randomUUID()}.txt`, {
      method: "POST",
      headers: { ...key, "content-type": "text/plain" },
      body: "put there by a stranger",
    });
    expect(upAsStranger.status).toBeGreaterThanOrEqual(400);
    // Issue 40 item 14: the bucket is private. A file in it is no longer
    // served to anyone who has its address. Issue 47 item 1: nor to a signed
    // in teammate.
    const noKey = await fetch(`${API}/storage/v1/object/public/attachments/${fileName}`);
    const namedDoor = await fetch(`${API}/storage/v1/object/authenticated/attachments/${fileName}`, { headers: key });
    const signedIn = await fetch(`${API}/storage/v1/object/authenticated/attachments/${fileName}`, {
      headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${adminToken}` },
    });
    console.log(`a file in the attachments bucket, asked for by its address: with no key it answers ${noKey.status}, with the public key at the signed in door ${namedDoor.status}, signed in ${signedIn.status}`);
    expect(noKey.status).toBeGreaterThanOrEqual(400);
    expect(namedDoor.status).toBeGreaterThanOrEqual(400);
    // what a signed in teammate gets is asserted in last-gaps.e2e.ts, which is
    // not serial, so a failure there does not hide the cases below
    // an address nobody was given leads nowhere
    const guess = await fetch(`${API}/storage/v1/object/public/attachments/probe-${crypto.randomUUID()}.txt`);
    expect(guess.status).toBeGreaterThanOrEqual(400);
  });

  test("case 11: a teammate who is not an administrator cannot invite anyone", async ({ browser }) => {
    const { link, adminPage } = await inviteThroughTheScreens(browser);
    const password = newPassword();
    const page = await freshPage(browser);
    await setPasswordAt(page, link, password);
    await expectSignedIn(page);

    // the administrator is offered the screen (so "not offered" below means something)
    await adminPage.goto("/#/sales");
    await expect(adminPage.getByRole("link", { name: "New user" })).toBeVisible();

    await page.goto("/#/sales");
    await expectSignedIn(page);
    await expect(page.getByRole("link", { name: "New user" })).toHaveCount(0);
    await page.goto("/#/sales/create");
    await expectSignedIn(page);
    await expect(page.getByText("Create a new user")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);

    const token = await tokenOf(TEAMMATE, password);
    const invited = await usersFunction("POST", token, {
      email: STRANGER,
      first_name: "Sam",
      last_name: "Stranger",
      administrator: true,
      disabled: false,
    });
    expect(invited.status).toBe(401);
    // and cannot make themselves an administrator
    const row = teammate(TEAMMATE);
    await usersFunction("PATCH", token, {
      sales_id: row.id,
      email: TEAMMATE,
      first_name: "Tess",
      last_name: "Mate",
      administrator: true,
      disabled: false,
    });
    expect(teammate(TEAMMATE).administrator).toBe(false);
    // nor with no sign-in at all
    const nobody = await usersFunction("POST", PUBLIC_KEY, { email: STRANGER, first_name: "S", last_name: "S" });
    expect(nobody.status).toBe(401);
    expect(counts()).toEqual({ users: 2, sales: 2 });
    expect(await mailCount(STRANGER)).toBe(0);
  });
  // Issue 40 items 12 and 13: the invite path of the users function.
  test("item 12: a teammate invited with Disabled ticked cannot sign in", async () => {
    const adminPassword = newPassword();
    await createFirstUser(ADMIN, adminPassword);
    const adminToken = await tokenOf(ADMIN, adminPassword);
    const invited = await usersFunction("POST", adminToken, {
      email: TEAMMATE,
      first_name: "Tess",
      last_name: "Mate",
      administrator: false,
      disabled: true,
    });
    expect(invited.status, JSON.stringify(invited.json)).toBe(200);
    expect(teammate(TEAMMATE).disabled).toBe(true);
    // the teammate gets a password some other way (here the administrator API,
    // which leaves a ban as it is) and tries it
    const password = newPassword();
    const { error } = await admin.auth.admin.updateUserById(teammate(TEAMMATE).user_id, { password });
    expect(error).toBeNull();
    const refused = await passwordGrant(TEAMMATE, password);
    console.log(`sign-in of a teammate invited disabled answers ${refused.status}: ${JSON.stringify(refused.json?.error_code ?? refused.json?.msg ?? "a session")}`);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(sql(`select banned_until > now() from auth.users where lower(email) = ${quote(TEAMMATE)}`)).toBe("t");
  });

  test("item 13: the invite function refuses a password in its request, and makes nobody", async () => {
    const adminPassword = newPassword();
    await createFirstUser(ADMIN, adminPassword);
    const adminToken = await tokenOf(ADMIN, adminPassword);
    for (const password of [newPassword(), ""]) {
      const invited = await usersFunction("POST", adminToken, {
        email: TEAMMATE,
        password,
        first_name: "Tess",
        last_name: "Mate",
        administrator: false,
        disabled: false,
      });
      console.log(`an invitation carrying a password answers ${invited.status}: ${JSON.stringify(invited.json)}`);
      expect(invited.status).toBe(400);
    }
    expect(counts()).toEqual({ users: 1, sales: 1 });
    expect(await mailCount(TEAMMATE)).toBe(0);
  });
});

test.describe("the trigger alone, sign-ups left on", () => {
  test.skip(SIGNUPS !== "on", "needs a stack started with sign-ups on");

  test("case 12: with a first user present, a stranger's sign-up is still refused", async () => {
    expect((await settings()).disable_signup, "the stack says sign-ups are on").toBe(false);
    await createFirstUser(ADMIN, newPassword());
    expect(counts()).toEqual({ users: 1, sales: 1 });

    const raw = await auth("signup", { email: STRANGER, password: newPassword() });
    expect(raw.status, JSON.stringify(raw.json)).toBeGreaterThanOrEqual(400);
    expect(raw.json?.error_code).not.toBe("signup_disabled");
    console.log(`the trigger alone answers ${raw.status}: ${JSON.stringify(raw.json)}`);
    const { error } = await stranger().auth.signUp({ email: STRANGER, password: newPassword() });
    expect(error).not.toBeNull();
    expect(counts()).toEqual({ users: 1, sales: 1 });
    // the administrator API still makes an invited user, as the Users screen does
    const id = crypto.randomUUID();
    await admin.from("user_invitations").insert({ user_id: id });
    const { error: invitedError } = await admin.auth.admin.createUser({ id, email: "teammate@example-test.example.org" });
    expect(invitedError).toBeNull();
    expect(counts()).toEqual({ users: 2, sales: 2 });
  });

  // Issue 40 item 11: the sign-up list, with sign-ups switched on.
  test("item 11: a stranger signing up first on an empty database is refused, and no teammate is made", async () => {
    expect((await settings()).disable_signup, "the stack says sign-ups are on").toBe(false);
    expect(counts()).toEqual({ users: 0, sales: 0 });
    const raw = await auth("signup", { email: STRANGER, password: newPassword() });
    expect(raw.status, JSON.stringify(raw.json)).toBeGreaterThanOrEqual(400);
    expect(raw.json?.error_code).not.toBe("signup_disabled");
    console.log(`a stranger first on an empty database: ${raw.status} ${JSON.stringify(raw.json)}`);
    const { error } = await stranger().auth.signUp({ email: STRANGER, password: newPassword() });
    expect(error).not.toBeNull();
    // nor through the administrator API, the way the dashboard makes a first user
    const { error: viaAdmin } = await admin.auth.admin.createUser({ email: STRANGER, password: newPassword(), email_confirm: true });
    expect(viaAdmin).not.toBeNull();
    expect(counts()).toEqual({ users: 0, sales: 0 });
  });

  test("item 11: an allowed email signs up first and is the administrator; a stranger after it is refused", async () => {
    const signup = await auth("signup", { email: "Admin@Example-test.example.org", password: newPassword() });
    expect(signup.status, JSON.stringify(signup.json)).toBe(200);
    expect(counts()).toEqual({ users: 1, sales: 1 });
    expect(teammate(ADMIN)?.administrator).toBe(true);

    const raw = await auth("signup", { email: STRANGER, password: newPassword() });
    expect(raw.status, JSON.stringify(raw.json)).toBeGreaterThanOrEqual(400);
    const { error } = await admin.auth.admin.createUser({ email: STRANGER, password: newPassword(), email_confirm: true });
    expect(error).not.toBeNull();
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("item 11: a user flagged as SSO gets no way round the list, first or later", async () => {
    const ssoInsert = (id: string, email: string) =>
      `insert into auth.users (id, email, is_sso_user, aud, role) values ('${id}', ${quote(email)}, true, 'authenticated', 'authenticated')`;
    expect(() => sql(ssoInsert(crypto.randomUUID(), STRANGER))).toThrow(/not on the hub's list/);
    expect(counts()).toEqual({ users: 0, sales: 0 });
    await createFirstUser(ADMIN, newPassword());
    expect(() => sql(ssoInsert(crypto.randomUUID(), STRANGER))).toThrow(/not on the hub's list/);
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  test("item 11: an email taken off the list cannot sign up, even with an invitation row", async () => {
    await createFirstUser(ADMIN, newPassword());
    setAllowList([ADMIN]);
    const id = crypto.randomUUID();
    await admin.from("user_invitations").insert({ user_id: id });
    const { error } = await admin.auth.admin.createUser({ id, email: TEAMMATE });
    expect(error).not.toBeNull();
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });

  // Here, not above: this stack keeps Supabase's own limits (the other has them
  // raised so its many sign-ins do not trip them). Last on purpose: it may
  // leave this machine's address rate limited.
  test("many wrong passwords in a row: Supabase's own limit answers", async () => {
    const password = newPassword();
    await createFirstUser(ADMIN, password);
    const seen: Record<string, number> = {};
    let firstLimited = 0;
    for (let i = 1; i <= 60; i++) {
      const { status } = await passwordGrant(ADMIN, newPassword());
      expect([400, 429]).toContain(status);
      seen[status] = (seen[status] ?? 0) + 1;
      if (status === 429 && !firstLimited) firstLimited = i;
    }
    console.log(`60 wrong passwords in a row: ${JSON.stringify(seen)}; the first refusal by the limit was attempt ${firstLimited || "none"}`);
    expect(counts()).toEqual({ users: 1, sales: 1 });
  });
});
