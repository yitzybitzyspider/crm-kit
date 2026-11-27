import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";

import { PersonCardContent } from "./PersonCard";
import { buildFollowUp, buildPerson, hubData } from "./testData";

describe("PersonCard", () => {
  it("case 3: shows code, name, role, organization, owner, and the next step with its due date", async () => {
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <PersonCardContent
          person={buildPerson({
            person_code: "DD-07",
            title: "Charge nurse",
            company_name: "Mercy General",
          })}
          ownerHandle="delta"
          followUp={buildFollowUp({
            next_step: "Send the consent form",
            next_due: "2026-12-01",
          })}
        />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("DD-07")).toBeVisible();
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect.element(screen.getByText(/Charge nurse/)).toBeVisible();
    await expect.element(screen.getByText(/Mercy General/)).toBeVisible();
    await expect
      .element(screen.getByText("delta", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Send the consent form"))
      .toBeVisible();
    await expect.element(screen.getByText(/2026-12-01/)).toBeVisible();
  });

  it("case 3: with no next step shows none", async () => {
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <PersonCardContent person={buildPerson()} ownerHandle="delta" />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("DD-01")).toBeVisible();
    expect(
      screen.container.querySelector('[data-testid="person-card-next-step"]'),
    ).toBeNull();
    expect(screen.container.textContent).not.toMatch(/next/i);
  });

  it("case 3: a 200 character name is cut with an ellipsis and does not widen the column", async () => {
    const longName = "Wolfeschlegelsteinhausenbergerdorff"
      .repeat(6)
      .slice(0, 199);
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <div data-testid="column" style={{ width: 220 }}>
          <PersonCardContent
            person={buildPerson({ first_name: "A", last_name: longName })}
            ownerHandle="delta"
          />
        </div>
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("DD-01")).toBeVisible();
    const name = screen.container.querySelector(
      '[data-testid="person-card-name"]',
    ) as HTMLElement;
    expect(name.textContent).toHaveLength(201);
    expect(getComputedStyle(name).textOverflow).toBe("ellipsis");
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
    const column = screen.container.querySelector(
      '[data-testid="column"]',
    ) as HTMLElement;
    expect(column.scrollWidth).toBeLessThanOrEqual(220);
    const card = screen.container.querySelector(
      '[data-testid="person-card"]',
    ) as HTMLElement;
    expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(220);
  });

  it("a person with no role, no organization and no owner handle still draws", async () => {
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <PersonCardContent
          person={buildPerson({
            title: "",
            company_id: null,
            company_name: undefined,
          })}
        />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect.element(screen.getByText("DD-01")).toBeVisible();
  });

  it("a name holding HTML is shown as text and nothing runs", async () => {
    const screen = await render(
      <StoryWrapper data={hubData()}>
        <PersonCardContent
          person={buildPerson({
            first_name: '<img src=x onerror="window.__hubCardXss=1">',
            last_name: "<b>bold</b>",
          })}
        />
      </StoryWrapper>,
    );

    await expect.element(screen.getByText(/<b>bold<\/b>/)).toBeVisible();
    expect(screen.container.querySelector("b")).toBeNull();
    expect((window as any).__hubCardXss).toBeUndefined();
  });
});
