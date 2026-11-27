// The tally at the top of the hub's home page (issue 97): per stakeholder
// category, how many people we have interviewed, scheduled, and contacted or
// later. It reads the view category_tally; every category shows, 0 when
// nobody is in it, so the gaps are plain to see.
import { Card, CardContent } from "@/components/ui/card";

import { useHubRows } from "../hubApi";
import { personCategories, UNCATEGORIZED } from "./categories";

export type TallyRow = {
  id: number;
  category: string;
  interviewed: number;
  scheduled: number;
  contacted_or_later: number;
};

const COLUMNS = [
  "id",
  "category",
  "interviewed",
  "scheduled",
  "contacted_or_later",
] as const;

const ROWS = [
  ...personCategories,
  { value: UNCATEGORIZED, label: "Uncategorized" },
  { value: "total", label: "Total" },
];

export const Tally = () => {
  const { rows, error } = useHubRows<TallyRow>("category_tally", {
    sort: { field: "id", order: "ASC" },
    columns: COLUMNS,
  });
  const byCategory = new Map((rows ?? []).map((row) => [row.category, row]));

  return (
    <Card className="mb-4 py-3" data-testid="tally">
      <CardContent className="px-3">
        <h2 className="text-sm font-medium mb-2">Who we have spoken to</h2>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            The tally could not be loaded.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-normal pr-4">Category</th>
                  <th className="font-normal pr-4 text-right">Interviewed</th>
                  <th className="font-normal pr-4 text-right">Scheduled</th>
                  <th className="font-normal text-right">
                    Contacted or later
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(({ value, label }) => {
                  const row = byCategory.get(value);
                  const total = value === "total";
                  return (
                    <tr
                      key={value}
                      data-testid="tally-row"
                      data-category={value}
                      className={total ? "border-t font-medium" : undefined}
                    >
                      <th scope="row" className="font-normal text-left pr-4">
                        {label}
                      </th>
                      <td className="pr-4 text-right tabular-nums">
                        {row?.interviewed ?? 0}
                      </td>
                      <td className="pr-4 text-right tabular-nums">
                        {row?.scheduled ?? 0}
                      </td>
                      <td className="text-right tabular-nums">
                        {row?.contacted_or_later ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
