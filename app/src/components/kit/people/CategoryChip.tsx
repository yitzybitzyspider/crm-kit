// A person's stakeholder category as a small chip (issue 97).
import { useRecordContext } from "ra-core";
import { Badge } from "@/components/ui/badge";

import { categoryLabel } from "./categories";
import type { Person } from "./types";

// The person given, or else the record of the page it is on.
export const CategoryChip = ({ person: given }: { person?: Person | null }) => {
  const record = useRecordContext<Person>();
  const person = given === undefined ? record : given;
  if (!person) return null;
  return (
    <Badge
      variant="outline"
      data-testid="category-chip"
      data-category={person.category ?? ""}
      className={person.category ? undefined : "text-muted-foreground"}
    >
      {categoryLabel(person.category)}
    </Badge>
  );
};
