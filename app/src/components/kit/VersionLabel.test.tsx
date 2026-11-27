import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import Header from "@/components/atomic-crm/layout/Header";
import { StoryWrapper } from "@/test/StoryWrapper";

import { VersionLabel } from "./VersionLabel";

// Issue 89, test case 1: the label under the logo.
const SHA = "0123456789abcdef0123456789abcdef01234567";
const built = {
  sha: SHA,
  short: "0123456",
  built_at: "2026-11-24T19:30:00-08:00",
  pr: 89,
};

describe("the version under the logo", () => {
  beforeEach(() => {
    page.viewport(1280, 800);
  });

  it("shows v<date>.<sha7> and #NN, linked to the commit in a new tab", async () => {
    const screen = await render(<VersionLabel version={built} />);
    const link = screen.getByRole("link");
    await expect.element(link).toBeVisible();
    expect(
      [...link.element().querySelectorAll("[data-version-line]")].map(
        (line) => line.textContent,
      ),
    ).toEqual(["v2026.11.24.0123456", "#89"]);
    await expect
      .element(link)
      .toHaveAttribute(
        "href",
        `https://github.com/your-org/crm-kit/commit/${SHA}`,
      );
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect
      .element(link)
      .toHaveAttribute("title", expect.stringContaining(built.built_at));
  });

  it("has no second line when the commit has no pull request", async () => {
    const screen = await render(
      <VersionLabel version={{ ...built, pr: null }} />,
    );
    await expect.element(screen.getByRole("link")).toBeVisible();
    expect(screen.getByRole("link").element().textContent).toBe(
      "v2026.11.24.0123456",
    );
  });

  it("shows dev when no version was built in", async () => {
    const screen = await render(<VersionLabel version={null} />);
    await expect.element(screen.getByText("dev")).toBeVisible();
    expect(screen.container.querySelector("a")).toBeNull();
  });

  it("shows dev under test, where no build put a version in", async () => {
    const screen = await render(<VersionLabel />);
    await expect.element(screen.getByText("dev")).toBeVisible();
  });

  it("links nowhere when the build had no commit", async () => {
    const screen = await render(
      <VersionLabel
        version={{ ...built, sha: "unknown", short: "unknown", pr: null }}
      />,
    );
    await expect.element(screen.getByText("v2026.11.24.unknown")).toBeVisible();
    expect(screen.container.querySelector("a")).toBeNull();
  });

  it("sits in the header, under the logo", async () => {
    const screen = await render(
      <StoryWrapper>
        <Header />
      </StoryWrapper>,
    );
    const label = screen.getByTestId("hub-version");
    await expect.element(label).toHaveTextContent("dev");
    // The logo and "Hub" sit in one link; the label is the next line, left
    // aligned with it. Polled: the stylesheet and the images settle the layout.
    const under = () => {
      const logoLink = label.element().previousElementSibling!;
      const logo = logoLink.getBoundingClientRect();
      const box = label.element().getBoundingClientRect();
      return (
        logoLink.querySelector("img") !== null &&
        logo.height > 0 &&
        box.top >= logo.bottom - 1 &&
        Math.abs(box.left - logo.left) < 2
      );
    };
    await expect.poll(under).toBe(true);
  });

  it("stays one line a line on a phone, with no overflow", async () => {
    page.viewport(375, 667);
    const screen = await render(
      <div style={{ width: 90 }}>
        <VersionLabel version={built} />
      </div>,
    );
    const lines = [
      ...screen.container.querySelectorAll("[data-version-line]"),
    ] as HTMLElement[];
    expect(lines.map((line) => line.textContent)).toEqual([
      "v2026.11.24.0123456",
      "#89",
    ]);
    for (const line of lines) {
      expect(line.getClientRects().length).toBe(1);
      const height = parseFloat(getComputedStyle(line).lineHeight);
      expect(line.getBoundingClientRect().height).toBeLessThanOrEqual(
        height + 1,
      );
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
