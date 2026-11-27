// Issue 95: the library screens. Test cases 3 and 4 of the issue: markdown is
// drawn sanitized, a script never runs, a mermaid block becomes a picture and
// a broken one falls back to its code; the hypotheses tab reads the real
// hypotheses/hypotheses.md into 33 rows and joins the interviews by stance.
import { render } from "vitest-browser-react";
import { commands, page } from "vitest/browser";
import { StoryWrapper } from "@/test/StoryWrapper";

import { buildPerson, hubData, type HubData } from "../people/testData";
import { buildHypothesis, buildInterview } from "../interviews/testData";
import { hub } from "../index";
import { parseHypotheses } from "./hypotheses";
import { LibraryMarkdown } from "./LibraryMarkdown";
import { renderLibraryMarkdown } from "./markdown";
import type { LibraryPage } from "./types";

declare module "vitest/browser" {
  interface BrowserCommands {
    readRepoFile: (path: string) => Promise<string>;
  }
}

declare global {
  interface Window {
    __libraryXss?: number;
  }
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

const libraryPage = (overrides: Partial<LibraryPage>): LibraryPage => ({
  path: "research/sepsis-ed.md",
  section: "research",
  title: "Sepsis in the ED",
  body: "# Sepsis in the ED\n\nWords about sepsis.",
  commit: SHA,
  updated_at: "2026-11-25T10:00:00Z",
  ...overrides,
});

const SMALL_HYPOTHESES = [
  "# Hypotheses",
  "",
  "Intro words before the table.",
  "",
  "| # | Hypothesis | Status | Evidence so far |",
  "|---|---|---|---|",
  "| H1 | Old idea, now dropped. | dropped | Covered by H4. |",
  "| H4 | Patients deteriorate in the waiting room. | open | |",
  "| H5 | It costs the hospital **money**. | supported | |",
  "| H7 | Patients dislike it. | contradicts-ish | |",
  "| H8 | Patients feel unseen. | open | |",
  "",
  "Status is one of: `open`, `supported`, `contradicted`, `dropped`.",
].join("\n");

const people = [
  buildPerson({ id: 1, first_name: "Ada", last_name: "Lovelace" }),
  buildPerson({ id: 2, first_name: "Alan", last_name: "Turing" }),
];

const libraryData = (pages: LibraryPage[], extra: HubData = {}) =>
  hubData({
    contacts: people,
    interviews: [
      buildInterview({
        id: 11,
        contact_id: 1,
        date: "2026-11-02",
        title: "Interview: Ada",
      }),
      buildInterview({
        id: 12,
        contact_id: 2,
        date: "2026-11-09",
        title: "Interview: Alan",
      }),
    ],
    interview_hypotheses: [
      buildHypothesis({
        interview_id: 11,
        hypothesis: "H4",
        stance: "supports",
        why: "She saw it twice",
      }),
      buildHypothesis({
        interview_id: 12,
        hypothesis: "H4",
        stance: "contradicts",
        why: "Never in his ER",
      }),
      buildHypothesis({
        interview_id: 12,
        hypothesis: "H8",
        stance: "unclear",
        why: "Hard to say",
      }),
      buildHypothesis({
        interview_id: 11,
        hypothesis: "H99",
        stance: "supports",
        why: "A number not in the file",
      }),
    ],
    library_pages: pages,
    ...extra,
  });

const Library = ({
  path,
  data,
}: {
  path: string;
  data: ReturnType<typeof hubData>;
}) => (
  <StoryWrapper data={data} initialEntries={[path]}>
    {null}
  </StoryWrapper>
);

describe("the library's markdown", () => {
  beforeEach(() => {
    page.viewport(1600, 900);
    delete window.__libraryXss;
  });

  it("case 3: a script tag and an event handler are shown as text and never run", async () => {
    const body = [
      "# Notes",
      "",
      "<script>window.__libraryXss = 1</script>",
      "",
      'Inline <img src="x" onerror="window.__libraryXss = 2"> here.',
      "",
      "[a link](javascript:window.__libraryXss=3)",
      "",
      "![a picture](https://elsewhere.example/pixel.png)",
    ].join("\n");
    const screen = await render(
      <LibraryMarkdown body={body} path="research/notes.md" />,
    );

    await expect
      .element(screen.getByRole("heading", { name: "Notes" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("<script>window.__libraryXss = 1</script>"))
      .toBeVisible();
    const box = screen.container;
    expect(box.querySelector("script")).toBeNull();
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelector("[onerror]")).toBeNull();
    expect(box.innerHTML).not.toMatch(/javascript:/i);
    // a picture is a link to it, never loaded from elsewhere
    expect(
      box.querySelector('a[href="https://elsewhere.example/pixel.png"]'),
    ).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(window.__libraryXss).toBeUndefined();
  });

  it("case 3: raw HTML blocks and inline tags are text, never elements", () => {
    const html = renderLibraryMarkdown(
      "<iframe src=x></iframe>\n\n<b onclick=alert(1)>bold</b>",
      "research/a.md",
    );
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(box.querySelector("iframe, b, [onclick]")).toBeNull();
    expect(box.textContent).toContain("<iframe src=x></iframe>");
    expect(box.textContent).toContain("<b onclick=alert(1)>bold</b>");
  });

  it("case 3: a mermaid block is drawn as a picture, the real ecosystem diagram included", async () => {
    const body = await commands.readRepoFile("diagrams/ecosystem.md");
    const screen = await render(
      <LibraryMarkdown body={body} path="diagrams/ecosystem.md" />,
    );

    await expect
      .poll(
        () => screen.container.querySelectorAll("[data-mermaid] svg").length,
        { timeout: 15000 },
      )
      .toBe(2);
    expect(screen.container.textContent).toContain("Waiting patients");
    expect(screen.container.querySelector("[data-mermaid-error]")).toBeNull();
  });

  it("case 3: a mermaid label cannot run a script", async () => {
    const body = [
      "```mermaid",
      "flowchart LR",
      '  A["<img src=x onerror=window.__libraryXss=4>"] --> B[fine]',
      "```",
    ].join("\n");
    const screen = await render(
      <LibraryMarkdown body={body} path="diagrams/x.md" />,
    );

    await expect
      .poll(
        () => screen.container.querySelectorAll("[data-mermaid] svg").length,
        { timeout: 15000 },
      )
      .toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(window.__libraryXss).toBeUndefined();
    expect(screen.container.querySelector("[onerror]")).toBeNull();
  });

  it("case 3: a broken mermaid block shows its code and a one line error, and the page still loads", async () => {
    const body = [
      "# A page with a broken diagram",
      "",
      "```mermaid",
      "flowchart LR",
      "  A -->|missing end",
      "```",
      "",
      "Words after the diagram.",
    ].join("\n");
    const screen = await render(
      <LibraryMarkdown body={body} path="diagrams/broken.md" />,
    );

    await expect
      .element(screen.getByText("Words after the diagram."))
      .toBeVisible();
    await expect
      .element(screen.getByText(/This diagram could not be drawn/))
      .toBeVisible();
    const error = screen.container.querySelector("[data-mermaid-error]");
    expect(error?.textContent?.split("\n").length).toBe(1);
    expect(screen.container.textContent).toContain("A -->|missing end");
    expect(screen.container.querySelector("[data-mermaid] svg")).toBeNull();
  });

  it("issue 95 item 7: a hypothesis number in a page links to its row", () => {
    const html = renderLibraryMarkdown(
      "Ties to [H8] and H12, not PH8 or `H9`.",
      "diagrams/x.md",
    );
    const box = document.createElement("div");
    box.innerHTML = html;
    const links = [...box.querySelectorAll("a[data-hypothesis]")].map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["H8", "#/library/hypotheses?h=H8"],
      ["H12", "#/library/hypotheses?h=H12"],
    ]);
  });
});

describe("the hypotheses tab", () => {
  beforeEach(() => {
    page.viewport(1600, 900);
  });

  it("case 4: the real hypotheses/hypotheses.md reads as one row per hypothesis, with statuses", async () => {
    // The file is content the team edits straight on main (33 rows when the
    // issue was written, 47 a day later), so the count is taken from the
    // file itself, independently of the parser.
    const body = await commands.readRepoFile("hypotheses/hypotheses.md");
    const lines = body
      .split("\n")
      .filter((line) => /^\|\s*H\d+\s*\|/.test(line));
    const { rows } = parseHypotheses(body);

    expect(lines.length).toBeGreaterThanOrEqual(33);
    expect(rows.length).toBe(lines.length);
    const numbers = rows.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(rows.every((r) => r.text.length > 0)).toBe(true);
    expect(
      rows.every((r) =>
        ["open", "supported", "contradicted", "dropped"].includes(r.status),
      ),
    ).toBe(true);
    expect(rows.find((r) => r.id === "H4")?.text).toMatch(/waiting room/i);
  });

  it("case 4: a table as the issue knew it parses to its rows and statuses, the dropped ones included", () => {
    const { before, rows, after } = parseHypotheses(SMALL_HYPOTHESES);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["H1", "dropped"],
      ["H4", "open"],
      ["H5", "supported"],
      ["H7", "contradicts-ish"],
      ["H8", "open"],
    ]);
    expect(rows[0].evidence).toBe("Covered by H4.");
    expect(rows[2].text).toBe("It costs the hospital **money**.");
    expect(before).toMatch(/^# Hypotheses/);
    expect(after).toMatch(/^Status is one of/);
  });

  it("case 4: each row shows its interviews by stance, dropped ones last and folded, unknown numbers listed", async () => {
    const data = libraryData([
      libraryPage({
        path: "hypotheses/hypotheses.md",
        section: "hypotheses",
        title: "Hypotheses",
        body: SMALL_HYPOTHESES,
      }),
    ]);
    const screen = await render(
      <Library path="/library/hypotheses" data={data} />,
    );

    const h4 = screen.getByTestId("hypothesis-H4");
    await expect
      .element(h4.getByText("Patients deteriorate in the waiting room."))
      .toBeVisible();
    await expect.element(h4.getByText("1 supports")).toBeVisible();
    await expect.element(h4.getByText("1 contradicts")).toBeVisible();
    await expect.element(h4.getByText("She saw it twice")).toBeVisible();
    await expect
      .element(h4.getByRole("link", { name: /Ada Lovelace/ }))
      .toHaveAttribute("href", "/interviews/11/show");
    await expect.element(h4.getByText("2026-11-09")).toBeVisible();
    await expect
      .element(
        screen.getByTestId("hypothesis-H5").getByText("No interview yet."),
      )
      .toBeVisible();
    await expect
      .element(screen.getByTestId("hypothesis-H5").getByText("supported"))
      .toBeVisible();
    // markdown in a cell is drawn, not shown as asterisks
    expect(
      screen.container.querySelector('[data-testid="hypothesis-H5"] strong')
        ?.textContent,
    ).toBe("money");
    // a status the file does not know is still shown, as written
    await expect
      .element(screen.getByTestId("hypothesis-H7").getByText("contradicts-ish"))
      .toBeVisible();

    // open ones in number order; the dropped one at the bottom, folded
    const open = [
      ...screen.container.querySelectorAll('[data-testid^="hypothesis-H"]'),
    ]
      .filter((row) => !row.closest("details"))
      .map((row) => row.getAttribute("data-testid"));
    expect(open).toEqual([
      "hypothesis-H4",
      "hypothesis-H5",
      "hypothesis-H7",
      "hypothesis-H8",
    ]);
    const dropped = screen.container.querySelector("details");
    expect(dropped?.open).toBe(false);
    expect(
      dropped?.querySelector('[data-testid="hypothesis-H1"]'),
    ).not.toBeNull();
    expect(dropped?.querySelector("summary")?.textContent).toBe("Dropped (1)");

    const unknown = screen.getByTestId("unknown-hypotheses");
    await expect.element(unknown.getByText("H99")).toBeVisible();
    await expect
      .element(unknown.getByText("A number not in the file"))
      .toBeVisible();

    // the words around the table are shown too
    await expect
      .element(screen.getByText("Intro words before the table."))
      .toBeVisible();
  });

  it("issue 95 item 7: a hypothesis link elsewhere opens the hypotheses tab at that row", async () => {
    const data = libraryData([
      libraryPage({
        path: "hypotheses/hypotheses.md",
        section: "hypotheses",
        title: "Hypotheses",
        body: SMALL_HYPOTHESES,
      }),
      libraryPage({
        path: "diagrams/ecosystem.md",
        section: "diagrams",
        title: "Ecosystem",
        body: "Feels unseen [H8].",
      }),
    ]);
    const screen = await render(
      <Library path="/library/diagrams" data={data} />,
    );

    await screen.getByRole("link", { name: "H8" }).click();
    const row = screen.getByTestId("hypothesis-H8");
    await expect.element(row).toBeVisible();
    await expect.element(row).toHaveAttribute("data-highlighted", "true");
  });
});

describe("the library pages", () => {
  beforeEach(() => {
    page.viewport(1600, 900);
  });

  it("issue 95: Library is in the menu with four tabs, and a page says its commit", async () => {
    expect(hub.menu.map((entry) => entry.label)).toContain("Library");
    const data = libraryData([
      libraryPage({}),
      libraryPage({
        path: "research/zeta.md",
        title: "Zeta paper",
        body: "Zeta words.",
      }),
    ]);
    const screen = await render(
      <Library path="/library/research" data={data} />,
    );

    for (const tab of ["Hypotheses", "Research", "Competition", "Diagrams"]) {
      await expect
        .element(screen.getByRole("link", { name: tab, exact: true }))
        .toBeVisible();
    }
    // the first page opens; the others are a click away
    await expect.element(screen.getByText("Words about sepsis.")).toBeVisible();
    const commit = screen.getByRole("link", { name: "from commit 0123456" });
    await expect
      .element(commit)
      .toHaveAttribute(
        "href",
        `https://github.com/your-org/crm-kit/blob/${SHA}/research/sepsis-ed.md`,
      );
    await screen.getByRole("link", { name: "Zeta paper" }).click();
    await expect.element(screen.getByText("Zeta words.")).toBeVisible();
  });

  it("issue 95: an empty section says what to do", async () => {
    const screen = await render(
      <Library path="/library/research" data={libraryData([])} />,
    );
    await expect
      .element(
        screen.getByText(
          "No research yet. Tell Claude: add this paper to research.",
        ),
      )
      .toBeVisible();
    await screen
      .getByRole("link", { name: "Competition", exact: true })
      .click();
    await expect
      .element(screen.getByText(/^No competition notes yet\. Tell Claude:/))
      .toBeVisible();
    await screen.getByRole("link", { name: "Hypotheses", exact: true }).click();
    await expect
      .element(screen.getByText(/^No hypotheses yet\. Tell Claude:/))
      .toBeVisible();
  });

  it("issue 95: a page from the database with a script tag does not run it", async () => {
    const data = libraryData([
      libraryPage({
        body: "# Bad\n\n<script>window.__libraryXss = 5</script>\n\nAfter.",
      }),
    ]);
    const screen = await render(
      <Library path="/library/research" data={data} />,
    );
    await expect.element(screen.getByText("After.")).toBeVisible();
    await expect
      .element(screen.getByText("<script>window.__libraryXss = 5</script>"))
      .toBeVisible();
    expect(screen.container.querySelector("script")).toBeNull();
    expect(window.__libraryXss).toBeUndefined();
  });
});
