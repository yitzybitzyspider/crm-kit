// A person's stakeholder category on the person page, changed with a select
// (issue 97). The change goes through update_person; an empty choice clears
// it. A refusal is shown in the database's own words.
import { useRecordContext, useRefresh } from "ra-core";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { refusalText, useHubAction, useHubRefresh } from "../hubApi";
import { personCategories, UNCATEGORIZED } from "./categories";
import type { Person } from "./types";

const items = [
  ...personCategories,
  { value: UNCATEGORIZED, label: "Uncategorized" },
];

export const PersonCategory = () => {
  const record = useRecordContext<Person>();
  const act = useHubAction();
  const refreshHub = useHubRefresh();
  const refresh = useRefresh();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!record?.person_code) return null;

  const handleChange = async (next: string | null) => {
    if (next == null) return;
    setSaving(true);
    setRefusal(null);
    try {
      await act("update_person", {
        person_code: record.person_code,
        category: next === UNCATEGORIZED ? "" : next,
      });
      refresh();
      refreshHub();
    } catch (error) {
      setRefusal(refusalText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="md:py-0.5" data-testid="person-category">
      <Select
        value={record.category || UNCATEGORIZED}
        onValueChange={handleChange}
        items={items}
        disabled={saving}
      >
        <SelectTrigger className="w-48" aria-label="Category">
          <SelectValue placeholder="Uncategorized" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {refusal ? (
        <p role="alert" className="text-sm text-destructive mt-1 break-words">
          {refusal}
        </p>
      ) : null}
    </div>
  );
};
