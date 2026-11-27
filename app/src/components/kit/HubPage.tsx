// The frame of one of our own pages: upstream's mobile header and content on
// a phone, a plain block under the desktop header otherwise.
import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileContent } from "@/components/atomic-crm/layout/MobileContent";
import MobileHeader from "@/components/atomic-crm/layout/MobileHeader";

export const HubPage = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <>
        <MobileHeader>
          <h1 className="text-xl font-semibold">{title}</h1>
        </MobileHeader>
        <MobileContent>{children}</MobileContent>
      </>
    );
  }
  return <div className="w-full min-w-0 mt-2 mb-8">{children}</div>;
};

// A refusal, in the database's own words.
export const Refusal = ({ children }: { children?: string | null }) =>
  children ? (
    <p
      role="alert"
      className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive break-words"
    >
      {children}
    </p>
  ) : null;
