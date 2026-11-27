// Made up interviews and recordings for the browser tests. Nobody here is real.
import { vi } from "vitest";

import type { InboxRecording, PersonMatch } from "../inbox/types";
import { hubDataProvider, type HubData } from "../people/testData";
import type { Interview, InterviewHypothesis } from "./types";

export const buildInterview = (
  overrides: Partial<Interview> = {},
): Interview => ({
  id: 1,
  contact_id: 1,
  date: "2026-11-02",
  interviewer_id: 0,
  source: "granola",
  kind: "transcript",
  title: "Interview: Ada Lovelace, CTO, Acme",
  overview: "We talked about the waiting room.",
  ...overrides,
});

export const buildHypothesis = (
  overrides: Partial<InterviewHypothesis> = {},
): InterviewHypothesis => ({
  interview_id: 1,
  hypothesis: "H2",
  stance: "supports",
  why: "She described the same wait",
  ...overrides,
});

export const buildTranscript = (interview_id: number, body: string) => ({
  interview_id,
  body,
  chars: body.length,
  reported_chars: body.length,
});

export const buildRecording = (
  overrides: Partial<InboxRecording> & { transcript?: string } = {},
) => ({
  id: 1,
  source: "granola",
  title: "Call with a charge nurse",
  recorded_on: "2026-11-03",
  attendee_emails: ["bravo@example-test.example.org", "nurse@riverbend-test.example.org"],
  overview: "A draft overview of the call.",
  transcript: "TRANSCRIPT-BODY-NEVER-SHOWN-IN-THE-INBOX",
  reported_chars: 48211,
  consent_to_record: null,
  submitted_by: 2,
  state: "waiting" as const,
  reason: "no person matches an attendee",
  interview_id: null,
  resolved_by: null,
  ...overrides,
});

export const buildMatch = (
  overrides: Partial<PersonMatch> = {},
): PersonMatch => ({
  person_code: "DD-01",
  name: "Ada Lovelace",
  role: "CTO",
  organization: "Acme",
  owner: "delta",
  status: "contacted",
  matched: "email",
  ...overrides,
});

type Actions = Record<string, (args: any) => unknown>;

// A fake provider whose reads are watched and whose fixed actions are the
// ones the test hands in. An action the test did not name fails loudly.
export const watchedProvider = (data: HubData, actions: Actions = {}) => {
  const base = hubDataProvider(data);
  const getList = vi.fn(base.getList);
  const hubAction = vi.fn(async (name: string, args: any = {}) => {
    if (!actions[name]) throw new Error(`the test gave no answer for ${name}`);
    return actions[name](args);
  });
  return {
    base,
    getList,
    hubAction,
    dataProvider: {
      ...base,
      getList: getList as unknown as typeof base.getList,
      hubAction,
    },
    // the calls of one action, as their arguments
    callsOf: (name: string) =>
      hubAction.mock.calls.filter(([n]) => n === name).map(([, args]) => args),
    // every list read of one table, as the columns it asked for
    columnsReadFrom: (resource: string) =>
      getList.mock.calls
        .filter(([r]) => r === resource)
        .map(([, params]) => (params as any)?.meta?.columns as string[]),
  };
};

// True when a read of a table asked for a column, or named no columns at all.
export const readColumn = (reads: (string[] | undefined)[], column: string) =>
  reads.some((columns) => !columns || columns.includes(column));
