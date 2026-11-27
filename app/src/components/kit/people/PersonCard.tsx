// Copied from upstream's deals/DealCard.tsx and changed to show a person.
import { Draggable } from "@hello-pangea/dnd";
import { useRedirect } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";

import { CategoryChip } from "./CategoryChip";
import { PersonCode } from "./PersonCode";
import type { FollowUp, Person } from "./types";

type CardProps = {
  person: Person;
  ownerHandle?: string;
  followUp?: FollowUp;
};

export const PersonCard = ({
  person,
  index,
  ...rest
}: CardProps & { index: number }) => {
  if (!person) return null;

  return (
    <Draggable draggableId={String(person.id)} index={index}>
      {(provided, snapshot) => (
        <PersonCardContent
          provided={provided}
          snapshot={snapshot}
          person={person}
          {...rest}
        />
      )}
    </Draggable>
  );
};

export const PersonCardContent = ({
  provided,
  snapshot,
  person,
  ownerHandle,
  followUp,
}: CardProps & {
  provided?: any;
  snapshot?: any;
}) => {
  const redirect = useRedirect();
  const handleClick = () => {
    redirect(`/contacts/${person.id}/show`, undefined, undefined, undefined, {
      _scrollToTop: false,
    });
  };
  const name = `${person.first_name ?? ""} ${person.last_name ?? ""}`;
  const roleAndOrganization = [person.title, person.company_name]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className="cursor-pointer min-w-0"
      data-testid="person-card"
      data-person-code={person.person_code ?? ""}
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      ref={provided?.innerRef}
      onClick={handleClick}
    >
      <Card
        className={`py-3 transition-all duration-200 ${
          snapshot?.isDragging
            ? "opacity-90 transform rotate-1 shadow-lg"
            : "shadow-sm hover:shadow-md"
        }`}
      >
        <CardContent className="px-3 flex flex-col min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <PersonCode person={person} />
            {ownerHandle ? (
              <span className="text-xs text-muted-foreground truncate">
                {ownerHandle}
              </span>
            ) : null}
          </div>
          <p
            className="text-sm font-medium truncate"
            data-testid="person-card-name"
            title={name}
          >
            {name}
          </p>
          {roleAndOrganization ? (
            <p
              className="text-xs text-muted-foreground truncate"
              title={roleAndOrganization}
            >
              {roleAndOrganization}
            </p>
          ) : null}
          <div className="mt-1">
            <CategoryChip person={person} />
          </div>
          {followUp?.next_step ? (
            <p
              className="text-xs mt-2 pt-2 border-t line-clamp-2 break-words"
              data-testid="person-card-next-step"
            >
              <span className="text-muted-foreground">Next: </span>
              <span>{followUp.next_step}</span>
              {followUp.next_due ? (
                <span className="text-muted-foreground">
                  {" "}
                  (due {followUp.next_due})
                </span>
              ) : null}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
