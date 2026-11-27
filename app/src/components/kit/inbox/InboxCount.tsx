// The number of recordings waiting, beside "Inbox" in the menu. Nothing is
// drawn when nothing waits. Asks for one id and the total, never a row's text.
import { useHubRows } from "../hubApi";
import { INBOX } from "./types";

export const useWaitingCount = () =>
  useHubRows<{ id: number }>(INBOX, {
    filter: { state: "waiting" },
    sort: { field: "id", order: "ASC" },
    columns: ["id"],
    perPage: 1,
  }).total;

export const InboxCount = () => {
  const waiting = useWaitingCount();
  if (!waiting) return null;
  return (
    <span
      data-testid="inbox-count"
      aria-label={`${waiting} waiting`}
      className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
    >
      {waiting}
    </span>
  );
};
