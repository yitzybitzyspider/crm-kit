import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { StoryWrapper } from "@/test/StoryWrapper";

import {
  buildFollowUp,
  buildPerson,
  buildTouch,
  hubData,
  type HubData,
} from "../people/testData";
import { Calendar } from "./Calendar";

// Made up people. Today is fixed so the month shown does not drift.
const today = new Date(2026, 10, 25); // 2026-11-25

const naomi = buildPerson({
  id: 1,
  first_name: "Nora",
  last_name: "Mills",
  person_code: "DD-07",
  status: "scheduled",
  sales_id: 0,
});
const bo = buildPerson({
  id: 2,
  first_name: "Bo",
  last_name: "Okafor",
  person_code: "BB-02",
  status: "contacted",
  sales_id: 2,
});
const cy = buildPerson({
  id: 3,
  first_name: "Cy",
  last_name: "Park",
  person_code: "DD-03",
  status: "contacted",
  sales_id: 0,
});
const dee = buildPerson({
  id: 4,
  first_name: "Dee",
  last_name: "Ruiz",
  person_code: "DD-04",
  status: "replied",
  sales_id: 0,
});
const eli = buildPerson({
  id: 5,
  first_name: "Eli",
  last_name: "Shaw",
  person_code: "DD-05",
  status: "interviewed",
  sales_id: 0,
});

const data: HubData = {
  contacts: [naomi, bo, cy, dee, eli],
  contact_notes: [
    // a scheduled interview, logged with no next step
    buildTouch({
      id: 11,
      contact_id: 1,
      status: "scheduled",
      next_due: "2026-11-27",
    }),
    // a person since interviewed: their scheduled item drops off
    buildTouch({
      id: 15,
      contact_id: 5,
      status: "scheduled",
      next_due: "2026-11-20",
    }),
  ],
  follow_ups: [
    buildFollowUp({
      id: 2,
      contact_id: 2,
      person_code: "BB-02",
      owner_id: 2,
      contact_note_id: 12,
      next_step: "Send the deck",
      next_due: "2026-11-26",
    }),
    buildFollowUp({
      id: 3,
      contact_id: 3,
      person_code: "DD-03",
      owner_id: 0,
      contact_note_id: 13,
      next_step: "Call the clinic back",
      next_due: "2026-11-10",
    }),
    buildFollowUp({
      id: 4,
      contact_id: 4,
      person_code: "DD-04",
      owner_id: 0,
      contact_note_id: 14,
      next_step: "Ask for a time",
      next_due: null,
    }),
  ],
};

const draw = () =>
  render(
    <StoryWrapper data={hubData(data)}>
      <Calendar today={today} />
    </StoryWrapper>,
  );

describe("the calendar of interviews and follow-ups", () => {
  beforeEach(() => {
    page.viewport(1400, 1000);
  });

  it("items land on their due dates", async () => {
    const screen = await draw();
    const day27 = screen.getByTestId("day-2026-11-27");
    await expect.element(day27.getByText("Nora Mills")).toBeVisible();
    await expect.element(day27.getByText("DD-07")).toBeVisible();
    const day26 = screen.getByTestId("day-2026-11-26");
    await expect.element(day26.getByText("Send the deck")).toBeVisible();
    // the interviewed person's scheduled item is gone
    await expect.element(screen.getByText("Eli Shaw")).not.toBeInTheDocument();
  });

  it("the mine filter hides others' items", async () => {
    const screen = await draw();
    await expect.element(screen.getByText("Bo Okafor")).toBeVisible();
    await screen.getByRole("button", { name: "Mine" }).click();
    await expect.element(screen.getByText("Bo Okafor")).not.toBeInTheDocument();
    await expect
      .element(screen.getByTestId("day-2026-11-27").getByText("Nora Mills"))
      .toBeVisible();
  });

  it("the overdue list shows a past item", async () => {
    const screen = await draw();
    const overdue = screen.getByTestId("calendar-overdue");
    await expect.element(overdue.getByText("Cy Park")).toBeVisible();
    await expect
      .element(overdue.getByText("Call the clinic back"))
      .toBeVisible();
    expect(overdue.element().textContent).not.toMatch(/Nora Mills/);
  });

  it("a follow-up with no date is listed under no date", async () => {
    const screen = await draw();
    const noDate = screen.getByTestId("calendar-no-date");
    await expect.element(noDate.getByText("Dee Ruiz")).toBeVisible();
    await expect.element(noDate.getByText("Ask for a time")).toBeVisible();
  });

  it("many items on one day show +N more", async () => {
    const crowd = Array.from({ length: 6 }, (_, i) =>
      buildFollowUp({
        id: 100 + i,
        contact_id: 3,
        contact_note_id: 200 + i,
        next_step: `Step ${i + 1}`,
        next_due: "2026-11-30",
      }),
    );
    const screen = await render(
      <StoryWrapper data={hubData({ ...data, follow_ups: crowd })}>
        <Calendar today={today} />
      </StoryWrapper>,
    );
    await expect
      .element(screen.getByTestId("day-2026-11-30").getByText("+3 more"))
      .toBeVisible();
  });

  it("the week view shows only the week of today", async () => {
    const screen = await draw();
    await screen.getByRole("button", { name: "Week" }).click();
    await expect.element(screen.getByTestId("day-2026-11-27")).toBeVisible();
    await expect
      .element(screen.getByTestId("day-2026-11-10"))
      .not.toBeInTheDocument();
  });
});
