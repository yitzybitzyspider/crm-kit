// Made up records for the browser tests of our screens. Nobody here is real.
import { buildContact, buildSale, createCrmDb } from "@/test/StoryWrapper";
import { createDataProvider } from "@/components/atomic-crm/providers/fakerest";
import type { Db } from "@/components/atomic-crm/providers/fakerest/dataGenerator/types";

import type { FollowUp, Person, Teammate, Touch } from "./types";

// The signed in teammate of the test wrapper has id 0.
export const teammates: Teammate[] = [
  { ...buildSale(), handle: "delta" },
  {
    ...buildSale({
      id: 2,
      first_name: "Jordan",
      last_name: "Tran",
      email: "bravo@example-test.example.org",
      user_id: "2",
    }),
    handle: "bravo",
  },
  {
    ...buildSale({
      id: 3,
      first_name: "Alpha",
      last_name: "Kato",
      email: "alpha@example-test.example.org",
      user_id: "3",
    }),
    handle: "alpha",
  },
];

export const buildPerson = (overrides: Partial<Person> = {}): Person => ({
  ...buildContact(),
  status: "to-contact",
  person_code: "DD-01",
  slug: "ada-lovelace",
  contact_key: "ada@example-com.example.org",
  referred_by: null,
  quote_by_name: false,
  ...overrides,
});

export const buildTouch = (overrides: Partial<Touch> = {}): Touch => ({
  id: 1,
  contact_id: 1,
  sales_id: 0,
  date: "2025-03-01T10:00:00.000Z",
  text: "Sent a first email",
  status: "contacted",
  channel: "email",
  next_step: null,
  next_due: null,
  attachments: [],
  ...overrides,
});

export const buildFollowUp = (overrides: Partial<FollowUp> = {}): FollowUp => ({
  id: 1,
  contact_id: 1,
  person_code: "DD-01",
  slug: "ada-lovelace",
  owner_id: 0,
  contact_note_id: 1,
  date: "2025-03-01T10:00:00.000Z",
  sales_id: 0,
  channel: "email",
  next_step: "Follow up",
  next_due: "2026-12-01",
  ...overrides,
});

export type HubData = {
  contacts?: Person[];
  contact_notes?: Touch[];
  follow_ups?: FollowUp[];
  sales?: Teammate[];
  companies?: Db["companies"];
  deals?: Db["deals"];
  tasks?: Db["tasks"];
  // The interview tables (issue 24). Their builders are in interviews/testData.ts.
  interviews?: unknown[];
  interview_hypotheses?: unknown[];
  interview_transcripts?: unknown[];
  call_inbox?: unknown[];
  // The library (issue 95). Its builder is in library/Library.test.tsx.
  library_pages?: unknown[];
  // The view category_tally (issue 97). Its builder is buildTallyRow below.
  category_tally?: unknown[];
};

// What a test hands to <StoryWrapper data=...>. Our extra columns and the
// follow_ups view are not in upstream's types, hence the cast in one place.
export const hubData = (data: HubData = {}): Partial<Db> =>
  ({
    sales: teammates,
    follow_ups: [],
    interviews: [],
    interview_hypotheses: [],
    interview_transcripts: [],
    call_inbox: [],
    library_pages: [],
    category_tally: [],
    ...data,
  }) as unknown as Partial<Db>;

// A fake provider on the same data, for a test that wraps one method.
export const hubDataProvider = (data: HubData = {}) =>
  createDataProvider({ db: createCrmDb(hubData(data)), silent: true });

// One row of the view category_tally (issue 97).
export const buildTallyRow = (
  id: number,
  category: string,
  interviewed = 0,
  scheduled = 0,
  contacted_or_later = 0,
) => ({ id, category, interviewed, scheduled, contacted_or_later });
