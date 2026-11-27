// team hub, issue 25 (B6): helpers of the sign-in tests. Everything here
// speaks to a throwaway Supabase stack on this machine and refuses any other
// address. No password is written in this folder: each test makes its own.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const API = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341";
export const PUBLIC_KEY = process.env.VITE_SB_PUBLISHABLE_KEY!;
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY!;
export const MAIL = process.env.HUB_SIGNIN_MAIL_URL ?? "http://127.0.0.1:54344";
// off: the stack was started with sign-ups switched off. on: as upstream has it.
export const SIGNUPS = process.env.HUB_SIGNUPS ?? "off";

const local = (url: string) => {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`The sign-in tests only run against this machine, not ${host}`);
  }
  return url;
};
local(API);
local(MAIL);

export const admin = createClient(API, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A client that holds the public key only: what a stranger has.
export const stranger = () =>
  createClient(API, PUBLIC_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

export const newPassword = () => `pw-${randomUUID()}`;

const dbUrls = () =>
  (process.env.HUB_E2E_DB_URL
    ? [process.env.HUB_E2E_DB_URL]
    : [
        "postgresql://supabase_admin:postgres@127.0.0.1:54342/postgres",
        "postgresql://postgres:postgres@127.0.0.1:54342/postgres",
      ]
  ).map(local);

export function sql(statement: string): string {
  let lastError: unknown;
  for (const url of dbUrls()) {
    try {
      return execFileSync(
        "psql",
        [url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

// How many users and how many teammates the database holds.
export function counts() {
  const [users, sales] = sql(
    "select (select count(*) from auth.users), (select count(*) from public.sales)",
  ).split("|");
  return { users: Number(users), sales: Number(sales) };
}

export function teammate(email: string) {
  const row = sql(
    `select coalesce(row_to_json(s)::text, '') from (
       select id, user_id, email, handle, id_prefix, administrator, disabled, first_name
       from public.sales where lower(email) = lower(${quote(email)})) s`,
  );
  return row ? JSON.parse(row) : null;
}

const TABLES = [
  "interview_hypotheses",
  "interview_transcripts",
  "call_inbox",
  "interviews",
  "tasks",
  "contact_notes",
  "deal_notes",
  "deals",
  "contacts",
  "companies",
  "tags",
  "configuration",
  "user_invitations",
  "sales",
];

// Empties the throwaway database: every row, every user, every mail.
export async function resetAll() {
  sql(
    [
      "set session_replication_role = replica",
      ...TABLES.map((table) => `delete from public.${table}`),
    ].join("; "),
  );
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  for (const user of data.users) {
    await admin.auth.admin.deleteUser(user.id);
  }
  // The sign-up list (issue 40 item 11) holds the two addresses these tests
  // let in, and nothing else: the stranger is never on it.
  setAllowList(ALLOWED);
  // No invitation by address is left from an earlier test (issue 47).
  sql(
    "do $$ begin if to_regclass('hub_private.invited_emails') is not null then delete from hub_private.invited_emails; end if; end $$",
  );
  await clearMail();
}

export const ALLOWED = ["admin@example-test.example.org", "teammate@example-test.example.org"];

// Replaces the sign-up list with exactly these addresses.
export function setAllowList(emails: string[]) {
  sql(
    [
      "delete from hub_private.signup_allow_list",
      ...emails.map((email) => `select public.allow_signup_email(${quote(email)})`),
    ].join("; "),
  );
}

// The first user, made the way the Supabase dashboard makes one: by the
// administrator API, with the address already confirmed. No invitation row.
export async function createFirstUser(email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create the first user: ${error.message}`);
  return data.user!;
}

// One request to the auth API with the public key, as a stranger would send it.
export async function auth(path: string, body: unknown, token?: string, method = "POST") {
  const response = await fetch(`${API}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: PUBLIC_KEY,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

export const passwordGrant = (email: string, password: string) =>
  auth("token?grant_type=password", { email, password });

// The edge function behind the Users screen, called directly.
export async function usersFunction(method: "POST" | "PATCH", token: string, body: unknown) {
  const response = await fetch(`${API}/functions/v1/users`, {
    method,
    headers: {
      apikey: PUBLIC_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

// ------------------------------------------------------------------ mail
// The local stack catches every mail it sends. Newer versions of the
// Supabase CLI run Mailpit, older ones Inbucket; both are asked.
export async function clearMail() {
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" }).catch(() => undefined);
}

async function mailHtmlFor(address: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const list = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    if (list.ok) {
      const json: any = await list.json();
      for (const message of json.messages ?? []) {
        const one = await fetch(`${MAIL}/api/v1/message/${message.ID}`);
        if (one.ok) {
          const body: any = await one.json();
          out.push(String(body.HTML || body.Text || ""));
        }
      }
      return out;
    }
  } catch {
    // not Mailpit: try Inbucket below
  }
  const box = address.split("@")[0];
  const list = await fetch(`${MAIL}/api/v1/mailbox/${box}`);
  if (!list.ok) return out;
  const messages: any[] = await list.json();
  for (const message of messages.reverse()) {
    const one = await fetch(`${MAIL}/api/v1/mailbox/${box}/${message.id}`);
    if (one.ok) {
      const body: any = await one.json();
      out.push(String(body.body?.html || body.body?.text || ""));
    }
  }
  return out;
}

export async function mailCount(address: string) {
  return (await mailHtmlFor(address)).length;
}

// Waits for a mail to the address and gives back the link in it that goes
// to the auth API. Newest mail first.
export async function linkFromMail(address: string, atLeast = 1): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const mails = await mailHtmlFor(address);
    if (mails.length >= atLeast) {
      const match = mails[0].match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/);
      if (match) {
        return match[1].replace(/&amp;/g, "&");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no mail with a link arrived for ${address}`);
}

// ---------------------------------------------------------------- screens
export async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

export async function fillLogin(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export const signedIn = (page: Page) => page.getByRole("link", { name: "People" });

export async function expectSignedIn(page: Page) {
  await expect(signedIn(page)).toBeVisible({ timeout: 20_000 });
}

// Still on the login form, and not in the app.
export async function expectNotSignedIn(page: Page) {
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(signedIn(page)).toHaveCount(0);
}
