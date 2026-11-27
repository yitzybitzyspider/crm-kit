// The stakeholder categories of a person, in the order the tally shows them.
// They come from team.json at the repo root (categories); the database holds
// the same list in its categories table (scripts/team.py sql loads it). A
// person with none is uncategorized.
import team from "@team";

export const personCategories: { value: string; label: string }[] =
  team.categories;

export const UNCATEGORIZED = "uncategorized";

export const categoryLabel = (category?: string | null) =>
  category
    ? (personCategories.find((choice) => choice.value === category)?.label ??
      category)
    : "Uncategorized";
