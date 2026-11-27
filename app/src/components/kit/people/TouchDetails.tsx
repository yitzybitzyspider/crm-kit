// What a touch shows on the timeline besides upstream's date and author.
import { cn } from "@/lib/utils";

import { channelLabel } from "./statuses";
import type { Touch } from "./types";

// Channel, and the next step with its due date when there is one.
export const TouchDetails = ({
  touch,
  className,
}: {
  touch: Touch;
  className?: string;
}) => {
  if (!touch.channel && !touch.next_step) return null;
  return (
    <div
      className={cn("text-xs text-muted-foreground pt-1", className)}
      data-testid="touch-details"
    >
      {touch.channel ? (
        <span className="inline-block rounded-md border px-1.5 py-0.5 mr-2">
          {channelLabel(touch.channel)}
        </span>
      ) : null}
      {touch.next_step ? (
        <span className="break-words">
          Next step: <span className="text-foreground">{touch.next_step}</span>
          {touch.next_due ? ` (due ${touch.next_due})` : ""}
        </span>
      ) : null}
    </div>
  );
};

// What was said or sent, as the text it is: no markdown, no HTML.
export const TouchText = ({
  children,
  className,
}: {
  children: string;
  className?: string;
}) => (
  <div className={cn("whitespace-pre-wrap break-words", className)}>
    {children}
  </div>
);
