// The recordings inbox: recordings that could not be tied to one person wait
// here, oldest first, until a teammate picks the person, ticks consent and
// confirms, or skips them with a reason. "Skipped" shows the skipped ones,
// where Confirm still works, so a wrong skip can be put right. No read here
// asks for a transcript.
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

import { HubPage } from "../HubPage";
import { useHubRefresh, useHubRows } from "../hubApi";
import { interviewPath } from "../interviews/types";
import { InboxItem } from "./InboxItem";
import { INBOX, INBOX_COLUMNS, type InboxRecording } from "./types";

type Confirmed = {
  inbox_id: InboxRecording["id"];
  interview_id: number;
  person_code: string;
  title?: string | null;
};

export const Inbox = () => {
  const [state, setState] = useState<"waiting" | "dismissed">("waiting");
  const [confirmed, setConfirmed] = useState<Confirmed[]>([]);
  const refresh = useHubRefresh();
  const { rows, error } = useHubRows<InboxRecording>(INBOX, {
    filter: { state },
    sort: { field: "id", order: "ASC" },
    columns: INBOX_COLUMNS,
  });
  // A recording just confirmed leaves the list at once, reload or not.
  const shown = rows?.filter(
    (row) => !confirmed.some((done) => done.inbox_id === row.id),
  );

  return (
    <HubPage title="Inbox">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-semibold max-md:hidden">Inbox</h2>
          <p className="text-sm text-muted-foreground">
            Recordings that are not tied to a person yet.
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Which recordings">
          <Button
            type="button"
            size="sm"
            variant={state === "waiting" ? "default" : "outline"}
            aria-pressed={state === "waiting"}
            onClick={() => setState("waiting")}
          >
            Waiting
          </Button>
          <Button
            type="button"
            size="sm"
            variant={state === "dismissed" ? "default" : "outline"}
            aria-pressed={state === "dismissed"}
            onClick={() => setState("dismissed")}
          >
            Skipped
          </Button>
        </div>
      </div>

      {confirmed.map((done) => (
        <p
          key={done.inbox_id}
          data-testid="inbox-confirmed"
          className="mb-3 rounded-md border px-3 py-2 text-sm break-words"
        >
          Saved as an interview for {done.person_code}
          {done.title ? `: ${done.title}` : ""}.{" "}
          <Link
            to={interviewPath(done.interview_id)}
            className="text-primary underline hover:no-underline"
          >
            Open the interview
          </Link>
        </p>
      ))}

      {error ? (
        <p className="text-sm text-muted-foreground">
          The inbox could not be loaded.
        </p>
      ) : !shown ? null : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {state === "waiting" ? "Nothing is waiting" : "Nothing was skipped"}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((item) => (
            <InboxItem
              key={item.id}
              item={item}
              onChanged={refresh}
              onConfirmed={(result) => {
                setConfirmed((before) => [
                  ...before,
                  { ...result, inbox_id: item.id, title: item.title },
                ]);
                refresh();
              }}
            />
          ))}
        </div>
      )}
    </HubPage>
  );
};
