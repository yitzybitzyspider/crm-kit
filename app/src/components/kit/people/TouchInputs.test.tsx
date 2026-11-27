import { Form } from "ra-core";
import { render } from "vitest-browser-react";
import { ContactShow } from "@/components/atomic-crm/contacts/ContactShow";
import { StoryWrapper } from "@/test/StoryWrapper";

import { TouchInputs } from "./TouchInputs";
import { buildPerson, hubData, hubDataProvider } from "./testData";

const optionNames = () =>
  [...document.querySelectorAll('[role="option"]')].map((option) =>
    option.textContent?.trim(),
  );

describe("TouchInputs", () => {
  it("case 5: saving with no channel is blocked with a message", async () => {
    const onSubmit = vi.fn();
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <Form onSubmit={onSubmit}>
          <TouchInputs />
          <button type="submit">Save touch</button>
        </Form>
      </StoryWrapper>,
    );

    await screen.getByRole("button", { name: "Save touch" }).click();

    await expect
      .element(screen.getByText("A touch needs a channel"))
      .toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("case 5: the seven channels are offered and none is chosen to begin with", async () => {
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <Form onSubmit={() => {}}>
          <TouchInputs />
        </Form>
      </StoryWrapper>,
    );

    const channel = screen.getByRole("combobox", { name: /Channel/ });
    await expect.element(channel).toBeVisible();
    for (const name of ["Email", "LinkedIn", "Phone", "Text message", "Intro", "In person"]) {
      expect(channel.element().textContent).not.toContain(name);
    }
    await channel.click();
    await expect
      .poll(optionNames)
      .toEqual([
        "Email",
        "LinkedIn",
        "Phone",
        "Text message",
        "Intro",
        "In person",
        "Other",
      ]);
  });

  it("case 5: the due date is disabled until next step has text, and a saved touch carries channel, next_step and next_due", async () => {
    const onSubmit = vi.fn();
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <Form onSubmit={onSubmit}>
          <TouchInputs />
          <button type="submit">Save touch</button>
        </Form>
      </StoryWrapper>,
    );

    const due = screen.getByLabelText(/Due by/);
    await expect.element(due).toBeDisabled();

    await screen.getByLabelText(/Next step/).fill("Follow up");
    await expect.element(due).toBeEnabled();
    await due.fill("2026-12-01");

    await screen.getByRole("combobox", { name: /Channel/ }).click();
    await screen.getByRole("option", { name: "LinkedIn" }).click();
    await screen.getByRole("button", { name: "Save touch" }).click();

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      channel: "linkedin",
      next_step: "Follow up",
      next_due: "2026-12-01",
    });
  });

  it("case 5: clearing the next step clears the due date and disables it again", async () => {
    const onSubmit = vi.fn();
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <Form onSubmit={onSubmit}>
          <TouchInputs />
          <button type="submit">Save touch</button>
        </Form>
      </StoryWrapper>,
    );

    await screen.getByLabelText(/Next step/).fill("Follow up");
    await screen.getByLabelText(/Due by/).fill("2026-12-01");
    await screen.getByLabelText(/Next step/).fill("");
    await expect.element(screen.getByLabelText(/Due by/)).toBeDisabled();

    await screen.getByRole("combobox", { name: /Channel/ }).click();
    await screen.getByRole("option", { name: "Email" }).click();
    await screen.getByRole("button", { name: "Save touch" }).click();

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0][0].next_step ?? null).toBeNull();
    expect(onSubmit.mock.calls[0][0].next_due ?? null).toBeNull();
  });
});

describe("TouchInputs in the note box of the person page", () => {
  const personPage = (
    data: Parameters<typeof hubData>[0],
    provider: object,
  ) => (
    <StoryWrapper data={hubData(data)} dataProvider={provider}>
      <ContactShow resource="contacts" id={1} />
    </StoryWrapper>
  );

  it("case 5: the note box will not save a touch with no channel", async () => {
    const data = { contacts: [buildPerson({ id: 1, status: "to-contact" })] };
    const base = hubDataProvider(data);
    const create = vi.fn((resource: string, params: any) =>
      base.create(resource, params),
    );
    const screen = await render(personPage(data, { ...base, create }));

    await screen.getByPlaceholder("Add a note").fill("Wrote to her");
    await screen.getByRole("button", { name: "Add this note" }).click();

    await expect
      .element(screen.getByText("A touch needs a channel"))
      .toBeVisible();
    expect(create).not.toHaveBeenCalled();
    await expect
      .element(screen.getByPlaceholder("Add a note"))
      .toHaveValue("Wrote to her");
  });

  it("case 6: the status picker offers the six statuses other than interviewed", async () => {
    const data = { contacts: [buildPerson({ id: 1, status: "to-contact" })] };
    const screen = await render(personPage(data, {}));

    await screen.getByPlaceholder("Add a note").fill("Wrote to her");
    await screen.getByRole("button", { name: "Show options" }).click();
    await screen
      .getByRole("combobox", { name: /Status/ })
      .last()
      .click();

    await expect
      .poll(optionNames)
      // each option holds the colour dot's hidden label and then the name
      .toEqual([
        "To contact To contact",
        "Contacted Contacted",
        "Replied Replied",
        "Scheduled Scheduled",
        "Declined Declined",
        "Do not contact Do not contact",
      ]);
  });

  it("case 6: untouched, a to-contact person is saved as contacted", async () => {
    const data = { contacts: [buildPerson({ id: 1, status: "to-contact" })] };
    const base = hubDataProvider(data);
    const create = vi.fn((resource: string, params: any) =>
      base.create(resource, params),
    );
    const update = vi.fn((resource: string, params: any) =>
      base.update(resource, params),
    );
    const screen = await render(personPage(data, { ...base, create, update }));

    await screen.getByPlaceholder("Add a note").fill("Wrote to her");
    await screen.getByRole("combobox", { name: /Channel/ }).click();
    await screen.getByRole("option", { name: "Email" }).click();
    await screen.getByLabelText(/Next step/).fill("Follow up");
    await screen.getByLabelText(/Due by/).fill("2026-12-01");
    await screen.getByRole("button", { name: "Add this note" }).click();

    await expect.poll(() => create.mock.calls.length).toBe(1);
    expect(create.mock.calls[0][0]).toBe("contact_notes");
    expect(create.mock.calls[0][1].data).toMatchObject({
      contact_id: 1,
      text: "Wrote to her",
      channel: "email",
      next_step: "Follow up",
      next_due: "2026-12-01",
      status: "contacted",
    });
    await expect
      .poll(
        () =>
          update.mock.calls.find(([resource]) => resource === "contacts")?.[1]
            .data.status,
      )
      .toBe("contacted");
    await expect.element(screen.getByText("Wrote to her")).toBeVisible();
  });

  it("case 6: a person further along keeps their status when a touch is logged", async () => {
    const data = { contacts: [buildPerson({ id: 1, status: "scheduled" })] };
    const base = hubDataProvider(data);
    const create = vi.fn((resource: string, params: any) =>
      base.create(resource, params),
    );
    const screen = await render(personPage(data, { ...base, create }));

    await screen.getByPlaceholder("Add a note").fill("Confirmed the time");
    await screen.getByRole("combobox", { name: /Channel/ }).click();
    await screen.getByRole("option", { name: "Phone" }).click();
    await screen.getByRole("button", { name: "Add this note" }).click();

    await expect.poll(() => create.mock.calls.length).toBe(1);
    expect(create.mock.calls[0][1].data.status).toBe("scheduled");
    expect(create.mock.calls[0][1].data.next_step ?? null).toBeNull();
    expect(create.mock.calls[0][1].data.next_due ?? null).toBeNull();
  });

  it("edge: when the connection drops during a save an error is shown and the form keeps what was typed", async () => {
    const data = { contacts: [buildPerson({ id: 1, status: "to-contact" })] };
    const create = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
    const screen = await render(personPage(data, { create }));

    await screen.getByPlaceholder("Add a note").fill("Wrote to her");
    await screen.getByRole("combobox", { name: /Channel/ }).click();
    await screen.getByRole("option", { name: "Email" }).click();
    await screen.getByLabelText(/Next step/).fill("Follow up");
    await screen.getByRole("button", { name: "Add this note" }).click();

    await expect.poll(() => create.mock.calls.length).toBe(1);
    await expect.element(screen.getByText("Failed to fetch")).toBeVisible();
    await expect
      .element(screen.getByPlaceholder("Add a note"))
      .toHaveValue("Wrote to her");
    await expect
      .element(screen.getByLabelText(/Next step/))
      .toHaveValue("Follow up");
  });
});
