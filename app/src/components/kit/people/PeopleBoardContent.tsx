// Copied from upstream's deals/DealListContent.tsx and regrouped by
// contacts.status. A person has no position inside a column: the list's sort
// decides it, so a drag only ever changes the status.
import { DragDropContext, type OnDragEndResponder } from "@hello-pangea/dnd";
import isEqual from "lodash/isEqual";
import {
  useDataProvider,
  useGetList,
  useListContext,
  useNotify,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";

import { PeopleColumn } from "./PeopleColumn";
import { personStatuses } from "./statuses";
import type { FollowUp, Person, Teammate } from "./types";

type PeopleByStatus = Record<string, Person[]>;

const getPeopleByStatus = (people: Person[]): PeopleByStatus => {
  const byStatus: PeopleByStatus = Object.fromEntries(
    personStatuses.map((status) => [status.value, [] as Person[]]),
  );
  for (const person of people) {
    // a status the board does not know is not dropped silently into a column
    byStatus[person.status]?.push(person);
  }
  return byStatus;
};

const errorText = (error: unknown) =>
  typeof error === "string"
    ? error
    : ((error as { message?: string })?.message ?? "The change was not saved");

export const PeopleBoardContent = () => {
  const { data: people, isPending, refetch } = useListContext<Person>();
  const dataProvider = useDataProvider();
  const notify = useNotify();

  const { data: teammates } = useGetList<Teammate>("sales", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "last_name", order: "ASC" },
  });
  const { data: followUpRows, error: followUpError } = useGetList<FollowUp>(
    "follow_ups",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "contact_id", order: "ASC" },
    },
  );

  const handles = useMemo(
    () =>
      new Map<Identifier, string>(
        (teammates ?? []).map((teammate) => [
          teammate.id,
          teammate.handle || teammate.first_name,
        ]),
      ),
    [teammates],
  );
  const followUps = useMemo(
    () =>
      new Map<Identifier, FollowUp>(
        (followUpRows ?? []).map((row) => [row.contact_id, row]),
      ),
    [followUpRows],
  );

  const [peopleByStatus, setPeopleByStatus] = useState<PeopleByStatus>(
    getPeopleByStatus([]),
  );

  useEffect(() => {
    if (people) {
      const next = getPeopleByStatus(people);
      if (!isEqual(next, peopleByStatus)) {
        setPeopleByStatus(next);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  if (isPending) return null;

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;

    if (!destination) {
      return;
    }
    if (destination.droppableId === source.droppableId) {
      return;
    }

    const sourceStatus = source.droppableId;
    const destinationStatus = destination.droppableId;
    const person = peopleByStatus[sourceStatus]?.[source.index];
    if (!person) return;

    // show the move at once
    const sourceColumn = peopleByStatus[sourceStatus].filter(
      (other) => other.id !== person.id,
    );
    const destinationColumn = [...peopleByStatus[destinationStatus]];
    destinationColumn.splice(destination.index, 0, {
      ...person,
      status: destinationStatus,
    });
    setPeopleByStatus({
      ...peopleByStatus,
      [sourceStatus]: sourceColumn,
      [destinationStatus]: destinationColumn,
    });

    // then save it. The database decides whether the move is allowed: when it
    // refuses, the card goes back and its sentence is shown as it is.
    dataProvider
      .update("contacts", {
        id: person.id,
        data: { status: destinationStatus },
        previousData: person,
      })
      .then(() => {
        refetch();
      })
      .catch((error: unknown) => {
        setPeopleByStatus(getPeopleByStatus(people ?? []));
        const message = errorText(error);
        notify(message, { type: "error", messageArgs: { _: message } });
        refetch();
      });
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {followUpError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          Next steps could not be loaded: {errorText(followUpError)}
        </p>
      ) : null}
      <div className="flex gap-4 overflow-x-auto" data-testid="people-board">
        {personStatuses.map((status) => (
          <PeopleColumn
            status={status.value}
            label={status.label}
            people={peopleByStatus[status.value]}
            handles={handles}
            followUps={followUps}
            key={status.value}
          />
        ))}
      </div>
    </DragDropContext>
  );
};
