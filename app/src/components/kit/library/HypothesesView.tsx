// The hypotheses tab (issue 95): the table of hypotheses/hypotheses.md as one
// row per hypothesis, and under each the interviews that touched it, from
// interview_hypotheses: person, date, stance and the one line why, each
// linking to the interview. Dropped ones are folded at the bottom. An
// interview tagged with a number the file does not have is listed under
// "Unknown hypotheses", so a typo is seen rather than lost.
import { useGetMany } from "ra-core";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useHubRows } from "../hubApi";
import { personName } from "../interviews/InterviewList";
import {
  HYPOTHESIS_COLUMNS,
  INTERVIEW_LINE_COLUMNS,
  sessionKey,
  interviewPath,
  stances,
  type Interview,
  type InterviewHypothesis,
} from "../interviews/types";
import type { Person } from "../people/types";
import { parseHypotheses, type HypothesisRow } from "./hypotheses";
import { LibraryMarkdown } from "./LibraryMarkdown";
import type { LibraryPage } from "./types";

type Evidence = {
  link: InterviewHypothesis;
  interview?: Interview;
  person?: Person;
};

const statusClass: Record<string, string> = {
  open: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  supported:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
  contradicted:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  dropped: "border-border bg-muted text-muted-foreground",
};

const stanceClass: Record<string, string> = {
  supports: "text-green-700 dark:text-green-300",
  contradicts: "text-red-700 dark:text-red-300",
  unclear: "text-muted-foreground",
};

export const HypothesesView = ({
  page,
  onNavigate,
}: {
  page: LibraryPage;
  onNavigate: (to: string) => void;
}) => {
  const parsed = useMemo(() => parseHypotheses(page.body), [page.body]);
  const { rows: links } = useHubRows<InterviewHypothesis>(
    "interview_hypotheses",
    {
      sort: { field: "hypothesis", order: "ASC" },
      columns: HYPOTHESIS_COLUMNS,
      perPage: 5000,
    },
  );
  const { rows: interviews } = useHubRows<Interview>("interviews", {
    sort: { field: "date", order: "DESC" },
    columns: INTERVIEW_LINE_COLUMNS,
    perPage: 5000,
  });
  const personIds = useMemo(
    () => [...new Set((interviews ?? []).map((i) => i.contact_id))],
    [interviews],
  );
  const { data: people } = useGetMany<Person>(
    "contacts",
    { ids: personIds },
    { enabled: personIds.length > 0 },
  );

  // every link with its interview and person, newest interview first
  const byHypothesis = useMemo(() => {
    const interviewById = new Map(
      (interviews ?? []).map((i) => [String(i.id), i]),
    );
    const personById = new Map((people ?? []).map((p) => [String(p.id), p]));
    const map = new Map<string, Evidence[]>();
    for (const link of links ?? []) {
      const interview = interviewById.get(String(link.interview_id));
      const person = interview
        ? personById.get(String(interview.contact_id))
        : undefined;
      const list = map.get(link.hypothesis) ?? [];
      list.push({ link, interview, person });
      map.set(link.hypothesis, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        (b.interview?.date ?? "").localeCompare(a.interview?.date ?? ""),
      );
    }
    return map;
  }, [links, interviews, people]);

  const [params] = useSearchParams();
  const target = params.get("h");
  useEffect(() => {
    if (!target) return;
    document
      .getElementById(`hypothesis-${target}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [target, parsed]);

  if (parsed.rows.length === 0) {
    return (
      <LibraryMarkdown
        body={page.body}
        path={page.path}
        onNavigate={onNavigate}
      />
    );
  }

  const known = new Set(parsed.rows.map((r) => r.id));
  const live = parsed.rows.filter((r) => r.status !== "dropped");
  const dropped = parsed.rows.filter((r) => r.status === "dropped");
  const unknown = [...byHypothesis.entries()]
    .filter(([id]) => !known.has(id))
    .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)));

  const row = (h: HypothesisRow) => (
    <HypothesisLine
      key={h.id}
      row={h}
      evidence={byHypothesis.get(h.id) ?? []}
      highlighted={target === h.id}
      path={page.path}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      {parsed.before ? (
        <LibraryMarkdown
          body={parsed.before}
          path={page.path}
          onNavigate={onNavigate}
        />
      ) : null}
      <div className="flex flex-col gap-2">{live.map(row)}</div>
      {dropped.length > 0 ? (
        <details
          open={dropped.some((h) => h.id === target) || undefined}
          className="rounded-md border p-3"
        >
          <summary className="cursor-pointer text-sm font-medium">
            Dropped ({dropped.length})
          </summary>
          <div className="mt-3 flex flex-col gap-2">{dropped.map(row)}</div>
        </details>
      ) : null}
      {unknown.length > 0 ? (
        <section
          data-testid="unknown-hypotheses"
          className="rounded-md border border-dashed p-3"
        >
          <h3 className="font-semibold">Unknown hypotheses</h3>
          <p className="text-sm text-muted-foreground">
            Interviews tagged with a number that is not in the file. Fix the
            tag, or add the hypothesis.
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {unknown.map(([id, list]) =>
              list.map((e) => (
                <li
                  key={`${id}-${e.link.interview_id}`}
                  className="flex flex-wrap gap-x-2"
                >
                  <span className="font-mono font-semibold">{id}</span>
                  <EvidenceLine evidence={e} />
                </li>
              )),
            )}
          </ul>
        </section>
      ) : null}
      {parsed.after ? (
        <LibraryMarkdown
          body={parsed.after}
          path={page.path}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
};

const HypothesisLine = ({
  row,
  evidence,
  highlighted,
  path,
  onNavigate,
}: {
  row: HypothesisRow;
  evidence: Evidence[];
  highlighted: boolean;
  path: string;
  onNavigate: (to: string) => void;
}) => {
  const counts = stances
    .map(
      (stance) =>
        [
          stance,
          // issue 98: a conversation captured twice counts once
          new Set(
            evidence
              .filter((e) => e.link.stance === stance)
              .map((e) =>
                e.interview
                  ? sessionKey(e.interview)
                  : String(e.link.interview_id),
              ),
          ).size,
        ] as const,
    )
    .filter(([, n]) => n > 0);
  return (
    <div
      id={`hypothesis-${row.id}`}
      data-testid={`hypothesis-${row.id}`}
      data-highlighted={highlighted ? "true" : undefined}
      className={cn(
        "rounded-md border p-3 scroll-mt-24",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="font-mono font-semibold w-10 shrink-0">{row.id}</span>
        {/* a cell may hold markdown (bold, a link, H8): drawn like the page */}
        <LibraryMarkdown
          body={row.text}
          path={path}
          onNavigate={onNavigate}
          className="flex-1 [&_p]:my-0"
        />
        {row.status ? (
          <Badge
            variant="outline"
            className={cn("shrink-0", statusClass[row.status])}
          >
            {row.status}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 ml-13 flex flex-col gap-1">
        {row.evidence ? (
          <LibraryMarkdown
            body={`From the file: ${row.evidence}`}
            path={path}
            onNavigate={onNavigate}
            className="text-xs text-muted-foreground [&_p]:my-0"
          />
        ) : null}
        {counts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No interview yet.</p>
        ) : (
          <>
            <p className="flex gap-3 text-xs font-medium">
              {counts.map(([stance, n]) => (
                <span key={stance} className={stanceClass[stance]}>
                  {`${n} ${stance}`}
                </span>
              ))}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {evidence.map((e) => (
                <li
                  key={String(e.link.interview_id)}
                  className="flex flex-wrap gap-x-2"
                >
                  <EvidenceLine evidence={e} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};

const EvidenceLine = ({
  evidence: { link, interview, person },
}: {
  evidence: Evidence;
}) => (
  <>
    <Link
      to={interviewPath(link.interview_id)}
      className="text-primary underline hover:no-underline"
    >
      {personName(person) || interview?.title || "Open the interview"}
    </Link>
    {interview?.date ? (
      <span className="text-muted-foreground">{interview.date}</span>
    ) : null}
    <span className={cn("font-medium", stanceClass[link.stance])}>
      {link.stance}
    </span>
    {link.why ? <span>{link.why}</span> : null}
  </>
);
