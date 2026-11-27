// Issue 99: what the calendar shows. Follow-ups come from the view follow_ups;
// interviews from touches with the status scheduled, whose next_due is the
// interview date. Pure, so the rules read in one place.
import type { Identifier } from "ra-core";

import type { FollowUp, Person, Touch } from "../people/types";

export type CalendarItem = {
  key: string;
  contactId: Identifier;
  personCode: string;
  name: string;
  nextStep: string;
  ownerId: Identifier | null;
  // YYYY-MM-DD, or null for a follow-up with no date
  due: string | null;
  kind: "follow-up" | "interview";
};

const nameOf = (person?: Person) =>
  person ? [person.first_name, person.last_name].filter(Boolean).join(" ") : "";

export const dayKey = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const buildItems = (
  followUps: FollowUp[],
  touches: Touch[],
  people: Person[],
): CalendarItem[] => {
  const byId = new Map(people.map((person) => [person.id, person]));
  const items: CalendarItem[] = [];
  const seenTouches = new Set<Identifier>();
  for (const row of followUps) {
    const person = byId.get(row.contact_id);
    if (row.contact_note_id != null) seenTouches.add(row.contact_note_id);
    items.push({
      key: `f-${row.id}`,
      contactId: row.contact_id,
      personCode: row.person_code ?? person?.person_code ?? "",
      name: nameOf(person),
      nextStep: row.next_step ?? "",
      ownerId: row.owner_id ?? null,
      due: row.next_due ? row.next_due.slice(0, 10) : null,
      kind: "follow-up",
    });
  }
  for (const touch of touches) {
    if (touch.status !== "scheduled" || !touch.next_due) continue;
    if (seenTouches.has(touch.id)) continue;
    const person = byId.get(touch.contact_id);
    // once the person is interviewed, the scheduled interview drops off
    if (person?.status === "interviewed") continue;
    items.push({
      key: `t-${touch.id}`,
      contactId: touch.contact_id,
      personCode: person?.person_code ?? "",
      name: nameOf(person),
      nextStep: touch.next_step || "Interview",
      ownerId: person?.sales_id ?? null,
      due: touch.next_due.slice(0, 10),
      kind: "interview",
    });
  }
  return items;
};

// Due before today, for a person not yet interviewed.
export const isOverdue = (
  item: CalendarItem,
  today: string,
  people: Person[],
) =>
  item.due != null &&
  item.due < today &&
  people.find((person) => person.id === item.contactId)?.status !==
    "interviewed";
