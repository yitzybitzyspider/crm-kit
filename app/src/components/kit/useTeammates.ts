// The teammates, by id: who interviewed, who submitted a recording.
import { useGetList, type Identifier } from "ra-core";

import type { Teammate } from "./people/types";

export const useTeammates = () => {
  const { data } = useGetList<Teammate>("sales", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  const teammates = data ?? [];
  const nameOf = (id?: Identifier | null) => {
    const teammate = teammates.find((one) => one.id === id);
    if (!teammate) return "";
    return (
      teammate.handle ||
      [teammate.first_name, teammate.last_name].filter(Boolean).join(" ")
    );
  };
  // Every address a teammate is known by, lowercase.
  const addresses = new Set(
    teammates.flatMap((teammate) =>
      [
        teammate.email,
        ...(((teammate as { secondary_emails?: string[] | null })
          .secondary_emails as string[] | null) ?? []),
      ]
        .filter(Boolean)
        .map((address) => String(address).trim().toLowerCase()),
    ),
  );
  return { teammates, nameOf, addresses, isPending: !data };
};
