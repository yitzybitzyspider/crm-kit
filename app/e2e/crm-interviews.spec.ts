// team hub (issue 24): interviews and the recordings inbox, end to end,
// against the throwaway stack of the app workflow. Not upstream's file.
// Recordings are put into the inbox the way /crm-sync will: by calling
// submit_recording as the signed in test teammate.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { expect, test } from "./fixtures";

const SHOTS = path.join("test-results", "kit");
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341";
// The first teammate the fixture makes gets the handle alpha, prefix SK.
const PREFIX = "AA";
const EMAIL = "john@doe-com.example.org";
const PASSWORD = "password";
const MARKER = "TRANSCRIPT-MARKER-7f3a91";

if (new URL(SUPABASE_URL).hostname !== "127.0.0.1") {
  throw new Error("The e2e stack must be on this machine");
}

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };

// Reads with the service key, which holds select only on the hub's tables.
const admin = createClient(
  SUPABASE_URL,
  process.env.SERVICE_ROLE_KEY!,
  noSession,
);

// A made up transcript of more than 1000 characters with the things a
// transcript must keep: leading spaces, blank lines, a line that looks like
// HTML and one that looks like a heading.
const transcriptOf = (who: string) =>
  [
    `  Speaker A: thank you for making the time, ${who}.`,
    "",
    "",
    "<b>x</b>",
    "# not a heading",
    `Speaker B: ${MARKER} we wait at the desk most mornings.`,
    ...Array.from(
      { length: 30 },
      (_, line) =>
        `Speaker A: line ${line + 1} of the made up call, with a trailing space `,
    ),
    "Speaker B: that is all I have.   ",
  ].join("\n");

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const signInApi = async () => {
  const api = createClient(
    SUPABASE_URL,
    process.env.VITE_SB_PUBLISHABLE_KEY!,
    noSession,
  );
  const { error } = await api.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error)
    throw new Error(`The test teammate could not sign in: ${error.message}`);
  return api;
};

const act = async (api: SupabaseClient, name: string, args: object) => {
  const { data, error } = await api.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
};

const refusalOf = async (api: SupabaseClient, name: string, args: object) => {
  const { error } = await api.rpc(name, args);
  return error?.message ?? "";
};

const submit = async (
  api: SupabaseClient,
  recording: {
    granola_id: string;
    title: string;
    attendee_emails: string[];
    transcript: string;
    consent_to_record?: boolean | null;
  },
) => {
  const result = await act(api, "submit_recording", {
    source: "granola",
    recorded_on: "2026-11-20",
    overview:
      "A made up call about the **intake desk**.\n\n- They wait most mornings",
    hypotheses: [{ hypothesis: "H2", stance: "supports", why: "They wait" }],
    reported_chars: recording.transcript.length,
    via: "claude",
    ...recording,
  });
  expect(result.result).toBe("inbox");
  return result as { inbox_id: number; reason: string };
};

const countOf = async (table: string) => {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`count of ${table}: ${error.message}`);
  return count ?? 0;
};

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("people-board")).toBeVisible();
};

// Shots are taken as the window shows it, in a tall window, never with
// fullPage: a full page capture made the app draw itself anew, which emptied
// the interview page in the picture and cleared the consent tick (issue 24).
const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
  expect(fs.statSync(file).size).toBeGreaterThan(5000);
  // a mostly white picture is a blank page
  const shot = fs.readFileSync(file);
  expect(shot.length).toBeGreaterThan(20000);
};

const item = (page: Page, inboxId: number) =>
  page.locator(`[data-testid="inbox-item"][data-inbox-id="${inboxId}"]`);

const openInbox = async (page: Page) => {
  await page.getByRole("link", { name: /^Inbox/ }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
};

// Every answer of the database's API while the page is used, so a test can
// say whether any of them carried a transcript.
const watchAnswers = (page: Page) => {
  const answers: { url: string; text: string }[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (response) => {
    if (!response.url().startsWith(SUPABASE_URL)) return;
    pending.push(
      response
        .text()
        .then((text) => {
          answers.push({ url: response.url(), text });
        })
        .catch(() => {
          /* a redirect or an aborted request has no body */
        }),
    );
  });
  return {
    withTranscript: async () => {
      await page.waitForLoadState("networkidle");
      await Promise.all(pending);
      return answers
        .filter((answer) => answer.text.includes(MARKER))
        .map((answer) => answer.url);
    },
    count: () => answers.length,
  };
};

test.describe("interviews and the recordings inbox", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "The inbox is a desktop screen for now: the phone's bar has no entry for it",
  );

  test.beforeEach(async ({ createSales }) => {
    await createSales({
      first_name: "John",
      last_name: "Doe",
      email: EMAIL,
      password: PASSWORD,
    });
  });

  test("confirm: a waiting recording becomes the person's interview, word for word", async ({
    page,
  }, testInfo) => {
    const api = await signInApi();
    const maria = await act(api, "add_person", {
      name: "Maria Okafor",
      role: "Charge nurse",
      organization: "Riverbend Clinic",
      contact: "maria.okafor@example-test.example.org",
    });
    expect(maria.person_code).toBe(`${PREFIX}-01`);
    const transcript = transcriptOf("Maria");
    expect(transcript.length).toBeGreaterThan(1000);
    // an attendee nobody matches, and consent not asked yet
    const waiting = await submit(api, {
      granola_id: "e2e-confirm",
      title: "Call with Maria Okafor about the intake desk",
      attendee_emails: [EMAIL, "someone.else@nowhere-test.example.org"],
      transcript,
      consent_to_record: null,
    });
    expect(waiting.reason).toBe("no person matches an attendee");
    // a second one, so the list has an order to keep
    const second = await submit(api, {
      granola_id: "e2e-confirm-2",
      title: "A later call",
      attendee_emails: [EMAIL],
      transcript: transcriptOf("nobody"),
      consent_to_record: true,
    });

    await page.setViewportSize({ width: 1280, height: 1400 });
    const answers = watchAnswers(page);
    await signIn(page);

    // case 13 of the browser tests, against the database: the count
    await expect(page.getByTestId("inbox-count")).toHaveText("2");
    await openInbox(page);
    await expect(page.getByTestId("inbox-item")).toHaveCount(2);
    await expect(page.getByTestId("inbox-item").first()).toHaveAttribute(
      "data-inbox-id",
      String(waiting.inbox_id),
    );
    const first = item(page, waiting.inbox_id);
    await expect(first).toContainText(
      "Call with Maria Okafor about the intake desk",
    );
    await expect(first).toContainText("2026-11-20");
    await expect(first).toContainText("someone.else@nowhere-test.example.org");
    await expect(first).toContainText("Submitted by alpha");
    await expect(first).toContainText(
      `${transcript.length.toLocaleString("en-US")} characters`,
    );
    await expect(first).toContainText("no person matches an attendee");
    await expect(item(page, second.inbox_id)).toContainText(
      "no attendee outside the team",
    );

    // case 17: consent unknown, so nothing is an interview yet and Confirm
    // cannot be pressed with a person alone
    const confirm = first.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeDisabled();
    await first
      .getByTestId("suggestion")
      .getByRole("button", { name: new RegExp(`${PREFIX}-01 Maria Okafor`) })
      .click();
    await expect(first.getByTestId("suggestion")).toContainText(
      "name in the title",
    );
    await expect(first.getByTestId("chosen-person")).toContainText(
      `${PREFIX}-01`,
    );
    await expect(confirm).toBeDisabled();
    expect(await countOf("interviews")).toBe(0);
    // and the action itself refuses without consent, called directly
    for (const consent of [false, null]) {
      expect(
        await refusalOf(api, "confirm_recording", {
          inbox_id: waiting.inbox_id,
          person_code: maria.person_code,
          consent_to_record: consent,
        }),
      ).toContain("consent to record is not confirmed");
    }
    expect(
      await refusalOf(api, "confirm_recording", {
        inbox_id: waiting.inbox_id,
        person_code: maria.person_code,
      }),
    ).toContain("consent to record is not confirmed");
    expect(await countOf("interviews")).toBe(0);

    await first.getByLabel("They agreed to be recorded").check();
    await expect(confirm).toBeEnabled();
    // case 19: the inbox, with a person chosen and the tick on
    await shoot(page, testInfo, "inbox");
    await expect(first.getByLabel("They agreed to be recorded")).toBeChecked();

    // case 18: the board, the inbox and its suggestions carried no transcript
    expect(await answers.withTranscript()).toEqual([]);
    expect(answers.count()).toBeGreaterThan(5);

    await confirm.click();
    await expect(item(page, waiting.inbox_id)).toHaveCount(0);
    await expect(page.getByTestId("inbox-item")).toHaveCount(1);
    await expect(page.getByTestId("inbox-count")).toHaveText("1");
    expect(await countOf("interviews")).toBe(1);

    // a second confirm of the same item is refused by name
    expect(
      await refusalOf(api, "confirm_recording", {
        inbox_id: waiting.inbox_id,
        person_code: maria.person_code,
        consent_to_record: true,
      }),
    ).toMatch(/^already confirmed by alpha as interview \d+$/);

    // the interview page: the overview first, the transcript on request
    await page.getByRole("link", { name: "Open the interview" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Call with Maria Okafor about the intake desk",
      }),
    ).toBeVisible();
    const facts = page.getByTestId("interview-facts");
    await expect(facts).toContainText("Maria Okafor");
    await expect(facts).toContainText(`${PREFIX}-01`);
    await expect(facts).toContainText("2026-11-20");
    await expect(facts).toContainText("alpha");
    await expect(facts).toContainText("granola");
    // the overview is plain text as written: the markdown marks stay
    await expect(page.getByTestId("interview-overview")).toHaveText(
      "A made up call about the **intake desk**.\n\n- They wait most mornings",
    );
    await expect(page.getByTestId("interview-hypothesis")).toContainText("H2");
    await expect(page.getByTestId("transcript-size")).toContainText(
      `${transcript.length.toLocaleString("en-US")} characters`,
    );
    await expect(page.getByTestId("transcript")).toHaveCount(0);
    expect(await answers.withTranscript()).toEqual([]);

    // the person page lists the interview and still carries no transcript
    await facts.getByRole("link", { name: "Maria Okafor" }).click();
    await expect(page.locator("h5")).toContainText("Maria Okafor");
    const line = page.getByTestId("interview-line");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("2026-11-20");
    await expect(line).toContainText("alpha");
    await expect(line).toContainText(
      "Call with Maria Okafor about the intake desk",
    );
    await expect(page.getByPlaceholder("Add a note")).toBeVisible();
    await shoot(page, testInfo, "person-page-with-interview");
    expect(await answers.withTranscript()).toEqual([]);

    // the interviews list, and the board: she is in interviewed
    await page.getByRole("link", { name: "Interviews" }).click();
    await expect(page.getByTestId("interview-row")).toHaveCount(1);
    await expect(page.getByTestId("interview-row")).toContainText("Maria Okafor");
    await page.getByRole("link", { name: "People" }).click();
    await expect(
      page
        .getByTestId("people-column-interviewed")
        .locator(`[data-person-code="${PREFIX}-01"]`),
    ).toBeVisible();
    await expect(
      page.getByTestId("people-column-interviewed").getByText("Maria Okafor"),
    ).toBeVisible();
    await shoot(page, testInfo, "board-interviewed");
    expect(await answers.withTranscript()).toEqual([]);

    // Show transcript: now, and only now, an answer carries it
    await page.getByRole("link", { name: "Interviews" }).click();
    await page
      .getByRole("link", { name: "Call with Maria Okafor about the intake desk" })
      .click();
    await page.getByRole("button", { name: "Show transcript" }).click();
    await expect(page.getByTestId("transcript")).toBeVisible();
    const shown = await page
      .getByTestId("transcript")
      .evaluate((block) => block.textContent ?? "");
    // case 14: byte for byte what was submitted
    expect(shown.length).toBe(transcript.length);
    expect(sha256(shown)).toBe(sha256(transcript));
    expect(
      await page.getByTestId("transcript").evaluate((b) => b.children.length),
    ).toBe(0);
    const carried = await answers.withTranscript();
    expect(carried).toHaveLength(1);
    expect(carried[0]).toContain("/rest/v1/interview_transcripts");
    // case 19: the interview page with its transcript open. What a reader
    // sees is checked first, so a blank page fails here, not in a picture.
    await expect(
      page.getByRole("heading", {
        name: "Call with Maria Okafor about the intake desk",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("interview-overview")).toContainText(
      "intake desk",
    );
    await expect(
      page.getByRole("button", { name: "Hide transcript" }),
    ).toBeVisible();
    await expect(page.getByTestId("transcript")).toContainText(MARKER);
    await shoot(page, testInfo, "interview-page");
    // and still there after the shot
    await expect(page.getByTestId("transcript")).toContainText(MARKER);

    // The question of issue 24 reopened, asked of the browser: does a full
    // page capture make the app draw itself anew? The answer is printed in
    // the job log; it decides nothing here.
    await page.evaluate(() => {
      (window as any).__hubProbe = document.querySelector(
        '[data-testid="transcript"]',
      );
    });
    await page.screenshot({ fullPage: true });
    const kept = await page.evaluate(
      () =>
        (window as any).__hubProbe ===
          document.querySelector('[data-testid="transcript"]') &&
        (window as any).__hubProbe !== null,
    );
    console.log(
      `HUBPROBE a full page capture kept the transcript block: ${kept}`,
    );
  });

  test("create: a new person is typed in from the inbox, then confirmed", async ({
    page,
  }) => {
    const api = await signInApi();
    const transcript = transcriptOf("Nia");
    const waiting = await submit(api, {
      granola_id: "e2e-create",
      title: "Intake desk call",
      attendee_emails: [EMAIL, "nia.nurse@riverbend-test.example.org"],
      transcript,
      consent_to_record: true,
    });
    expect(await countOf("contacts")).toBe(0);

    await signIn(page);
    await openInbox(page);
    const row = item(page, waiting.inbox_id);
    await expect(
      row.getByText("Nobody on file matches this recording."),
    ).toBeVisible();
    // the recording said consent was given: the tick is still off
    await expect(
      row.getByLabel("They agreed to be recorded"),
    ).not.toBeChecked();

    await row.getByRole("button", { name: "Create new person" }).click();
    await expect(row.getByLabel("Contact")).toHaveValue(
      "nia.nurse@riverbend-test.example.org",
    );
    await expect(row.getByLabel("Name")).toHaveValue("");
    await expect(
      row.getByRole("button", { name: "Save person" }),
    ).toBeDisabled();
    await row.getByLabel("Name").fill("Nia Nurse");
    await row.getByLabel("Role").fill("Charge nurse");
    await row.getByLabel("Organization").fill("Riverbend Clinic");
    await row.getByRole("button", { name: "Save person" }).click();
    await expect(row.getByTestId("chosen-person")).toContainText(
      `${PREFIX}-01 Nia Nurse`,
    );
    // the person exists, the recording is not confirmed by that
    expect(await countOf("contacts")).toBe(1);
    expect(await countOf("interviews")).toBe(0);
    await expect(row.getByRole("button", { name: "Confirm" })).toBeDisabled();

    // typing the same person again is refused by name and offered instead
    await row.getByRole("button", { name: "Create new person" }).click();
    await row.getByLabel("Name").fill("Dr. Nia Nurse");
    await row.getByLabel("Contact").fill("");
    await row.getByRole("button", { name: "Save person" }).click();
    await expect(row.getByRole("alert")).toContainText(
      `already on file (same name): ${PREFIX}-01`,
    );
    await row.getByRole("button", { name: `Choose ${PREFIX}-01` }).click();
    expect(await countOf("contacts")).toBe(1);

    await row.getByLabel("They agreed to be recorded").check();
    await row.getByRole("button", { name: "Confirm" }).click();
    await expect(item(page, waiting.inbox_id)).toHaveCount(0);
    await expect(page.getByText("Nothing is waiting")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open the interview" }),
    ).toBeVisible();

    // case 15: one person, with the attendee's address, holding the interview
    expect(await countOf("contacts")).toBe(1);
    const byAddress = await act(api, "find_person", {
      query: "nia.nurse@riverbend-test.example.org",
    });
    expect(byAddress).toHaveLength(1);
    expect(byAddress[0]).toMatchObject({
      person_code: `${PREFIX}-01`,
      name: "Nia Nurse",
      role: "Charge nurse",
      organization: "Riverbend Clinic",
      status: "interviewed",
    });
    const { data: interviews } = await admin
      .from("interviews")
      .select("id, contact_id, title, contacts(person_code)");
    expect(interviews).toHaveLength(1);
    expect(interviews![0]).toMatchObject({
      title: "Intake desk call",
      contacts: { person_code: `${PREFIX}-01` },
    });
  });

  test("skip: a recording is skipped with a reason, nothing is made, and it can still be confirmed", async ({
    page,
  }) => {
    const api = await signInApi();
    const waiting = await submit(api, {
      granola_id: "e2e-skip",
      title: "Team standup",
      attendee_emails: [EMAIL],
      transcript: transcriptOf("the team"),
      consent_to_record: null,
    });
    const before = {
      interviews: await countOf("interviews"),
      contacts: await countOf("contacts"),
      inbox: await countOf("call_inbox"),
    };

    await signIn(page);
    await openInbox(page);
    const row = item(page, waiting.inbox_id);
    await row.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Skip this recording" }),
    ).toBeDisabled();
    await row.getByRole("button", { name: "not an interview" }).click();
    await row.getByRole("button", { name: "Skip this recording" }).click();

    await expect(page.getByText("Nothing is waiting")).toBeVisible();
    await expect(page.getByTestId("inbox-count")).toHaveCount(0);
    await page.getByRole("button", { name: "Skipped" }).click();
    const skipped = item(page, waiting.inbox_id);
    await expect(skipped).toContainText("Team standup");
    await expect(skipped).toContainText("Skipped by alpha: not an interview");
    await expect(
      skipped.getByRole("button", { name: "Confirm" }),
    ).toBeDisabled();
    await expect(
      skipped.getByRole("button", { name: "Skip", exact: true }),
    ).toHaveCount(0);

    // case 16: nothing was made and nothing was deleted
    expect({
      interviews: await countOf("interviews"),
      contacts: await countOf("contacts"),
      inbox: await countOf("call_inbox"),
    }).toEqual(before);
    const { data: rows } = await admin
      .from("call_inbox")
      .select("state, reason")
      .eq("id", waiting.inbox_id);
    expect(rows).toEqual([{ state: "dismissed", reason: "not an interview" }]);
    // skipping it again is refused in the database's words
    expect(
      await refusalOf(api, "dismiss_recording", {
        inbox_id: waiting.inbox_id,
        reason: "again",
      }),
    ).toContain("only a waiting recording can be dismissed");
  });
});
