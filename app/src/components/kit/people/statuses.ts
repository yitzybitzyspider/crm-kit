// The seven statuses of a person and the seven channels of a touch, in the
// order docs/SCHEMA.md gives them. The database holds the rule; these are the
// labels. This file imports nothing, so upstream's settings file can read it.

export const personStatuses = [
  { value: "to-contact", label: "To contact", color: "#b6bcc6" },
  { value: "contacted", label: "Contacted", color: "#7dbde8" },
  { value: "replied", label: "Replied", color: "#e8cb7d" },
  { value: "scheduled", label: "Scheduled", color: "#c79be8" },
  { value: "interviewed", label: "Interviewed", color: "#a4e87d" },
  { value: "declined", label: "Declined", color: "#e88b7d" },
  { value: "do-not-contact", label: "Do not contact", color: "#5b6270" },
];

export const touchChannels = [
  { id: "email", name: "Email" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "phone", name: "Phone" },
  { id: "text", name: "Text message" },
  { id: "intro", name: "Intro" },
  { id: "in-person", name: "In person" },
  { id: "other", name: "Other" },
];

export const channelLabel = (channel?: string | null) =>
  touchChannels.find((choice) => choice.id === channel)?.name ?? channel ?? "";

// The status a person has after a touch when nobody picks one: a first touch
// moves a to-contact person to contacted, anyone else stays where they are.
export const statusAfterTouch = (status?: string) =>
  status === "to-contact" ? "contacted" : status;

// The statuses the note box offers. Interviewed is set by saving an
// interview, never by hand here; it is listed only when the person already
// has it, so that the picker can show what it keeps.
export const touchStatusChoices = <T extends { value: string }>(
  statuses: T[],
  ...kept: (string | undefined | null)[]
) =>
  statuses.filter(
    (status) => status.value !== "interviewed" || kept.includes(status.value),
  );
