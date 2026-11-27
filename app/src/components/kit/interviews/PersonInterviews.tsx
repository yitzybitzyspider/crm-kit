// The "Interviews" section of a person's page: one line per interview session
// (issue 98: one conversation captured twice is one line, naming its kinds),
// newest first, each a link to the session's primary. Reads the interviews table
// only, never a transcript.
import { useRecordContext } from "ra-core";
import { Link } from "react-router";

import { useHubRows } from "../hubApi";
import type { Person } from "../people/types";
import { useTeammates } from "../useTeammates";
import {
  groupSessions,
  INTERVIEW_LINE_COLUMNS,
  interviewPath,
  kindLabels,
  type Interview,
} from "./types";

export const PersonInterviews = ({ className }: { className?: string }) => {
  const person = useRecordContext<Person>();
  const { nameOf } = useTeammates();
  const { rows, error } = useHubRows<Interview>("interviews", {
    filter: { contact_id: person?.id },
    sort: { field: "date", order: "DESC" },
    columns: INTERVIEW_LINE_COLUMNS,
    enabled: person?.id != null,
  });

  if (!person) return null;

  return (
    <section data-testid="person-interviews" className={className}>
      <h6 className="text-sm font-semibold mb-1">Interviews</h6>
      {error ? (
        <p className="text-sm text-muted-foreground">
          The interviews could not be loaded.
        </p>
      ) : !rows ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No interview yet.</p>
      ) : (
        <ul className="text-sm">
          {groupSessions(rows).map(([interview, ...others]) => (
            <li
              key={interview.id}
              data-testid="interview-line"
              className="flex flex-wrap gap-x-3 py-0.5"
            >
              <span className="text-muted-foreground whitespace-nowrap">
                {interview.date}
              </span>
              <span className="text-muted-foreground">
                {nameOf(interview.interviewer_id)}
              </span>
              <Link
                to={interviewPath(interview.id)}
                className="text-primary underline hover:no-underline break-words min-w-0"
              >
                {interview.title}
              </Link>
              {others.length > 0 ? (
                <span
                  data-testid="session-kinds"
                  className="text-muted-foreground"
                >
                  {[interview, ...others]
                    .map((one) => kindLabels[one.kind] ?? one.kind)
                    .join(", ")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
