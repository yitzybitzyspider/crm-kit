// The one place the hub's own screens and menu entries are registered.
// Upstream's root, header and mobile bar read this; see app/UPSTREAM.md for
// every upstream file that was edited to mount something from this folder.
import type { ComponentType } from "react";

import { Calendar } from "./calendar/Calendar";
import { Inbox } from "./inbox/Inbox";
import { InboxCount } from "./inbox/InboxCount";
import { InterviewList } from "./interviews/InterviewList";
import { InterviewPage } from "./interviews/InterviewPage";
import { Library } from "./library/Library";
import { PeopleBoard } from "./people/PeopleBoard";

type MenuEntry = {
  label: string;
  to: string;
  // drawn beside the label, for example the number of recordings waiting
  Count?: ComponentType;
  // whether the entry is also on the phone's bottom bar, which has no room
  // for more than one of ours
  phone?: boolean;
};

const menu: MenuEntry[] = [
  { label: "People", to: "/", phone: true },
  { label: "Interviews", to: "/interviews" },
  { label: "Inbox", to: "/inbox", Count: InboxCount },
  // issue 95: hypotheses, research, competition and diagrams
  { label: "Library", to: "/library" },
  // issue 99: scheduled interviews and due follow-ups
  { label: "Calendar", to: "/calendar" },
];

export const hub = {
  // The page a teammate lands on after sign-in, at "/".
  Landing: PeopleBoard,
  // Upstream's dashboard moved here to make room.
  dashboardPath: "/dashboard",
  // Menu entries, shown before upstream's own.
  menu,
  // The phone's bottom bar has room for one of ours. The other pages open
  // on a phone by their address and by links, with no entry in the bar.
  phoneMenu: menu.filter((entry) => entry.phone),
  // The menu entry a page belongs to, if it is one of ours other than "/".
  menuEntryAt: (pathname: string) =>
    menu.find(
      (entry) =>
        entry.to !== "/" &&
        (pathname === entry.to || pathname.startsWith(`${entry.to}/`)),
    ),
  // The pages of our own screens, mounted by upstream's root in both the
  // desktop and the phone app.
  routes: [
    { path: "/interviews", Page: InterviewList },
    { path: "/interviews/:id/show", Page: InterviewPage },
    { path: "/inbox", Page: Inbox },
    { path: "/library", Page: Library },
    { path: "/library/:section", Page: Library },
    { path: "/calendar", Page: Calendar },
  ],
  // What upstream offers that the hub does not. The database refuses every
  // delete (a person leaves by the status do-not-contact) and a merge deletes
  // a person; deals are not used.
  shows: {
    delete: false,
    merge: false,
    deals: false,
    // issue 40 item 14: no file is attached to a touch; the database refuses
    // a new attachment and the bucket is private.
    attachments: false,
  },
};

export { PersonInterviews } from "./interviews/PersonInterviews";
export { PeopleBoard } from "./people/PeopleBoard";
export { PersonCode } from "./people/PersonCode";
export {
  PersonCreateBase,
  PersonCreateRefusal,
} from "./people/PersonCreateRefusal";
export { PersonResearchInfo } from "./people/PersonResearchInfo";
export { CategoryChip } from "./people/CategoryChip";
export { personCategories } from "./people/categories";
export { TouchDetails, TouchText } from "./people/TouchDetails";
export { TouchInputs } from "./people/TouchInputs";
export {
  personStatuses,
  statusAfterTouch,
  touchChannels,
  touchStatusChoices,
} from "./people/statuses";
export type { FollowUp, Person, Teammate, Touch } from "./people/types";
