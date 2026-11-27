// The People screen: every person on a board of the seven statuses. Modelled
// on upstream's deals/DealList.tsx; the deals board itself is not reused.
import { ListBase, useGetIdentity, useGetList, useListContext } from "ra-core";
import { Link } from "react-router";
import { CreateButton } from "@/components/admin/create-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileContent } from "@/components/atomic-crm/layout/MobileContent";
import MobileHeader from "@/components/atomic-crm/layout/MobileHeader";
import { TopToolbar } from "@/components/atomic-crm/layout/TopToolbar";

import { PeopleBoardContent } from "./PeopleBoardContent";
import { Tally } from "./Tally";
import type { Person, Teammate } from "./types";

const ALL_OWNERS = "__all__";

export const PeopleBoard = () => {
  const { identity } = useGetIdentity();
  const isMobile = useIsMobile();

  if (!identity) return null;

  const board = (
    <ListBase
      resource="contacts"
      storeKey="kit.people.board"
      disableSyncWithLocation
      perPage={1000}
      sort={{ field: "last_seen", order: "DESC" }}
    >
      <PeopleBoardLayout />
    </ListBase>
  );

  if (isMobile) {
    return (
      <>
        <MobileHeader>
          <h1 className="text-xl font-semibold">People</h1>
        </MobileHeader>
        <MobileContent>{board}</MobileContent>
      </>
    );
  }
  return board;
};

const PeopleBoardLayout = () => {
  const { data, isPending, filterValues, error } = useListContext<Person>();
  const hasFilters = filterValues && Object.keys(filterValues).length > 0;

  return (
    <div className="w-full min-w-0 mt-2">
      <Tally />
      <div className="flex justify-between items-end gap-2 mb-4">
        <OwnerFilter />
        <TopToolbar>
          <CreateButton resource="contacts" label="Add a person" />
        </TopToolbar>
      </div>
      {error ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          People could not be loaded:{" "}
          {(error as { message?: string })?.message ?? String(error)}
        </p>
      ) : null}
      {!isPending && !error && !data?.length && !hasFilters ? (
        <p className="text-sm text-muted-foreground mb-4">
          Nobody is on file yet.{" "}
          <Link to="/contacts/create" className="underline hover:no-underline">
            Add a person
          </Link>{" "}
          and they will show here under To contact.
        </p>
      ) : null}
      <PeopleBoardContent />
    </div>
  );
};

// All teammates, or one. Filters the list by contacts.sales_id.
const OwnerFilter = () => {
  const { filterValues, setFilters, displayedFilters } = useListContext();
  const { data: teammates } = useGetList<Teammate>("sales", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "last_name", order: "ASC" },
  });

  const items = [
    { value: ALL_OWNERS, label: "All owners" },
    ...(teammates ?? []).map((teammate) => ({
      value: String(teammate.id),
      label: teammate.handle || `${teammate.first_name} ${teammate.last_name}`,
    })),
  ];
  const value =
    filterValues?.sales_id != null ? String(filterValues.sales_id) : ALL_OWNERS;

  const handleChange = (next: string | null) => {
    const { sales_id: _dropped, ...others } = filterValues ?? {};
    if (!next || next === ALL_OWNERS) {
      setFilters(others, displayedFilters);
      return;
    }
    const teammate = (teammates ?? []).find(
      (candidate) => String(candidate.id) === next,
    );
    setFilters(
      { ...others, sales_id: teammate ? teammate.id : next },
      displayedFilters,
    );
  };

  return (
    <Select value={value} onValueChange={handleChange} items={items}>
      <SelectTrigger className="w-44" aria-label="Owner">
        <SelectValue placeholder="All owners" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
