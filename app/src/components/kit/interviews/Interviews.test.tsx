import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { StoryWrapper } from "@/test/StoryWrapper";

import { buildPerson, hubData, type HubData } from "../people/testData";
import {
  buildHypothesis,
  buildInterview,
  buildTranscript,
  readColumn,
  watchedProvider,
} from "./testData";
import { TRANSCRIPTS } from "./types";

const person = buildPerson({ id: 1, person_code: "DD-07" });

const transcript = [
  "  Speaker A: two leading spaces",
  "",
  "",
  "<b>x</b>",
  "# not a heading",
  "<script>window.__hubTranscriptXss = 1</script>",
  '<img src="x" onerror="window.__hubTranscriptXss = 2">',
  "TRANSCRIPT-ONLY-WORDS and a trailing space ",
].join("\n");

const overview = [
  "## Key takeaways",
  "",
  "She waits **forty minutes** on a bad day.",
  "",
  "<script>window.__hubOverviewXss = 1</script>",
  '<img src="https://elsewhere.example/pixel.png" onerror="window.__hubOverviewXss = 2">',
  "![a picture](https://elsewhere.example/pixel.png)",
].join("\n");

const interviews = [
  buildInterview({ id: 1, date: "2026-10-01", title: "Interview: oldest" }),
  buildInterview({
    id: 2,
    date: "2026-11-09",
    title: "Interview: newest",
    interviewer_id: 2,
    source: "paste",
    overview,
  }),
  buildInterview({ id: 3, date: "2026-10-20", title: "Interview: middle" }),
];

const data: HubData = {
  contacts: [person],
  interviews,
  interview_hypotheses: [
    buildHypothesis({ interview_id: 2, hypothesis: "H2" }),
    buildHypothesis({
      interview_id: 2,
      hypothesis: "H5",
      stance: "contradicts",
      why: "Nobody asked her",
    }),
  ],
  interview_transcripts: [
    buildTranscript(1, "one ".repeat(300)),
    buildTranscript(2, transcript),
    buildTranscript(3, "three ".repeat(300)),
  ],
};

const lines = (container: Element, testId: string) =>
  [...container.querySelectorAll(`[data-testid="${testId}"]`)].map(
    (line) => line.textContent ?? "",
  );

const forbiddenControls = () =>
  [...document.querySelectorAll("button, a, [role=menuitem]")]
    .map(
      (control) =>
        `${control.textContent ?? ""} ${control.getAttribute("aria-label") ?? ""}`,
    )
    .filter((label) => /delete|remove/i.test(label));

describe("interviews", () => {
  beforeEach(() => {
    page.viewport(1280, 800);
    delete (window as any).__hubTranscriptXss;
    delete (window as any).__hubOverviewXss;
  });

  it("case 1: PersonInterviews lists the interviews newest first with date, interviewer and title", async () => {
    const watched = watchedProvider({
      ...data,
      interviews: interviews.filter((interview) => interview.id !== 3),
    });
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/contacts/1/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    await expect
      .poll(() => lines(screen.container, "interview-line"))
      .toHaveLength(2);
    const [first, second] = lines(screen.container, "interview-line");
    expect(first).toContain("2026-11-09");
    expect(first).toContain("bravo");
    expect(first).toContain("Interview: newest");
    expect(second).toContain("2026-10-01");
    expect(second).toContain("delta");
    expect(second).toContain("Interview: oldest");
    await expect
      .element(screen.getByRole("link", { name: "Interview: newest" }))
      .toHaveAttribute("href", "/interviews/2/show");
    // the section stands above the timeline of touches
    const section = screen.container.querySelector(
      '[data-testid="person-interviews"]',
    )!;
    const noteForm = screen.container.querySelector("textarea")!;
    expect(
      section.compareDocumentPosition(noteForm) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the person page asks for no transcript
    expect(watched.columnsReadFrom(TRANSCRIPTS)).toEqual([]);
    expect(screen.container.textContent).not.toContain("TRANSCRIPT-ONLY-WORDS");
  });

  it("case 1: a person with no interview shows one quiet line", async () => {
    const screen = await render(
      <StoryWrapper
        data={hubData({ contacts: [person] })}
        initialEntries={["/contacts/1/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    await expect.element(screen.getByText("No interview yet.")).toBeVisible();
    expect(lines(screen.container, "interview-line")).toEqual([]);
  });

  it("issue 98: two linked interviews render as one session with two tabs", async () => {
    // ids of its own: the query cache outlives a test
    const casey = buildPerson({ id: 9, person_code: "DD-09" });
    const session: HubData = {
      contacts: [casey],
      interviews: [
        buildInterview({
          id: 92,
          contact_id: 9,
          date: "2026-11-25",
          kind: "notes",
          source: "paste",
          title: "Notes: Casey",
          overview: "NOTES-OVERVIEW",
          session_of: null,
        }),
        buildInterview({
          id: 93,
          contact_id: 9,
          date: "2026-11-25",
          kind: "transcript",
          title: "Granola: Casey",
          overview: "TRANSCRIPT-OVERVIEW",
          session_of: 92,
        }),
      ],
      interview_hypotheses: [],
      interview_transcripts: [
        buildTranscript(92, "notes ".repeat(40)),
        buildTranscript(93, "words ".repeat(300)),
      ],
    };
    const onPerson = await render(
      <StoryWrapper
        data={hubData(session)}
        initialEntries={["/contacts/9/show"]}
      >
        {null}
      </StoryWrapper>,
    );
    await expect
      .poll(() => lines(onPerson.container, "interview-line"))
      .toHaveLength(1);
    const [line] = lines(onPerson.container, "interview-line");
    expect(line).toContain("Notes: Casey");
    expect(line).toContain("Notes");
    expect(line).toContain("Transcript");

    const screen = await render(
      <StoryWrapper
        data={hubData(session)}
        initialEntries={["/interviews/93/show"]}
      >
        {null}
      </StoryWrapper>,
    );
    await expect
      .element(screen.getByRole("tab", { name: "Notes" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("tab", { name: "Transcript" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab").all()).toHaveLength(2);
    await expect.element(screen.getByText("TRANSCRIPT-OVERVIEW")).toBeVisible();
    await screen.getByRole("tab", { name: "Notes" }).click();
    await expect.element(screen.getByText("NOTES-OVERVIEW")).toBeVisible();
  });

  it("case 2: InterviewPage draws the interview and asks for no transcript text", async () => {
    const watched = watchedProvider(data);
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/interviews/2/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByRole("heading", { name: "Interview: newest" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /Ada Lovelace/ }))
      .toHaveAttribute("href", "/contacts/1/show");
    const facts = () =>
      screen.container.querySelector('[data-testid="interview-facts"]')
        ?.textContent ?? "";
    await expect.poll(facts).toContain("DD-07");
    expect(facts()).toContain("2026-11-09");
    await expect.poll(facts).toContain("bravo");
    expect(facts()).toContain("paste");
    // the overview is plain text, exactly as written, line breaks kept
    const drawn = screen.container.querySelector(
      '[data-testid="interview-overview"]',
    )!;
    expect(drawn.textContent).toBe(overview);
    expect(drawn.children.length).toBe(0);
    expect(getComputedStyle(drawn).whiteSpace).toMatch(/^pre/);
    expect((window as any).__hubOverviewXss).toBeUndefined();
    // the hypotheses, each with stance and why
    await expect
      .poll(() => lines(screen.container, "interview-hypothesis"))
      .toHaveLength(2);
    const [h2, h5] = lines(screen.container, "interview-hypothesis");
    expect(h2).toContain("H2");
    expect(h2).toContain("supports");
    expect(h2).toContain("She described the same wait");
    expect(h5).toContain("H5");
    expect(h5).toContain("contradicts");
    expect(h5).toContain("Nobody asked her");
    // the size is shown, the text is not, and the text was not asked for
    await expect
      .poll(
        () =>
          screen.container.querySelector('[data-testid="transcript-size"]')
            ?.textContent,
      )
      .toContain(`${transcript.length.toLocaleString("en-US")} characters`);
    await expect
      .element(screen.getByRole("button", { name: "Show transcript" }))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain("TRANSCRIPT-ONLY-WORDS");
    expect(
      screen.container.querySelector('[data-testid="transcript"]'),
    ).toBeNull();
    expect(readColumn(watched.columnsReadFrom(TRANSCRIPTS), "body")).toBe(
      false,
    );
  });

  const kindData: HubData = {
    contacts: [person],
    interviews: [
      buildInterview({ id: 11, title: "Interview: from a transcript" }),
      buildInterview({ id: 12, title: "Interview: from notes", kind: "notes" }),
      buildInterview({
        id: 13,
        title: "Interview: from a debrief",
        kind: "debrief",
      }),
    ],
    interview_hypotheses: [],
    interview_transcripts: [
      buildTranscript(11, "eleven ".repeat(200)),
      buildTranscript(12, "twelve ".repeat(20)),
      buildTranscript(13, "thirteen ".repeat(20)),
    ],
  };

  it.each([
    [11, "Transcript", "Interview: from a transcript"],
    [12, "Notes", "Interview: from notes"],
    [13, "Debrief", "Interview: from a debrief"],
  ] as const)(
    "issue 83: interview %i shows the kind as a small label, %s",
    async (id, label, title) => {
      const watched = watchedProvider(kindData);
      const screen = await render(
        <StoryWrapper
          dataProvider={watched.dataProvider}
          initialEntries={[`/interviews/${id}/show`]}
        >
          {null}
        </StoryWrapper>,
      );
      await expect
        .element(screen.getByRole("heading", { name: title }))
        .toBeVisible();
      await expect
        .poll(
          () =>
            screen.container.querySelector('[data-testid="interview-kind"]')
              ?.textContent,
        )
        .toBe(label);
    },
  );

  it("issue 24 reopened: a hostile overview is shown as literal text, nothing runs or loads", async () => {
    const hostile = [
      "<script>window.__hubOverviewXss = 1</script>",
      '<img src="https://elsewhere.example/pixel.png" onerror="window.__hubOverviewXss = 2">',
      "[click me](javascript:window.__hubOverviewXss=3)",
      '<a href="javascript:window.__hubOverviewXss=4">raw link</a>',
      '<b>bold?</b> <iframe src="https://elsewhere.example"></iframe>',
      "",
      "  # a heading? no",
      "**not bold** and a line break above",
    ].join("\n");
    const watched = watchedProvider({
      ...data,
      interviews: [buildInterview({ id: 2, overview: hostile })],
    });
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/interviews/2/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    await expect
      .element(screen.getByTestId("interview-overview"))
      .toBeVisible();
    const drawn = screen.container.querySelector(
      '[data-testid="interview-overview"]',
    ) as HTMLElement;
    expect(drawn.textContent).toBe(hostile);
    expect(drawn.children.length).toBe(0);
    expect(
      drawn.querySelector("script, img, a, iframe, b, h1, strong"),
    ).toBeNull();
    // the blank line and the two leading spaces are kept on screen
    expect(drawn.innerText).toContain("\n\n  # a heading? no");
    expect(screen.container.querySelector('a[href^="javascript"]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((window as any).__hubOverviewXss).toBeUndefined();
  });

  it("case 3: Show transcript makes one request and shows the text exactly", async () => {
    const watched = watchedProvider(data);
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/interviews/2/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    await screen.getByRole("button", { name: "Show transcript" }).click();
    await expect.element(screen.getByTestId("transcript")).toBeVisible();
    const block = screen.container.querySelector('[data-testid="transcript"]')!;
    expect(block.textContent).toBe(transcript);
    // text, not elements: the line <b>x</b> is four characters and a tag name
    expect(block.children.length).toBe(0);
    expect((window as any).__hubTranscriptXss).toBeUndefined();
    expect(getComputedStyle(block).whiteSpace).toMatch(/^pre/);
    expect(getComputedStyle(block).overflowY).toMatch(/auto|scroll/);
    const bodyReads = watched
      .columnsReadFrom(TRANSCRIPTS)
      .filter((columns) => !columns || columns.includes("body"));
    expect(bodyReads).toHaveLength(1);
    // only this interview's text was asked for
    const [, params] = watched.getList.mock.calls.find(
      ([resource, p]) =>
        resource === TRANSCRIPTS && (p as any).meta.columns.includes("body"),
    )!;
    expect((params as any).filter).toEqual({ interview_id: 2 });
  });

  it("edge: a transcript of 500,000 characters is shown whole", async () => {
    const long = "word ".repeat(100000);
    const watched = watchedProvider({
      ...data,
      interview_transcripts: [buildTranscript(2, long)],
    });
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/interviews/2/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    const button = screen.getByRole("button", { name: "Show transcript" });
    await expect.element(button).toBeVisible();
    const started = performance.now();
    await button.click();
    await expect.element(screen.getByTestId("transcript")).toBeVisible();
    const took = Math.round(performance.now() - started);
    const block = screen.container.querySelector('[data-testid="transcript"]')!;
    expect(block.textContent!.length).toBe(500000);
    expect(block.textContent).toBe(long);
    console.info(`HUB 500,000 characters shown in ${took} ms`);
    expect(took).toBeLessThan(5000);
    // the page still answers: the button that folds it away works
    await screen.getByRole("button", { name: "Hide transcript" }).click();
    await expect
      .element(screen.getByTestId("transcript"))
      .not.toBeInTheDocument();
  });

  it("case 4: nothing deletes or removes; Edit overview calls update_overview with via ui", async () => {
    const watched = watchedProvider(data, {
      update_overview: () => ({ interview_id: 2, hypotheses: 2 }),
    });
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/interviews/2/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    await screen.getByRole("button", { name: "Show transcript" }).click();
    await expect.element(screen.getByTestId("transcript")).toBeVisible();
    expect(forbiddenControls()).toEqual([]);

    await screen.getByRole("button", { name: "Edit overview" }).click();
    expect(forbiddenControls()).toEqual([]);
    await screen.getByLabelText("Overview").fill("A corrected overview.");
    await screen.getByRole("button", { name: "Save overview" }).click();

    await expect.poll(() => watched.callsOf("update_overview")).toHaveLength(1);
    expect(watched.callsOf("update_overview")[0]).toEqual({
      interview_id: 2,
      overview: "A corrected overview.",
      hypotheses: [
        {
          hypothesis: "H2",
          stance: "supports",
          why: "She described the same wait",
        },
        { hypothesis: "H5", stance: "contradicts", why: "Nobody asked her" },
      ],
      via: "ui",
    });
    // no other action was called, and nothing was written through the tables
    expect(watched.hubAction.mock.calls.map(([name]) => name)).toEqual([
      "update_overview",
    ]);
  });

  it("case 4: a rejected save shows the sentence and keeps the old overview", async () => {
    const sentence =
      'this quote in the overview is not word for word in the transcript: "she never said this at all"';
    const watched = watchedProvider(data, {
      update_overview: () => {
        throw new Error(sentence);
      },
    });
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/interviews/2/show"]}
      >
        {null}
      </StoryWrapper>,
    );

    await screen.getByRole("button", { name: "Edit overview" }).click();
    await screen
      .getByLabelText("Overview")
      .fill('She said "she never said this at all".');
    await screen.getByRole("button", { name: "Save overview" }).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(sentence);
    // what was typed is still in the form
    await expect
      .element(screen.getByLabelText("Overview"))
      .toHaveValue('She said "she never said this at all".');
    await screen.getByRole("button", { name: "Cancel" }).click();
    await expect.element(screen.getByText(/forty minutes/)).toBeVisible();
    expect(screen.container.textContent).not.toContain("she never said this");
  });

  it("case 5: InterviewList lists three interviews newest first and asks for no transcript", async () => {
    const watched = watchedProvider(data);
    const screen = await render(
      <StoryWrapper
        dataProvider={watched.dataProvider}
        initialEntries={["/interviews"]}
      >
        {null}
      </StoryWrapper>,
    );

    await expect
      .poll(() => lines(screen.container, "interview-row"))
      .toHaveLength(3);
    await expect
      .poll(() => lines(screen.container, "interview-row")[0])
      .toContain("Ada Lovelace");
    const rows = lines(screen.container, "interview-row");
    expect(rows[0]).toContain("2026-11-09");
    expect(rows[0]).toContain("Interview: newest");
    expect(rows[0]).toContain("bravo");
    expect(rows[0]).toContain("DD-07");
    expect(rows[1]).toContain("2026-10-20");
    expect(rows[2]).toContain("2026-10-01");
    expect(watched.columnsReadFrom(TRANSCRIPTS)).toEqual([]);
    // the list does not load the overviews either
    expect(readColumn(watched.columnsReadFrom("interviews"), "overview")).toBe(
      false,
    );
    expect(screen.container.textContent).not.toContain("TRANSCRIPT-ONLY-WORDS");
  });
});
