// team hub, issue 58: a whole sign-in through an OAuth provider, on the
// stack with sign-ups switched off, as far as it can be proven without a real
// Google account.
//
// Supabase's auth service only lets its Google provider talk to Google. So
// these tests sign in through its "keycloak" provider, pointed at a stand-in
// on the runner (fake_idp.mjs). Once a provider has answered with an email,
// what the auth service does next is the same for every OAuth provider:
// find an account with that verified email and link the new identity to it,
// or refuse a new account because sign-ups are off. That is what is tested.
// What only a real Google sign-in proves is listed in docs/DEPLOY.md.
//
// Runs only where the workflow started the stand-in (HUB_FAKE_IDP).
import { test, expect, type Page } from "@playwright/test";
import {
  API,
  PUBLIC_KEY,
  SIGNUPS,
  admin,
  counts,
  createFirstUser,
  expectSignedIn,
  freshPage,
  newPassword,
  quote,
  resetAll,
  setAllowList,
  sql,
  teammate,
} from "./helpers";
import { GOOGLE_CANCELLED } from "../src/components/kit/googleSignIn";

const APP = "http://localhost:5175";
const FAKE_IDP = process.env.HUB_FAKE_IDP ?? "";
const NOT_ON_LIST =
  "This Google account is not on the team hub's list. Ask your hub administrator to add you.";

const ADMIN = "admin@example-test.example.org";
const TEAMMATE = "teammate@example-test.example.org";
const LISTED = "listed@example-test.example.org";

// The stand-in runs on this runner: its address is this machine or Docker's
// own bridge, never anything else.
if (FAKE_IDP) {
  const host = new URL(FAKE_IDP).hostname;
  if (!/^(127\.0\.0\.1|localhost|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host)) {
    throw new Error(`the stand-in provider must be on this runner, not ${host}`);
  }
}

type Who = { email: string; email_verified: boolean; sub: string; name: string } | { cancel: true };

// Sets who the stand-in answers for, then starts the sign-in the way the
// hub's button does, with the stand-in's provider name in place of google.
async function signInThroughStandIn(page: Page, who: Who) {
  const set = await fetch(`${FAKE_IDP}/next`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(who),
  });
  expect(set.status).toBe(200);
  const start = new URL(`${API}/auth/v1/authorize`);
  start.searchParams.set("provider", "keycloak");
  start.searchParams.set("redirect_to", `${APP}/`);
  await page.goto(start.toString());
}

const identitiesOf = (userId: string) =>
  sql(
    `select coalesce(string_agg(provider, ',' order by provider), '') from auth.identities where user_id = ${quote(userId)}`,
  );

const standInIdentities = () =>
  Number(sql("select count(*) from auth.identities where provider = 'keycloak'"));

// The administrator, then a teammate made the way docs/INVITE.md says:
// the invite line in the SQL editor, "Create new user" in the dashboard with
// a password nobody keeps, then the handle.
async function teamWithInvitedTeammate() {
  await createFirstUser(ADMIN, newPassword());
  sql(`select public.allow_signup_email(${quote(TEAMMATE)}), public.invite_teammate_email(${quote(TEAMMATE)})`);
  const { data, error } = await admin.auth.admin.createUser({
    email: TEAMMATE,
    password: newPassword(),
    email_confirm: true,
    // a name, as the Users screen keeps it: a sign-in must not lose it
    user_metadata: { first_name: "Jay", last_name: "Tee" },
  });
  if (error) throw new Error(`could not make the teammate: ${error.message}`);
  expect(teammate(TEAMMATE)?.first_name).toBe("Jay");
  sql(`select public.set_teammate_handle(${quote(TEAMMATE)}, 'bravo')`);
  const row = teammate(TEAMMATE);
  expect(row?.handle).toBe("bravo");
  return { user: data.user!, row };
}

async function expectRefused(page: Page, sentence = NOT_ON_LIST) {
  await expect(page.getByText(sentence)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(page.url().startsWith(APP)).toBe(true);
}

test.describe("issue 58, a sign-in through an OAuth provider with sign-ups off", () => {
  test.skip(!FAKE_IDP || SIGNUPS !== "off", "needs the stand-in provider and a stack with sign-ups off");

  test.beforeEach(async () => {
    await resetAll();
  });

  test("an invited teammate's identity links to their account: same row, same handle, signed in", async ({ browser }) => {
    const { user, row } = await teamWithInvitedTeammate();
    const before = counts();
    expect(identitiesOf(user.id)).toBe("email");

    const page = await freshPage(browser);
    // Capitals and the provider's own spelling make no difference.
    await signInThroughStandIn(page, {
      email: "Teammate@Example-Test.example.org",
      email_verified: true,
      sub: "stand-in-teammate",
      name: "Someone Else Entirely",
    });
    await expectSignedIn(page);
    // The tokens are taken off the address once read.
    await expect.poll(() => page.url()).not.toContain("access_token");

    expect(counts()).toEqual(before);
    expect(teammate(TEAMMATE)).toEqual(row);
    expect(identitiesOf(user.id)).toBe("email,keycloak");
    // The router's note: an OAuth sign-in is not single sign-on, so the
    // allow list's trigger path is the one upstream's SSO flag never skips.
    expect(sql(`select is_sso_user from auth.users where id = ${quote(user.id)}`)).toBe("f");

    // The second time, the same identity, the same account.
    const again = await freshPage(browser);
    await signInThroughStandIn(again, {
      email: TEAMMATE,
      email_verified: true,
      sub: "stand-in-teammate",
      name: "Someone Else Entirely",
    });
    await expectSignedIn(again);
    expect(counts()).toEqual(before);
    expect(teammate(TEAMMATE)).toEqual(row);
    expect(identitiesOf(user.id)).toBe("email,keycloak");
  });

  test("an address not on the list is refused, and nothing is made", async ({ browser }) => {
    await teamWithInvitedTeammate();
    const before = counts();
    const page = await freshPage(browser);
    await signInThroughStandIn(page, {
      email: "stranger@example-test.example.org",
      email_verified: true,
      sub: "stand-in-stranger",
      name: "Stranger",
    });
    await expectRefused(page);
    expect(counts()).toEqual(before);
    expect(standInIdentities()).toBe(0);
  });

  test("an address on the list but not invited, with no account, is refused, and nothing is made", async ({ browser }) => {
    await teamWithInvitedTeammate();
    setAllowList([ADMIN, TEAMMATE, LISTED]);
    const before = counts();
    const page = await freshPage(browser);
    await signInThroughStandIn(page, {
      email: LISTED,
      email_verified: true,
      sub: "stand-in-listed",
      name: "Listed",
    });
    await expectRefused(page);
    expect(counts()).toEqual(before);
    expect(standInIdentities()).toBe(0);
  });

  test("an address on the list and invited, but with no account yet, is refused: the account comes first", async ({ browser }) => {
    await teamWithInvitedTeammate();
    setAllowList([ADMIN, TEAMMATE, LISTED]);
    sql(`select public.invite_teammate_email(${quote(LISTED)})`);
    const before = counts();
    const page = await freshPage(browser);
    await signInThroughStandIn(page, {
      email: LISTED,
      email_verified: true,
      sub: "stand-in-listed",
      name: "Listed",
    });
    await expectRefused(page);
    expect(counts()).toEqual(before);
    expect(standInIdentities()).toBe(0);
  });

  test("a personal address under a teammate's name is refused, and the teammate is untouched", async ({ browser }) => {
    const { user, row } = await teamWithInvitedTeammate();
    const before = counts();
    const page = await freshPage(browser);
    await signInThroughStandIn(page, {
      email: "teammate.personal@example-test.example.org",
      email_verified: true,
      sub: "stand-in-personal",
      name: row.first_name,
    });
    await expectRefused(page);
    expect(counts()).toEqual(before);
    expect(teammate(TEAMMATE)).toEqual(row);
    expect(identitiesOf(user.id)).toBe("email");
  });

  // Supabase's auth service counts a provider's email as verified when the
  // provider says so, or when email confirmations are off for the project.
  // stack_config.py switches them on for this stack, as the cloud project has
  // them ("Confirm email", docs/DEPLOY.md, Sign in with Google, step 5), so
  // here the refusal runs. The first run of this pull request, on a stack with
  // them off, saw the other branch: the address was joined.
  test("an unverified email matching a teammate is joined only when email confirmations are off", async ({ browser }) => {
    const { user, row } = await teamWithInvitedTeammate();
    const settings: any = await (
      await fetch(`${API}/auth/v1/settings`, { headers: { apikey: PUBLIC_KEY } })
    ).json();
    const autoconfirm = settings.mailer_autoconfirm === true;
    console.log(`this stack's mailer_autoconfirm: ${settings.mailer_autoconfirm}`);
    const before = counts();
    const page = await freshPage(browser);
    await signInThroughStandIn(page, {
      email: TEAMMATE,
      email_verified: false,
      sub: "stand-in-unverified",
      name: "Unverified",
    });
    if (autoconfirm) {
      await expectSignedIn(page);
      expect(identitiesOf(user.id)).toBe("email,keycloak");
    } else {
      await expectRefused(page);
      expect(identitiesOf(user.id)).toBe("email");
    }
    expect(counts()).toEqual(before);
    expect(teammate(TEAMMATE)).toEqual(row);
  });

  test("a teammate who is switched off is refused, and no identity is added", async ({ browser }) => {
    const { user } = await teamWithInvitedTeammate();
    const { error } = await admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    if (error) throw new Error(error.message);
    const before = counts();
    const page = await freshPage(browser);
    await signInThroughStandIn(page, {
      email: TEAMMATE,
      email_verified: true,
      sub: "stand-in-teammate",
      name: "Teammate",
    });
    await expectRefused(page);
    expect(counts()).toEqual(before);
    expect(identitiesOf(user.id)).toBe("email");
  });

  test("Cancel on the provider's screen lands back on the sign-in page, not an error page", async ({ browser }) => {
    await teamWithInvitedTeammate();
    const before = counts();
    const page = await freshPage(browser);
    await signInThroughStandIn(page, { cancel: true });
    await expectRefused(page, GOOGLE_CANCELLED);
    expect(counts()).toEqual(before);
  });
});
