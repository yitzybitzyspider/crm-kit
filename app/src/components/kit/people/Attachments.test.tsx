// team hub, issue 47 item 2: an old touch that still carries attachment
// entries draws no link and no picture for them. The hub has no attachments
// (hub.shows.attachments is false), and an entry's src was never checked.
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { StoryWrapper } from "@/test/StoryWrapper";

import { buildPerson, buildTouch, hubData } from "./testData";

const person = buildPerson({
  id: 1,
  person_code: "DD-07",
  status: "contacted",
});

const touch = buildTouch({
  id: 1,
  date: "2025-03-01T10:00:00.000Z",
  text: "Sent the consent form",
  channel: "email",
  attachments: [
    {
      src: "javascript:window.__hubAttachment = 1",
      title: "consent-form.pdf",
      type: "application/pdf",
    },
    {
      src: "javascript:window.__hubAttachment = 2",
      title: "scan.png",
      type: "image/png",
    },
  ] as any,
});

const at = (path: string) => (
  <StoryWrapper
    data={hubData({ contacts: [person], contact_notes: [touch] })}
    initialEntries={[path]}
  >
    {null}
  </StoryWrapper>
);

const drawnAttachments = () => ({
  scriptLinks: document.querySelectorAll('a[href^="javascript:" i]').length,
  pictures: document.querySelectorAll(
    'img[src^="javascript:" i], img[alt="scan.png"]',
  ).length,
  titles: [...document.querySelectorAll("a, img, span, p, div")]
    .filter((node) => node.children.length === 0)
    .filter((node) =>
      /consent-form\.pdf|scan\.png/.test(node.textContent ?? ""),
    ).length,
});

describe("issue 47 item 2: attachments are not drawn", () => {
  beforeEach(() => {
    delete (window as any).__hubAttachment;
  });

  it("on the person page, a touch carrying attachments with a javascript: src shows no link and no picture", async () => {
    page.viewport(1280, 800);
    const screen = await render(at("/contacts/1/show"));

    await expect
      .element(screen.getByText("Sent the consent form"))
      .toBeVisible();
    expect(drawnAttachments()).toEqual({
      scriptLinks: 0,
      pictures: 0,
      titles: 0,
    });
    expect((window as any).__hubAttachment).toBeUndefined();
  });

  it("on a phone, the touch's own page shows no link and no picture either", async () => {
    page.viewport(375, 667);
    const screen = await render(at("/contacts/1/notes/1"));

    await expect
      .element(screen.getByText("Sent the consent form"))
      .toBeVisible();
    expect(drawnAttachments()).toEqual({
      scriptLinks: 0,
      pictures: 0,
      titles: 0,
    });
    expect((window as any).__hubAttachment).toBeUndefined();
  });

  // The router's note on issue 47: the note form's hint beside "Show options"
  // offered attaching files, which the hub does not do.
  it("the note form's hint beside Show options does not offer attaching files", async () => {
    page.viewport(1280, 800);
    const screen = await render(at("/contacts/1/show"));

    await expect
      .element(screen.getByRole("button", { name: "Show options" }))
      .toBeVisible();
    await expect.element(screen.getByText("(change details)")).toBeVisible();
    expect(document.body.textContent ?? "").not.toMatch(/attach files/i);
  });
});
