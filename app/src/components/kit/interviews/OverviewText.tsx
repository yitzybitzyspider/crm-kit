// An interview's overview, shown as plain text exactly as written, with its
// line breaks and spaces kept. It is written from transcripts, which are
// text from strangers, so it is never drawn as HTML or markdown: React puts
// it on the page as characters, and nothing in it can run or load anything.
import { cn } from "@/lib/utils";

export const OverviewText = ({
  children,
  className,
}: {
  children: string;
  className?: string;
}) => (
  <div
    data-testid="interview-overview"
    className={cn(
      "text-sm leading-6 whitespace-pre-wrap break-words",
      className,
    )}
  >
    {children}
  </div>
);
