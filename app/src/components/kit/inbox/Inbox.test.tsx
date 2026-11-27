import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import Header from "@/components/atomic-crm/layout/Header";
import { StoryWrapper } from "@/test/StoryWrapper";

import {
  buildMatch,
  buildRecording,
  readColumn,
  watchedProvider,
} from "../interviews/testData";
import { buildPerson, hubData, type HubData } from "../people/testData";
import { INBOX } from "./types";

const longTitle = "A very long meeting title ".repeat(12).trim();
const twenty = Array.from(
  { length: 20 },
  (_, i) => `attendee.number.${i + 1}@a-long-organization-name.example.test`,
);

const older = buildRecording({
  id: 4,
  title: "Call with a charge nurse",
  recorded_on: "2026-11-03",
  attendee_emails: ["bravo@example-test.example.org", "nurse@riverbend-test.example.org"],
  reported_chars: 48211,
  submitted_by: 2,
  reason: "no person matches an attendee",
  consent_to_record: true,
});
const newer = buildRecording({
  id: 9,
  title: longTitle,
  recorded_on: "2026-11-10",
  attendee_emails: twenty,
  reported_chars: null,
  source: "paste",
  submitted_by: 3,
  reason: "consent not confirmed",
});
const skipped = buildRecording({
  id: 6,
  title: "Team standup",
  state: "dismissed",
  reason: "not an interview",
  resolved_by: 2,
});

const data: HubData = {
  contacts: [buildPerson({ id: 1 })],
  call_inbox: [newer, skipped, older],
};

const ada = buildMatch();
const bo = buildMatch({
  person_code: "BB-02",
  name: "Bo Okafor",
  organization: "Riverbend Clinic",
  matched: "domain",
});
const cy = buildMatch({
  person_code: "AA-03",
  name: "Cy Nurse",
  organization: null,
  matched: "name",
});
const di = buildMatch({ person_code: "CC-04", name: "Di Fourth" });

const inbox = (
  recordings: unknown[],
  actions: Parameters<typeof watchedProvider>[1] = {},
) => {
  const watched = watchedProvider(
    { ...data, call_inbox: recordings },
    { inbox_suggestions: () => [], ...actions },
  );
  return {
    watched,
    ui: (
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/inbox"]}
      >
        {null}
      </StoryWrapper>
    ),
  };
};

const items = (container: Element) =>
  [
    ...container.querySelectorAll('[data-testid="inbox-item"]'),
  ] as HTMLElement[];

const textOf = (container: Element, testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";

describe("the recordings inbox", () => {
  beforeEach(() => {
    page.viewport(1280, 800);
  });

  it("case 6: two waiting items oldest first, each with title, date, attendees, submitter, size and reason", async () => {
    const { watched, ui } = inbox(data.call_inbox!);
    const screen = await render(ui);

    await expect.poll(() => items(screen.container)).toHaveLength(2);
    const [first, second] = items(screen.container);
    expect(first.dataset.inboxId).toBe("4");
    expect(second.dataset.inboxId).toBe("9");
    expect(first.textContent).toContain("Call with a charge nurse");
    expect(first.textContent).toContain("2026-11-03");
    expect(first.textContent).toContain("bravo@example-test.example.org");
    expect(first.textContent).toContain("nurse@riverbend-test.example.org");
    await expect
      .poll(() => items(screen.container)[0].textContent)
      .toContain("Submitted by bravo");
    expect(first.textContent).toContain("48,211 characters");
    expect(first.textContent).toContain("no person matches an attendee");
    await expect
      .poll(() => items(screen.container)[1].textContent)
      .toContain("Submitted by alpha");
    expect(second.textContent).toContain("consent not confirmed");
    // a recording with no recorder has no size on file, and the screen says so
    expect(second.textContent).toContain("size not reported");
    // the draft overview is there, folded shut
    const fold = first.querySelector("details")!;
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain("A draft overview of the call.");
    expect(
      fold.querySelector('[data-testid="interview-overview"]')!.children.length,
    ).toBe(0);
    // the skipped one is not in this list
    expect(screen.container.textContent).not.toContain("Team standup");
    // no read of the inbox asked for a transcript, and none is on the page
    const reads = watched.columnsReadFrom(INBOX);
    expect(reads.length).toBeGreaterThan(0);
    expect(readColumn(reads, "transcript")).toBe(false);
    expect(screen.container.textContent).not.toContain("TRANSCRIPT-BODY");
  });

  it("edge: a title of 300 characters and twenty attendees wrap inside the page", async () => {
    const { ui } = inbox([newer]);
    const screen = await render(ui);

    await expect.poll(() => items(screen.container)).toHaveLength(1);
    const [item] = items(screen.container);
    expect(longTitle.length).toBeGreaterThanOrEqual(300);
    expect(item.textContent).toContain(longTitle);
    for (const address of twenty) expect(item.textContent).toContain(address);
    expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it("case 6: an empty inbox says Nothing is waiting", async () => {
    const { ui } = inbox([skipped]);
    const screen = await render(ui);

    await expect.element(screen.getByText("Nothing is waiting")).toBeVisible();
    expect(items(screen.container)).toEqual([]);
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  });

  it("case 7: three suggestions in the order given, each with its reason; a fourth is not shown", async () => {
    const { watched, ui } = inbox([older], {
      inbox_suggestions: () => [ada, bo, cy, di],
    });
    const screen = await render(ui);

    await expect
      .poll(() =>
        [
          ...screen.container.querySelectorAll('[data-testid="suggestion"]'),
        ].map((suggestion) => suggestion.textContent),
      )
      .toHaveLength(3);
    const shown = [
      ...screen.container.querySelectorAll('[data-testid="suggestion"]'),
    ].map((suggestion) => suggestion.textContent ?? "");
    expect(shown[0]).toContain("DD-01");
    expect(shown[0]).toContain("Ada Lovelace");
    expect(shown[0]).toContain("Acme");
    expect(shown[0]).toContain("same email");
    expect(shown[1]).toContain("BB-02");
    expect(shown[1]).toContain("Riverbend Clinic");
    expect(shown[1]).toContain("same email domain");
    expect(shown[2]).toContain("AA-03");
    expect(shown[2]).toContain("name in the title");
    expect(screen.container.textContent).not.toContain("Di Fourth");
    expect(watched.callsOf("inbox_suggestions")).toEqual([{ inbox_id: 4 }]);
  });

  it("case 7: with no suggestion the search and Create new person remain, and the search finds people", async () => {
    const { watched, ui } = inbox([older], {
      find_person: () => [di],
    });
    const screen = await render(ui);

    await expect
      .element(screen.getByText("Nobody on file matches this recording."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Create new person" }))
      .toBeVisible();
    await screen.getByLabelText("Search all people").fill("fourth");
    await screen.getByRole("button", { name: "Search" }).click();
    await expect
      .element(screen.getByRole("button", { name: /CC-04 Di Fourth/ }))
      .toBeVisible();
    expect(watched.callsOf("find_person")).toEqual([
      { query: "fourth", via: "ui" },
    ]);
  });

  it("case 8: Confirm needs a person and the tick, then calls confirm_recording", async () => {
    const { watched, ui } = inbox([older], {
      inbox_suggestions: () => [ada, bo],
      confirm_recording: () => ({
        inbox_id: 4,
        interview_id: 31,
        person_code: "BB-02",
      }),
    });
    const screen = await render(ui);

    const confirm = screen.getByRole("button", { name: "Confirm" });
    const tick = screen.getByLabelText("They agreed to be recorded");
    await expect.element(confirm).toBeDisabled();
    // the tick alone is not enough
    await tick.click();
    await expect.element(tick).toBeChecked();
    await expect.element(confirm).toBeDisabled();
    await tick.click();
    // a person alone is not enough
    await screen.getByRole("button", { name: /BB-02 Bo Okafor/ }).click();
    await expect
      .poll(() => textOf(screen.container, "chosen-person"))
      .toContain("BB-02");
    await expect.element(confirm).toBeDisabled();
    await tick.click();
    await expect.element(confirm).toBeEnabled();
    expect(watched.callsOf("confirm_recording")).toEqual([]);

    await confirm.click();
    await expect
      .poll(() => watched.callsOf("confirm_recording"))
      .toEqual([
        {
          inbox_id: 4,
          person_code: "BB-02",
          consent_to_record: true,
          via: "ui",
        },
      ]);
    // a link to the new interview is shown
    await expect
      .element(screen.getByRole("link", { name: "Open the interview" }))
      .toHaveAttribute("href", "/interviews/31/show");
  });

  it("case 8: a confirmed item leaves the list", async () => {
    const { watched, ui } = inbox([older, newer], {
      inbox_suggestions: () => [ada],
      confirm_recording: async () => {
        await watched.base.update(INBOX, {
          id: 4,
          data: { state: "confirmed", interview_id: 31 },
          previousData: older,
        });
        return { inbox_id: 4, interview_id: 31, person_code: "DD-01" };
      },
    });
    const screen = await render(ui);

    await expect.poll(() => items(screen.container)).toHaveLength(2);
    const first = screen.getByTestId("inbox-item").first();
    await first.getByRole("button", { name: /DD-01 Ada Lovelace/ }).click();
    await first.getByLabelText("They agreed to be recorded").click();
    await first.getByRole("button", { name: "Confirm" }).click();

    await expect
      .poll(() => items(screen.container).map((item) => item.dataset.inboxId))
      .toEqual(["9"]);
    await expect
      .element(screen.getByRole("link", { name: "Open the interview" }))
      .toBeVisible();
  });

  it("case 9: the tick starts off whatever the recording says, and changing the person clears it", async () => {
    expect(older.consent_to_record).toBe(true);
    const { ui } = inbox([older], {
      inbox_suggestions: () => [ada, bo],
    });
    const screen = await render(ui);

    const tick = screen.getByLabelText("They agreed to be recorded");
    await expect.element(tick).not.toBeChecked();
    await screen.getByRole("button", { name: /DD-01 Ada Lovelace/ }).click();
    await expect.element(tick).not.toBeChecked();
    await tick.click();
    await expect.element(tick).toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: "Confirm" }))
      .toBeEnabled();

    await screen.getByRole("button", { name: /BB-02 Bo Okafor/ }).click();
    await expect.element(tick).not.toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: "Confirm" }))
      .toBeDisabled();
  });

  it("case 10: a rejected confirm shows the sentence and reloads the list", async () => {
    const { watched, ui } = inbox([older], {
      inbox_suggestions: () => [ada],
      confirm_recording: () => {
        throw new Error("already confirmed by bravo as interview 12");
      },
    });
    const screen = await render(ui);

    await screen.getByRole("button", { name: /DD-01 Ada Lovelace/ }).click();
    await screen.getByLabelText("They agreed to be recorded").click();
    const readsBefore = watched.columnsReadFrom(INBOX).length;
    await screen.getByRole("button", { name: "Confirm" }).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("already confirmed by bravo as interview 12");
    await expect
      .poll(() => watched.columnsReadFrom(INBOX).length)
      .toBeGreaterThan(readsBefore);
  });

  it("case 11: NewPersonFromInbox fills the contact, calls add_person and selects the person without confirming", async () => {
    const { watched, ui } = inbox([older], {
      add_person: () => ({
        person_code: "DD-08",
        slug: "nia-nurse",
        name: "Nia Nurse",
        owner: "delta",
        status: "to-contact",
      }),
    });
    const screen = await render(ui);

    await screen.getByRole("button", { name: "Create new person" }).click();
    // bravo@example-test.example.org is a teammate's address: the first outside one is used
    await expect
      .element(screen.getByLabelText("Contact"))
      .toHaveValue("nurse@riverbend-test.example.org");
    // nobody is created without a typed name
    await expect.element(screen.getByLabelText("Name")).toHaveValue("");
    await expect
      .element(screen.getByRole("button", { name: "Save person" }))
      .toBeDisabled();
    expect(watched.callsOf("add_person")).toEqual([]);

    await screen.getByLabelText("Name").fill("Nia Nurse");
    await screen.getByLabelText("Role").fill("Charge nurse");
    await screen.getByRole("button", { name: "Save person" }).click();

    await expect
      .poll(() => textOf(screen.container, "chosen-person"))
      .toContain("DD-08 Nia Nurse");
    expect(watched.callsOf("add_person")).toEqual([
      {
        name: "Nia Nurse",
        role: "Charge nurse",
        contact: "nurse@riverbend-test.example.org",
        via: "ui",
      },
    ]);
    expect(watched.callsOf("confirm_recording")).toEqual([]);
    await expect
      .element(screen.getByLabelText("They agreed to be recorded"))
      .not.toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: "Confirm" }))
      .toBeDisabled();
  });

  it("case 11: the contact skips a teammate's address even when the teammates load after the form opens", async () => {
    // The flake of issue 60: the teammates list arrived after Create new
    // person was clicked, and the form had kept bravo@example-test.example.org.
    const { watched, ui } = inbox([older]);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = watched.getList.getMockImplementation()!;
    watched.getList.mockImplementation(async (resource, params) => {
      if (resource === "sales") await held;
      return read(resource, params);
    });
    const screen = await render(ui);

    await screen.getByRole("button", { name: "Create new person" }).click();
    release();
    await expect
      .element(screen.getByLabelText("Contact"))
      .toHaveValue("nurse@riverbend-test.example.org");
  });

  it("case 11: a duplicate refusal shows the sentence and offers the person on file", async () => {
    const sentence =
      "already on file (same name): CC-01, Maria Okafor, owner charlie, status to-contact, last touch none";
    const { watched, ui } = inbox([older], {
      add_person: () => {
        throw new Error(sentence);
      },
    });
    const screen = await render(ui);

    await screen.getByRole("button", { name: "Create new person" }).click();
    await screen.getByLabelText("Name").fill("Maria Okafor");
    await screen.getByRole("button", { name: "Save person" }).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(sentence);
    await expect
      .element(screen.getByLabelText("Name"))
      .toHaveValue("Maria Okafor");
    await screen.getByRole("button", { name: "Choose CC-01" }).click();
    await expect
      .poll(() => textOf(screen.container, "chosen-person"))
      .toContain("CC-01");
    expect(watched.callsOf("confirm_recording")).toEqual([]);
  });

  it("case 12: Skip needs a reason, then calls dismiss_recording", async () => {
    const { watched, ui } = inbox([older], {
      dismiss_recording: () => ({ inbox_id: 4, state: "dismissed" }),
    });
    const screen = await render(ui);

    await screen.getByRole("button", { name: "Skip" }).click();
    const skip = screen.getByRole("button", { name: "Skip this recording" });
    await expect.element(skip).toBeDisabled();
    await screen.getByLabelText("Reason").fill("   ");
    await expect.element(skip).toBeDisabled();
    expect(watched.callsOf("dismiss_recording")).toEqual([]);

    await screen.getByRole("button", { name: "not an interview" }).click();
    await expect
      .element(screen.getByLabelText("Reason"))
      .toHaveValue("not an interview");
    await skip.click();
    await expect
      .poll(() => watched.callsOf("dismiss_recording"))
      .toEqual([{ inbox_id: 4, reason: "not an interview", via: "ui" }]);
  });

  it("case 12: the Skipped filter shows the item with Confirm available", async () => {
    const { watched, ui } = inbox(data.call_inbox!, {
      inbox_suggestions: () => [ada],
      confirm_recording: () => ({
        inbox_id: 6,
        interview_id: 40,
        person_code: "DD-01",
      }),
    });
    const screen = await render(ui);

    await screen.getByRole("button", { name: "Skipped" }).click();
    await expect
      .poll(() => items(screen.container).map((item) => item.dataset.inboxId))
      .toEqual(["6"]);
    const [item] = items(screen.container);
    expect(item.textContent).toContain("Team standup");
    expect(item.textContent).toContain("not an interview");
    await expect
      .poll(() => items(screen.container)[0].textContent)
      .toContain("Skipped by bravo");
    // a skipped recording cannot be skipped again
    expect(
      [...item.querySelectorAll("button")].map((b) => b.textContent),
    ).not.toContain("Skip");

    await screen.getByRole("button", { name: /DD-01 Ada Lovelace/ }).click();
    await screen.getByLabelText("They agreed to be recorded").click();
    await screen.getByRole("button", { name: "Confirm" }).click();
    await expect
      .poll(() => watched.callsOf("confirm_recording"))
      .toEqual([
        {
          inbox_id: 6,
          person_code: "DD-01",
          consent_to_record: true,
          via: "ui",
        },
      ]);
  });

  it("case 12: a refused skip shows the database's sentence", async () => {
    const sentence =
      "only a waiting recording can be dismissed: this one was confirmed by bravo";
    const { ui } = inbox([older], {
      dismiss_recording: () => {
        throw new Error(sentence);
      },
    });
    const screen = await render(ui);

    await screen.getByRole("button", { name: "Skip" }).click();
    await screen.getByLabelText("Reason").fill("a duplicate");
    await screen.getByRole("button", { name: "Skip this recording" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent(sentence);
  });

  it("case 13: the menu shows Inbox with the count of waiting items", async () => {
    const screen = await render(
      <StoryWrapper data={hubData(data)}>
        <Header />
      </StoryWrapper>,
    );

    const link = screen.getByRole("link", { name: /Inbox/ });
    await expect.element(link).toHaveAttribute("href", "/inbox");
    await expect.element(screen.getByTestId("inbox-count")).toBeVisible();
    expect(
      screen.container.querySelector('[data-testid="inbox-count"]')!
        .textContent,
    ).toBe("2");
  });

  it("case 13: with nothing waiting the menu shows Inbox and no count", async () => {
    const screen = await render(
      <StoryWrapper data={hubData({ call_inbox: [skipped] })}>
        <Header />
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByRole("link", { name: /Inbox/ }))
      .toBeVisible();
    // People is drawn by the same menu: wait for it, then look for the count
    await expect
      .element(screen.getByRole("link", { name: "People" }))
      .toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      screen.container.querySelector('[data-testid="inbox-count"]'),
    ).toBeNull();
  });
});
