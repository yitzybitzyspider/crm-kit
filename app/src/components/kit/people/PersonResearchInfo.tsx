// The parts of a person the hub adds to upstream's person page: their other
// web links (issue 64), who referred them, whether they may be quoted by
// name, and the contact detail when it is nothing else on file.
import { useRecordContext } from "ra-core";

import { PersonCategory } from "./PersonCategory";
import type { Person } from "./types";

// What a link shows: its host and path, without the scheme or a trailing /.
const label = (address: string) =>
  address.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

export const PersonResearchInfo = () => {
  const record = useRecordContext<Person>();
  if (!record) return null;

  const links = (record.links ?? []).filter(
    (address) => typeof address === "string" && /^https?:\/\//i.test(address),
  );
  const hasEmail = (record.email_jsonb ?? []).some((entry) => entry?.email);
  const hasPhone = (record.phone_jsonb ?? []).some((entry) => entry?.number);
  const otherContact =
    !hasEmail && !hasPhone && !record.linkedin_url && links.length === 0
      ? record.contact_key
      : null;

  return (
    <div className="text-sm" data-testid="person-research-info">
      <PersonCategory />
      {links.length > 0 ? (
        <ul className="md:py-0.5" aria-label="Other links">
          {links.map((address) => (
            <li key={address} className="break-all">
              <a
                className="underline hover:no-underline text-muted-foreground"
                href={address}
                target="_blank"
                rel="noopener noreferrer"
                title={address}
              >
                {label(address)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {otherContact ? (
        <div className="md:py-0.5 break-words">
          <span className="text-muted-foreground">Contact: </span>
          <span>{otherContact}</span>
        </div>
      ) : null}
      <div className="md:py-0.5 break-words">
        <span className="text-muted-foreground">Referred by: </span>
        <span>{record.referred_by || "nobody on file"}</span>
      </div>
      <div className="md:py-0.5 text-muted-foreground">
        {record.quote_by_name
          ? "May be quoted by name"
          : "Quoted without their name"}
      </div>
    </div>
  );
};
