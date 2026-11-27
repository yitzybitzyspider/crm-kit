import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { buildCompany, StoryWrapper } from "@/test/StoryWrapper";

import { buildPerson, buildTouch, hubData } from "./testData";

const scriptText = "<script>window.__hubTouchXss = 1</script>";
const imgText = '<img src="x" onerror="window.__hubTouchXss = 2"> **not bold**';

const person = buildPerson({
  id: 1,
  person_code: "DD-07",
  status: "contacted",
  referred_by: "Dr. Okafor",
  quote_by_name: true,
});

const touches = [
  buildTouch({
    id: 1,
    date: "2025-03-01T10:00:00.000Z",
    text: "Oldest: sent a first email",
    channel: "email",
  }),
  buildTouch({
    id: 2,
    date: "2025-03-05T10:00:00.000Z",
    text: imgText,
    channel: "linkedin",
    sales_id: 2,
  }),
  buildTouch({
    id: 3,
    date: "2025-03-09T10:00:00.000Z",
    text: scriptText,
    channel: "phone",
    next_step: "Send the consent form",
    next_due: "2026-12-01",
  }),
];

const at = (path: string, data = {}) => (
  <StoryWrapper
    data={hubData({ contacts: [person], contact_notes: touches, ...data })}
    initialEntries={[path]}
  >
    {null}
  </StoryWrapper>
);

const forbidden = /delete|merge/i;
const forbiddenControls = () =>
  [...document.querySelectorAll("button, a, [role=menuitem]")]
    .map(
      (control) =>
        `${control.textContent ?? ""} ${control.getAttribute("aria-label") ?? ""}`,
    )
    .filter((label) => forbidden.test(label));

describe("the person page", () => {
  beforeEach(() => {
    page.viewport(1280, 800);
    delete (window as any).__hubTouchXss;
  });

  it("case 7: shows the person code beside the name", async () => {
    const screen = await render(at("/contacts/1/show"));

    await expect
      .element(screen.getByRole("heading", { name: /Ada Lovelace/ }))
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("heading", { name: /Ada Lovelace/ })
          .getByText("DD-07"),
      )
      .toBeVisible();
  });

  it("case 7: the timeline lists three touches newest first with date, who, channel, text, next step and due date", async () => {
    const screen = await render(at("/contacts/1/show"));

    await expect
      .poll(() =>
        [...screen.container.querySelectorAll('[data-testid="touch"]')].map(
          (touch) => touch.getAttribute("data-touch-id"),
        ),
      )
      .toEqual(["3", "2", "1"]);

    const row = (id: number) =>
      screen.container.querySelector(
        `[data-testid="touch"][data-touch-id="${id}"]`,
      ) as HTMLElement;

    // date
    expect(row(3).textContent).toContain("3/9/2025");
    expect(row(2).textContent).toContain("3/5/2025");
    expect(row(1).textContent).toContain("3/1/2025");
    // who
    expect(row(3).textContent).toContain("You added a note");
    await expect
      .poll(() => row(2).textContent)
      .toContain("Jordan Tran added a note");
    // channel
    expect(row(3).textContent).toContain("Phone");
    expect(row(2).textContent).toContain("LinkedIn");
    expect(row(1).textContent).toContain("Email");
    // text
    expect(row(1).textContent).toContain("Oldest: sent a first email");
    // next step and due date
    expect(row(3).textContent).toContain("Send the consent form");
    expect(row(3).textContent).toContain("2026-12-01");
    expect(row(1).textContent).not.toMatch(/Next step/);
  });

  it("issue 63 case 8: a touch with channel text shows the label Text message", async () => {
    const texted = buildTouch({
      id: 4,
      date: "2025-03-10T10:00:00.000Z",
      text: "Texted about Thursday",
      channel: "text",
    });
    const screen = await render(
      at("/contacts/1/show", { contact_notes: [...touches, texted] }),
    );

    const row = () =>
      screen.container.querySelector(
        '[data-testid="touch"][data-touch-id="4"]',
      ) as HTMLElement | null;
    await expect.poll(() => row()?.textContent ?? "").toContain("Text message");
    expect(row()?.textContent).toContain("Texted about Thursday");
  });

  it("case 7: a touch text holding a script tag, HTML or markdown is shown as text and nothing runs", async () => {
    const screen = await render(at("/contacts/1/show"));

    await expect.element(screen.getByText(scriptText)).toBeVisible();
    await expect.element(screen.getByText(imgText)).toBeVisible();
    const timeline = screen.container.querySelectorAll('[data-testid="touch"]');
    for (const touch of timeline) {
      expect(touch.querySelector("script, img[src='x'], strong")).toBeNull();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((window as any).__hubTouchXss).toBeUndefined();
  });

  it("shows the status picker with the seven statuses, the owner, referred by and quote by name", async () => {
    const screen = await render(at("/contacts/1/show"));

    await expect.element(screen.getByText("Dr. Okafor")).toBeVisible();
    await expect
      .element(screen.getByText("May be quoted by name"))
      .toBeVisible();
    await expect.element(screen.getByText("Followed by you")).toBeVisible();

    // the status picker of the aside comes after the pickers of the note box
    const status = screen
      .getByRole("combobox")
      .filter({ hasText: "Contacted" })
      .last();
    await expect.element(status).toBeVisible();
    await status.click();
    await expect
      .poll(() =>
        [...document.querySelectorAll('[role="option"]')].map((option) =>
          option.textContent?.trim(),
        ),
      )
      .toEqual([
        "None",
        "To contact",
        "Contacted",
        "Replied",
        "Scheduled",
        "Interviewed",
        "Declined",
        "Do not contact",
      ]);
  });

  it("shows the contact key when the person has no email, phone or LinkedIn, and every part draws for a person with nothing else", async () => {
    const bare = buildPerson({
      id: 1,
      person_code: "DD-09",
      title: "",
      company_id: null,
      email_jsonb: [],
      phone_jsonb: [],
      linkedin_url: null,
      contact_key: "signal: ada.l",
      referred_by: null,
      quote_by_name: false,
    });
    const screen = await render(
      at("/contacts/1/show", { contacts: [bare], contact_notes: [] }),
    );

    await expect.element(screen.getByText("DD-09")).toBeVisible();
    await expect.element(screen.getByText("signal: ada.l")).toBeVisible();
    await expect
      .element(screen.getByText("Quoted without their name"))
      .toBeVisible();
    await expect.element(screen.getByPlaceholder("Add a note")).toBeVisible();
  });

  it("issue 64 case 19: each entry of links is drawn as a link that opens apart, with noopener noreferrer", async () => {
    const linked = buildPerson({
      id: 1,
      person_code: "DD-01",
      linkedin_url: "https://www.linkedin.com/in/x/",
      links: [
        "https://emergency.metro.edu/content/casey-lane",
        "https://metro.example/profile",
      ],
      contact_key: "https://emergency.metro.edu/content/casey-lane",
    });
    const screen = await render(
      at("/contacts/1/show", { contacts: [linked], contact_notes: [] }),
    );

    await expect.element(screen.getByText("DD-01")).toBeVisible();
    for (const address of linked.links ?? []) {
      const anchors = [
        ...document.querySelectorAll<HTMLAnchorElement>("a"),
      ].filter((a) => a.getAttribute("href") === address);
      expect(anchors.length).toBe(1);
      expect(anchors[0].getAttribute("rel")).toBe("noopener noreferrer");
      expect(anchors[0].getAttribute("target")).toBe("_blank");
      expect(anchors[0].textContent).toContain(new URL(address).host);
    }
    await expect
      .element(screen.getByText("Contact:", { exact: true }))
      .not.toBeInTheDocument();
  });

  it("case 8: no delete or merge control on the person page, on a touch, or on the person's edit page", async () => {
    const screen = await render(at("/contacts/1/show"));
    await expect
      .poll(
        () => screen.container.querySelectorAll('[data-testid="touch"]').length,
      )
      .toBe(3);
    await screen.getByText("Oldest: sent a first email").hover();
    await expect
      .element(screen.getByRole("button", { name: "Edit note" }).first())
      .toBeInTheDocument();
    expect(forbiddenControls()).toEqual([]);

    await screen.unmount();
    const edit = await render(at("/contacts/1"));
    await expect
      .element(edit.getByRole("button", { name: /^save$/i }))
      .toBeVisible();
    await expect.element(edit.getByText("Export to vCard")).toBeVisible();
    expect(forbiddenControls()).toEqual([]);
  });

  it("case 8: no delete or bulk delete on the people list", async () => {
    const screen = await render(at("/contacts"));

    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect.element(screen.getByText("DD-07")).toBeVisible();
    await screen.getByRole("checkbox").first().click();
    await expect
      .element(screen.getByRole("button", { name: /^Tag$/ }))
      .toBeVisible();
    expect(forbiddenControls()).toEqual([]);
  });

  it("case 8: no delete control on a company page or its edit page", async () => {
    const companies = [buildCompany({ id: 1, name: "Mercy General" })];
    const screen = await render(at("/companies/1/show", { companies }));
    await expect
      .element(screen.getByRole("heading", { name: "Mercy General" }))
      .toBeVisible();
    expect(forbiddenControls()).toEqual([]);

    await screen.unmount();
    const edit = await render(at("/companies/1", { companies }));
    await expect
      .element(edit.getByRole("button", { name: /^save$/i }))
      .toBeVisible();
    // the aside, where upstream's delete button sits, has drawn
    await expect
      .element(edit.getByRole("link", { name: "Show company" }))
      .toBeVisible();
    expect(forbiddenControls()).toEqual([]);
  });

  it("the people list filters by the seven statuses", async () => {
    const screen = await render(at("/contacts"));

    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    for (const label of [
      "To contact",
      "Contacted",
      "Replied",
      "Scheduled",
      "Interviewed",
      "Declined",
      "Do not contact",
    ]) {
      await expect
        .element(screen.getByRole("button", { name: new RegExp(`^${label}`) }))
        .toBeVisible();
    }
    await screen.getByRole("button", { name: /^Declined/ }).click();
    await expect
      .element(screen.getByText("Ada Lovelace"))
      .not.toBeInTheDocument();
  });
});
