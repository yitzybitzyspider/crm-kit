import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { StoryWrapper } from "@/test/StoryWrapper";

import { PeopleBoard } from "./PeopleBoard";
import {
  buildFollowUp,
  buildPerson,
  hubData,
  hubDataProvider,
  type HubData,
} from "./testData";

const headings = [
  "To contact",
  "Contacted",
  "Replied",
  "Scheduled",
  "Interviewed",
  "Declined",
  "Do not contact",
];

const columnHeadings = (container: Element) =>
  [...container.querySelectorAll('[data-testid^="people-column-"] h3')].map(
    (heading) => heading.textContent,
  );

const cardsIn = (container: Element, status: string) =>
  [
    ...container.querySelectorAll(
      `[data-testid="people-column-${status}"] [data-testid="person-card"]`,
    ),
  ].map((card) => card.getAttribute("data-person-code"));

const board = (data: HubData, dataProvider?: object) => (
  <StoryWrapper data={hubData(data)} dataProvider={dataProvider}>
    <PeopleBoard />
  </StoryWrapper>
);

// Lifts the focused card with the keyboard and drops it one column to the right.
const dragOneColumnRight = async (card: Element) => {
  (card as HTMLElement).focus();
  await userEvent.keyboard(" ");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await userEvent.keyboard("{ArrowRight}");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await userEvent.keyboard(" ");
};

describe("PeopleBoard", () => {
  beforeEach(() => {
    page.viewport(1600, 900);
  });

  it("case 1: seven columns in pipeline order, each person in the column of their status", async () => {
    const screen = await render(
      board({
        contacts: [
          buildPerson({ id: 1, status: "replied", person_code: "DD-01" }),
          buildPerson({
            id: 2,
            first_name: "Grace",
            last_name: "Hopper",
            status: "do-not-contact",
            person_code: "DD-02",
          }),
        ],
      }),
    );

    await expect.poll(() => columnHeadings(screen.container)).toEqual(headings);
    await expect
      .poll(() => cardsIn(screen.container, "replied"))
      .toEqual(["DD-01"]);
    await expect
      .poll(() => cardsIn(screen.container, "do-not-contact"))
      .toEqual(["DD-02"]);
    expect(cardsIn(screen.container, "to-contact")).toEqual([]);
    await expect
      .element(
        screen.getByTestId("people-column-replied").getByText("Ada Lovelace"),
      )
      .toBeVisible();
  });

  it("case 1: with no people at all, seven empty columns and a prompt to add a person", async () => {
    const screen = await render(board({ contacts: [] }));

    await expect.poll(() => columnHeadings(screen.container)).toEqual(headings);
    expect(
      screen.container.querySelectorAll('[data-testid="person-card"]').length,
    ).toBe(0);
    await expect
      .element(screen.getByRole("link", { name: "Add a person" }).first())
      .toBeVisible();
    await expect
      .element(screen.getByText(/Nobody is on file yet/))
      .toBeVisible();
    expect(screen.container.textContent).not.toMatch(/error/i);
  });

  it("case 2: the owner filter set to bravo hides the other teammates' people", async () => {
    const screen = await render(
      board({
        contacts: [
          buildPerson({ id: 1, sales_id: 0, person_code: "DD-01" }),
          buildPerson({
            id: 2,
            first_name: "Grace",
            last_name: "Hopper",
            sales_id: 2,
            person_code: "BB-01",
          }),
          buildPerson({
            id: 3,
            first_name: "Alan",
            last_name: "Turing",
            sales_id: 3,
            person_code: "AA-01",
          }),
        ],
      }),
    );

    await expect
      .poll(() => cardsIn(screen.container, "to-contact").sort())
      .toEqual(["BB-01", "AA-01", "DD-01"]);

    await screen.getByRole("combobox", { name: "Owner" }).click();
    await screen.getByRole("option", { name: "bravo", exact: true }).click();

    await expect
      .poll(() => cardsIn(screen.container, "to-contact"))
      .toEqual(["BB-01"]);
    await expect
      .element(screen.getByText("Ada Lovelace"))
      .not.toBeInTheDocument();
  });

  it("case 4: dragging a card from contacted to replied saves status replied", async () => {
    const data = {
      contacts: [buildPerson({ id: 1, status: "contacted" })],
    };
    const base = hubDataProvider(data);
    const update = vi.fn((resource: string, params: any) =>
      base.update(resource, params),
    );
    const screen = await render(board(data, { ...base, update }));

    await expect
      .poll(() => cardsIn(screen.container, "contacted"))
      .toEqual(["DD-01"]);
    await dragOneColumnRight(
      screen.container.querySelector('[data-testid="person-card"]')!,
    );

    await expect
      .poll(() => cardsIn(screen.container, "replied"))
      .toEqual(["DD-01"]);
    await expect.poll(() => update.mock.calls.length).toBe(1);
    expect(update.mock.calls[0][0]).toBe("contacts");
    expect(update.mock.calls[0][1].id).toBe(1);
    expect(update.mock.calls[0][1].data).toEqual({ status: "replied" });
    expect(cardsIn(screen.container, "contacted")).toEqual([]);
  });

  it("case 4: when the save is refused the card is back in its column and the sentence is on screen", async () => {
    const sentence = "the status replied needs at least one touch on file";
    const data = {
      contacts: [buildPerson({ id: 1, status: "contacted" })],
    };
    const update = vi.fn(() => Promise.reject(new Error(sentence)));
    const screen = await render(board(data, { update }));

    await expect
      .poll(() => cardsIn(screen.container, "contacted"))
      .toEqual(["DD-01"]);
    await dragOneColumnRight(
      screen.container.querySelector('[data-testid="person-card"]')!,
    );

    await expect.poll(() => update.mock.calls.length).toBe(1);
    await expect.element(screen.getByText(sentence)).toBeVisible();
    await expect
      .poll(() => cardsIn(screen.container, "contacted"))
      .toEqual(["DD-01"]);
    expect(cardsIn(screen.container, "replied")).toEqual([]);
  });

  it("the next step of a person's newest touch shows on their card", async () => {
    const screen = await render(
      board({
        contacts: [buildPerson({ id: 1, status: "contacted" })],
        follow_ups: [buildFollowUp({ contact_id: 1, next_step: "Send deck" })],
      }),
    );

    await expect
      .element(screen.getByTestId("person-card").getByText("Send deck"))
      .toBeVisible();
  });

  it("edge: 200 people in one column scroll inside the column, and the draw time is recorded", async () => {
    const contacts = Array.from({ length: 200 }, (_, index) =>
      buildPerson({
        id: index + 1,
        first_name: "Person",
        last_name: `Number ${index + 1}`,
        status: "to-contact",
        person_code: `YZ-${String(index + 1).padStart(2, "0")}`,
      }),
    );
    const started = performance.now();
    const screen = await render(board({ contacts }));

    await expect
      .poll(() => cardsIn(screen.container, "to-contact").length, {
        timeout: 20000,
      })
      .toBe(200);
    const elapsed = Math.round(performance.now() - started);
    console.log(`PeopleBoard: 200 people in one column drawn in ${elapsed} ms`);

    const list = screen.container.querySelector(
      '[data-testid="people-column-to-contact"] [data-testid="people-column-list"]',
    ) as HTMLElement;
    expect(getComputedStyle(list).overflowY).toBe("auto");
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(list.clientHeight).toBeLessThan(900);
    expect(elapsed).toBeLessThan(15000);
  });

  it("edge: in a narrow window the board scrolls sideways and a card still opens the person", async () => {
    page.viewport(375, 667);
    const screen = await render(
      <StoryWrapper
        data={hubData({ contacts: [buildPerson({ id: 1 })] })}
        initialEntries={["/"]}
      >
        <PeopleBoard />
      </StoryWrapper>,
    );

    await expect
      .poll(() => cardsIn(screen.container, "to-contact"))
      .toEqual(["DD-01"]);
    const scroller = screen.container.querySelector(
      '[data-testid="people-board"]',
    ) as HTMLElement;
    expect(getComputedStyle(scroller).overflowX).toBe("auto");
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    await screen.getByTestId("person-card").click();
    await expect
      .poll(() =>
        screen.container.querySelector('[data-testid="people-board"]'),
      )
      .toBeNull();
  });
});
