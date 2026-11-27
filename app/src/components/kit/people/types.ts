// The columns the hub adds to upstream's tables (docs/SCHEMA.md). Upstream's
// own types are left alone; ours widen them here.
import type { Identifier } from "ra-core";
import type { Contact, ContactNote, Sale } from "@/components/atomic-crm/types";

export type Person = Contact & {
  person_code?: string | null;
  slug?: string | null;
  contact_key?: string | null;
  links?: string[] | null;
  referred_by?: string | null;
  quote_by_name?: boolean | null;
  // issue 97: one of personCategories, or null for uncategorized
  category?: string | null;
};

export type Touch = ContactNote & {
  channel?: string | null;
  next_step?: string | null;
  next_due?: string | null;
};

export type Teammate = Sale & {
  handle?: string | null;
};

// One row of the view follow_ups: per person, the newest touch with a next step.
export type FollowUp = {
  id: Identifier;
  contact_id: Identifier;
  person_code?: string | null;
  slug?: string | null;
  owner_id?: Identifier | null;
  contact_note_id?: Identifier | null;
  date?: string | null;
  sales_id?: Identifier | null;
  channel?: string | null;
  next_step?: string | null;
  next_due?: string | null;
};
