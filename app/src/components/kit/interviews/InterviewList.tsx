// Every interview, newest first. Reads the interviews table without the
// overviews, and never a transcript.
import { useGetMany } from "ra-core";
import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { HubPage } from "../HubPage";
import { useHubRows } from "../hubApi";
import { PersonCode } from "../people/PersonCode";
import type { Person } from "../people/types";
import { useTeammates } from "../useTeammates";
import { INTERVIEW_LINE_COLUMNS, interviewPath, type Interview } from "./types";

export const personName = (person?: Person) =>
  person ? [person.first_name, person.last_name].filter(Boolean).join(" ") : "";

export const InterviewList = () => {
  const { nameOf } = useTeammates();
  const { rows, error } = useHubRows<Interview>("interviews", {
    sort: { field: "date", order: "DESC" },
    columns: INTERVIEW_LINE_COLUMNS,
  });
  const ids = [...new Set((rows ?? []).map((row) => row.contact_id))];
  const { data: people } = useGetMany<Person>(
    "contacts",
    { ids },
    { enabled: ids.length > 0 },
  );
  const personOf = (id: Interview["contact_id"]) =>
    people?.find((person) => person.id === id);

  return (
    <HubPage title="Interviews">
      <h2 className="text-xl font-semibold mb-4 max-md:hidden">Interviews</h2>
      {error ? (
        <p className="text-sm text-muted-foreground">
          The interviews could not be loaded.
        </p>
      ) : !rows ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No interview yet.</p>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Interviewer</TableHead>
                  <TableHead>Title</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((interview) => {
                  const person = personOf(interview.contact_id);
                  return (
                    <TableRow key={interview.id} data-testid="interview-row">
                      <TableCell className="whitespace-nowrap">
                        {interview.date}
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/contacts/${interview.contact_id}/show`}
                          className="hover:underline"
                        >
                          {personName(person)}
                        </Link>{" "}
                        <PersonCode person={person} />
                      </TableCell>
                      <TableCell>{nameOf(interview.interviewer_id)}</TableCell>
                      <TableCell className="whitespace-normal break-words">
                        <Link
                          to={interviewPath(interview.id)}
                          className="text-primary underline hover:no-underline"
                        >
                          {interview.title}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </HubPage>
  );
};
