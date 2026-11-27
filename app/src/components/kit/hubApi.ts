// How our screens talk to the database. Reads go through the data provider's
// getList with the columns named, so a list never carries a transcript.
// Writes go through the fixed actions of docs/SCHEMA.md (dataProvider.hubAction,
// one rpc call); the browser never writes a hub table itself, and a refusal's
// sentence is shown as the database wrote it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";
import { useCallback } from "react";

export type HubActionArgs = Record<string, unknown>;

type HubProvider = {
  hubAction: (name: string, args?: HubActionArgs) => Promise<any>;
};

// Every query of ours starts with this key, so one call refreshes them all.
const HUB_KEY = "crm-kit";

export const refusalText = (error: unknown, fallback = "It was not saved") =>
  typeof error === "string"
    ? error
    : ((error as { message?: string })?.message ?? fallback);

export const useHubAction = () => {
  const dataProvider = useDataProvider() as unknown as HubProvider;
  return useCallback(
    (name: string, args: HubActionArgs = {}) =>
      dataProvider.hubAction(name, args),
    [dataProvider],
  );
};

export const useHubRefresh = () => {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: [HUB_KEY] }),
    [queryClient],
  );
};

type RowsQuery = {
  filter?: Record<string, unknown>;
  sort: { field: string; order: "ASC" | "DESC" };
  // The columns asked for. Always named: a table that holds a transcript is
  // never read with every column.
  columns: readonly string[];
  perPage?: number;
  enabled?: boolean;
};

export const useHubRows = <Row>(
  resource: string,
  { filter = {}, sort, columns, perPage = 1000, enabled = true }: RowsQuery,
) => {
  const dataProvider = useDataProvider();
  const query = useQuery({
    queryKey: [HUB_KEY, resource, filter, sort, columns, perPage],
    queryFn: async () => {
      const { data, total } = await dataProvider.getList(resource, {
        pagination: { page: 1, perPage },
        sort,
        filter,
        meta: { columns: [...columns] },
      });
      return { rows: data as unknown as Row[], total: total ?? data.length };
    },
    enabled,
  });
  return {
    rows: query.data?.rows,
    total: query.data?.total,
    isPending: query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
};

// Rows a read only action returns (find_person, inbox_suggestions).
export const useHubActionRows = <Row>(
  name: string,
  args: HubActionArgs,
  enabled = true,
) => {
  const act = useHubAction();
  return useQuery({
    queryKey: [HUB_KEY, "action", name, args],
    queryFn: async () => ((await act(name, args)) ?? []) as Row[],
    enabled,
  });
};
