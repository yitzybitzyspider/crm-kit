// The recordings inbox as the screens read it (docs/SCHEMA.md, call_inbox).
import type { Identifier } from "ra-core";

export const INBOX = "call_inbox";

// Every column but the transcript: the inbox never loads a transcript body.
export const INBOX_COLUMNS = [
  "id",
  "source",
  "title",
  "recorded_on",
  "attendee_emails",
  "overview",
  "reported_chars",
  "consent_to_record",
  "submitted_by",
  "state",
  "reason",
  "interview_id",
  "resolved_by",
] as const;

export type InboxRecording = {
  id: Identifier;
  source: string;
  title?: string | null;
  recorded_on: string;
  attendee_emails: string[];
  overview?: string | null;
  reported_chars?: number | null;
  consent_to_record?: boolean | null;
  submitted_by: Identifier;
  state: "waiting" | "confirmed" | "dismissed";
  reason?: string | null;
  interview_id?: Identifier | null;
  resolved_by?: Identifier | null;
};

// A row of inbox_suggestions; find_person returns the same first columns.
export type PersonMatch = {
  person_code: string;
  name: string;
  role?: string | null;
  organization?: string | null;
  owner?: string | null;
  status?: string | null;
  matched?: string | null;
};

export type ChosenPerson = { person_code: string; name?: string | null };
