import { useRecordContext } from "ra-core";
import { cn } from "@/lib/utils";

import type { Person } from "./types";

// The person ID the database gave, for example AA-03. Shown, never typed.
export const PersonCode = ({
  person,
  className,
}: {
  person?: Person;
  className?: string;
}) => {
  const record = useRecordContext<Person>();
  const code = (person ?? record)?.person_code;
  if (!code) return null;
  return (
    <span
      data-testid="person-code"
      className={cn(
        "font-mono text-xs font-normal text-muted-foreground whitespace-nowrap",
        className,
      )}
    >
      {code}
    </span>
  );
};
