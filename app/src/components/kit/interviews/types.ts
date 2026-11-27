// The hub's interview tables as the screens read them (docs/SCHEMA.md).
import type { Identifier } from "ra-core";

// What the text of an interview is (issue 83): a word for word transcript,
// notes typed in as written, or a teammate's debrief afterwards.
export type InterviewKind = "transcript" | "notes" | "debrief";

export const kindLabels: Record<InterviewKind, string> = {
  transcript: "Transcript",
  notes: "Notes",
  debrief: "Debrief",
};

export type Interview = {
  id: Identifier;
  contact_id: Identifier;
  date: string;
  interviewer_id: Identifier;
  source: string;
  kind: InterviewKind;
  title: string;
  overview: string;
  // Issue 98: the primary of this interview's session, or null when it is its
  // own. One conversation captured twice (notes and a recording) is one session.
  session_of?: Identifier | null;
};

// The interview a session is known by: its primary.
export const sessionKey = (interview: Pick<Interview, "id" | "session_of">) =>
  String(interview.session_of ?? interview.id);

// Interviews grouped by session, in the order of their first member; each
// group's primary first, then the rest by id.
export const groupSessions = <T extends Interview>(rows: T[]): T[][] => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = sessionKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, members]) =>
    [...members].sort((a, b) =>
      String(a.id) === key
        ? -1
        : String(b.id) === key
          ? 1
          : Number(a.id) - Number(b.id),
    ),
  );
};

export const INTERVIEW_LINE_COLUMNS = [
  "id",
  "contact_id",
  "date",
  "interviewer_id",
  "title",
  "kind",
  "session_of",
] as const;

export const INTERVIEW_COLUMNS = [
  ...INTERVIEW_LINE_COLUMNS,
  "source",
  "overview",
] as const;

export type InterviewHypothesis = {
  interview_id: Identifier;
  hypothesis: string;
  stance: string;
  why?: string | null;
};

export const HYPOTHESIS_COLUMNS = [
  "interview_id",
  "hypothesis",
  "stance",
  "why",
] as const;

export const stances = ["supports", "contradicts", "unclear"] as const;

// The transcript table is read in two ways and never any other: its size
// when the interview page opens, its text when "Show transcript" is pressed.
export const TRANSCRIPTS = "interview_transcripts";
export const TRANSCRIPT_SIZE_COLUMNS = ["interview_id", "chars"] as const;
export const TRANSCRIPT_BODY_COLUMNS = ["interview_id", "body"] as const;

export type TranscriptSize = { interview_id: Identifier; chars: number };
export type TranscriptBody = { interview_id: Identifier; body: string };

export const interviewPath = (id: Identifier) => `/interviews/${id}/show`;
