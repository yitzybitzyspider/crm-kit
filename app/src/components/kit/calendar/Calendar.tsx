// Issue 99: when interviews are scheduled and follow-ups are due, per
// teammate. Read only: the hub's own data, no outside calendar.
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useGetIdentity, useGetList, type Identifier } from "ra-core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileHeader from "@/components/atomic-crm/layout/MobileHeader";
import { MobileContent } from "@/components/atomic-crm/layout/MobileContent";

import type { FollowUp, Person, Touch } from "../people/types";
import { useTeammates } from "../useTeammates";
import { buildItems, dayKey, isOverdue, type CalendarItem } from "./items";

const PER_DAY = 3;
const OWNER_COLORS = [
  "#2563eb",
  "#16a34a",
  "#c026d3",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
];

const all = { pagination: { page: 1, perPage: 1000 } };

export const Calendar = ({ today = new Date() }: { today?: Date }) => {
  const isMobile = useIsMobile();
  const body = <CalendarBody today={today} />;
  if (isMobile) {
    return (
      <>
        <MobileHeader>
          <h1 className="text-xl font-semibold">Calendar</h1>
        </MobileHeader>
        <MobileContent>{body}</MobileContent>
      </>
    );
  }
  return body;
};

const CalendarBody = ({ today }: { today: Date }) => {
  const { identity } = useGetIdentity();
  const isMobile = useIsMobile();
  const { teammates, nameOf } = useTeammates();
  const { data: followUps } = useGetList<FollowUp>("follow_ups", {
    ...all,
    sort: { field: "contact_id", order: "ASC" },
  });
  const { data: touches } = useGetList<Touch>("contact_notes", {
    ...all,
    sort: { field: "id", order: "ASC" },
    filter: { status: "scheduled" },
  });
  const { data: people } = useGetList<Person>("contacts", {
    ...all,
    sort: { field: "id", order: "ASC" },
  });

  const [view, setView] = useState<"month" | "week">("month");
  const [mine, setMine] = useState(false);
  const [anchor, setAnchor] = useState(today);

  const items = useMemo(
    () => buildItems(followUps ?? [], touches ?? [], people ?? []),
    [followUps, touches, people],
  );
  const shown = mine
    ? items.filter((item) => item.ownerId === identity?.id)
    : items;

  const colorOf = (ownerId: Identifier | null) => {
    const index = teammates.findIndex((one) => one.id === ownerId);
    return index < 0 ? "#6b7280" : OWNER_COLORS[index % OWNER_COLORS.length];
  };

  const todayKey = dayKey(today);
  const overdue = shown
    .filter((item) => isOverdue(item, todayKey, people ?? []))
    .sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const noDate = shown.filter((item) => item.due == null);
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of shown) {
    if (!item.due) continue;
    byDay.set(item.due, [...(byDay.get(item.due) ?? []), item]);
  }

  const start =
    view === "month" ? startOfWeek(startOfMonth(anchor)) : startOfWeek(anchor);
  const end =
    view === "month" ? endOfWeek(endOfMonth(anchor)) : endOfWeek(anchor);
  const days: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);

  const step = (by: number) =>
    setAnchor(view === "month" ? addMonths(anchor, by) : addWeeks(anchor, by));

  const entry = (item: CalendarItem) => (
    <Link
      key={item.key}
      to={`/contacts/${item.contactId}/show`}
      className="block truncate rounded px-1 text-xs hover:bg-muted"
      style={{ borderLeft: `3px solid ${colorOf(item.ownerId)}` }}
      title={`${item.personCode} ${item.name}: ${item.nextStep} (${nameOf(item.ownerId)})`}
    >
      <span className="font-mono">{item.personCode}</span>{" "}
      <span>{item.name}</span>
      <span className="block truncate text-muted-foreground">
        {item.nextStep}
      </span>
    </Link>
  );

  return (
    <div className="mt-2 flex flex-col gap-4" data-testid="calendar">
      <div className="flex flex-wrap items-center gap-2">
        {!isMobile && <h1 className="text-xl font-semibold">Calendar</h1>}
        <div className="ml-auto flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={mine ? "outline" : "default"}
            onClick={() => setMine(false)}
          >
            Team
          </Button>
          <Button
            size="sm"
            variant={mine ? "default" : "outline"}
            onClick={() => setMine(true)}
          >
            Mine
          </Button>
          <Button
            size="sm"
            variant={view === "month" ? "default" : "outline"}
            onClick={() => setView("month")}
          >
            Month
          </Button>
          <Button
            size="sm"
            variant={view === "week" ? "default" : "outline"}
            onClick={() => setView("week")}
          >
            Week
          </Button>
        </div>
      </div>

      {overdue.length > 0 && (
        <section
          data-testid="calendar-overdue"
          className="rounded border border-red-300 p-2 text-red-700"
        >
          <h2 className="text-sm font-semibold">Overdue</h2>
          {overdue.map((item) => (
            <div key={item.key} className="flex gap-2 text-sm">
              <span>{item.due}</span>
              {entry(item)}
            </div>
          ))}
        </section>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => step(-1)}>
          Previous
        </Button>
        <span className="font-medium">
          {view === "month"
            ? format(anchor, "MMMM yyyy")
            : `Week of ${format(start, "d MMM yyyy")}`}
        </span>
        <Button size="sm" variant="outline" onClick={() => step(1)}>
          Next
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px rounded border bg-border text-sm">
        {days.slice(0, 7).map((day) => (
          <div
            key={`h-${day}`}
            className="bg-background p-1 text-center font-medium"
          >
            {format(day, "EEE")}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const muted = view === "month" && !isSameMonth(day, anchor);
          return (
            <div
              key={key}
              data-testid={`day-${key}`}
              className={`min-h-24 min-w-0 bg-background p-1 ${muted ? "opacity-50" : ""} ${key === todayKey ? "ring-2 ring-inset ring-primary" : ""}`}
            >
              <div className="text-xs text-muted-foreground">
                {format(day, "d")}
              </div>
              {(view === "week" ? list : list.slice(0, PER_DAY)).map(entry)}
              {view === "month" && list.length > PER_DAY && (
                <div className="text-xs text-muted-foreground">
                  +{list.length - PER_DAY} more
                </div>
              )}
            </div>
          );
        })}
      </div>

      {noDate.length > 0 && (
        <section data-testid="calendar-no-date" className="rounded border p-2">
          <h2 className="text-sm font-semibold">No date</h2>
          {noDate.map(entry)}
        </section>
      )}
    </div>
  );
};
