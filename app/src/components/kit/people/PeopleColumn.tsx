// Copied from upstream's deals/DealColumn.tsx and changed to hold people.
import { Droppable } from "@hello-pangea/dnd";
import type { Identifier } from "ra-core";

import { PersonCard } from "./PersonCard";
import type { FollowUp, Person } from "./types";

export const PeopleColumn = ({
  status,
  label,
  people,
  handles,
  followUps,
}: {
  status: string;
  label: string;
  people: Person[];
  handles: Map<Identifier, string>;
  followUps: Map<Identifier, FollowUp>;
}) => {
  return (
    <div
      className="flex-1 min-w-40 pb-8"
      data-testid={`people-column-${status}`}
    >
      <div className="flex flex-col items-center">
        <h3 className="text-base font-medium">{label}</h3>
        <p className="text-sm text-muted-foreground">{people.length}</p>
      </div>
      <Droppable droppableId={status}>
        {(droppableProvided, snapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            data-testid="people-column-list"
            // A fixed height, so that a long column scrolls in place and an
            // empty one is still tall enough to drop a card into: the board
            // library will not move a card into a list shorter than the card.
            className={`flex flex-col rounded-2xl mt-2 gap-2 p-1 min-h-64 h-[calc(100dvh-16rem)] overflow-y-auto ${
              snapshot.isDraggingOver ? "bg-muted" : ""
            }`}
          >
            {people.map((person, index) => (
              <PersonCard
                key={person.id}
                person={person}
                index={index}
                ownerHandle={
                  person.sales_id != null
                    ? handles.get(person.sales_id)
                    : undefined
                }
                followUp={followUps.get(person.id)}
              />
            ))}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
};
