import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { StoryWrapper } from "@/test/StoryWrapper";

import { buildPerson, hubData, hubDataProvider } from "./testData";

const sentence = "this person is already on file as AA-03";

const createPage = (provider: object = {}) => (
  <StoryWrapper
    data={hubData({ contacts: [buildPerson({ id: 1 })] })}
    dataProvider={provider}
    initialEntries={["/contacts/create"]}
  >
    {null}
  </StoryWrapper>
);

describe("adding a person", () => {
  beforeEach(() => {
    page.viewport(1280, 800);
  });

  it("case 10: the create form has no input for person code or slug", async () => {
    const screen = await render(createPage());

    await expect.element(screen.getByLabelText(/first name/i)).toBeVisible();
    const fields = [
      ...screen.container.querySelectorAll("input, textarea, select"),
    ].map(
      (input) =>
        `${input.getAttribute("name") ?? ""} ${input.getAttribute("id") ?? ""}`,
    );
    expect(fields.length).toBeGreaterThan(3);
    expect(
      fields.filter((field) =>
        /person_code|slug|name_key|contact_key/.test(field),
      ),
    ).toEqual([]);
    expect(screen.container.textContent).not.toMatch(/person code|slug/i);
  });

  it("case 10: when the save is refused as a duplicate the sentence is shown beside the form and the form stays filled", async () => {
    const create = vi.fn(() => Promise.reject(new Error(sentence)));
    const screen = await render(createPage({ create }));

    await screen.getByLabelText(/first name/i).fill("Maria");
    await screen.getByLabelText(/last name/i).fill("Okafor");
    await screen.getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => create.mock.calls.length).toBe(1);
    await expect
      .element(screen.getByRole("alert").filter({ hasText: sentence }))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText(/first name/i))
      .toHaveValue("Maria");
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveValue("Okafor");
    // still on the form: nothing was saved, nothing moved on
    await expect
      .element(screen.getByRole("button", { name: /^save$/i }))
      .toBeVisible();
  });

  it("a person who is saved leaves no refusal on screen", async () => {
    const data = { contacts: [buildPerson({ id: 1 })] };
    const base = hubDataProvider(data);
    const create = vi.fn((resource: string, params: any) =>
      base.create(resource, params),
    );
    const screen = await render(createPage({ create }));

    await screen.getByLabelText(/first name/i).fill("Maria");
    await screen.getByLabelText(/last name/i).fill("Okafor");
    await screen.getByRole("button", { name: /^save$/i }).click();

    await expect.poll(() => create.mock.calls.length).toBe(1);
    expect(create.mock.calls[0][1].data).not.toHaveProperty("person_code");
    expect(create.mock.calls[0][1].data).not.toHaveProperty("slug");
    await expect
      .element(screen.getByRole("heading", { name: /Maria Okafor/ }))
      .toBeVisible();
  });
});
