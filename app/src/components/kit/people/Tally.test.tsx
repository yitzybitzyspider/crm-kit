import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";

import { Tally } from "./Tally";
import { buildTallyRow, hubData } from "./testData";

const rowOf = (container: HTMLElement, category: string) =>
  container.querySelector(`[data-testid="tally-row"][data-category="${category}"]`);

const cells = (row: Element | null) =>
  Array.from(row?.querySelectorAll("td") ?? []).map((cell) => cell.textContent);

describe("Tally", () => {
  it("issue 97: renders the counts of each category from the view", async () => {
    const screen = await render(
      <StoryWrapper
        data={hubData({
          category_tally: [
            buildTallyRow(1, "customer", 1, 0, 4),
            buildTallyRow(2, "user", 0, 1, 2),
            buildTallyRow(9, "uncategorized", 0, 0, 3),
            buildTallyRow(10, "total", 1, 1, 9),
          ],
        })}
      >
        <Tally />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("Customer")).toBeVisible();
    await expect.poll(() => cells(rowOf(screen.container, "customer"))).toEqual(["1", "0", "4"]);
    await expect.poll(() => cells(rowOf(screen.container, "user"))).toEqual(["0", "1", "2"]);
    await expect.poll(() => cells(rowOf(screen.container, "uncategorized"))).toEqual(["0", "0", "3"]);
    await expect.poll(() => cells(rowOf(screen.container, "total"))).toEqual(["1", "1", "9"]);
  });

  it("issue 97: a category with nobody is shown as 0, not hidden", async () => {
    const screen = await render(
      <StoryWrapper data={hubData({ category_tally: [] })}>
        <Tally />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("Buyer")).toBeVisible();
    const rows = screen.container.querySelectorAll('[data-testid="tally-row"]');
    expect(Array.from(rows).map((row) => row.getAttribute("data-category"))).toEqual([
      "customer",
      "user",
      "buyer",
      "partner",
      "expert",
      "other",
      "uncategorized",
      "total",
    ]);
    await expect.poll(() => cells(rowOf(screen.container, "buyer"))).toEqual(["0", "0", "0"]);
    await expect.poll(() => cells(rowOf(screen.container, "total"))).toEqual(["0", "0", "0"]);
  });
});
