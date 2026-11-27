// A short form to add the person a recording was with, through the fixed
// action add_person. A person is never made without a teammate typing the
// name; the contact starts as the first attendee address that is not a
// teammate's, and follows that address until a person edits it. Saving
// selects the new person on the recording and confirms nothing. When the database says the person is already on file, its
// sentence is shown and that person is offered instead.
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Refusal } from "../HubPage";
import { refusalText, useHubAction } from "../hubApi";
import type { ChosenPerson } from "./types";

// A person code inside a refusal, for example CC-01.
const codeIn = (sentence: string) => sentence.match(/\b[A-Z]{2}-\d+\b/)?.[0];

export const NewPersonFromInbox = ({
  contact: firstContact,
  onCreated,
  onChoose,
  onCancel,
}: {
  contact: string;
  onCreated: (person: ChosenPerson) => void;
  onChoose: (person: ChosenPerson) => void;
  onCancel: () => void;
}) => {
  const ids = useId();
  const act = useHubAction();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [organization, setOrganization] = useState("");
  // The suggested contact can change after the form opens, when the
  // teammates load and a teammate's address stops counting as outside.
  // It is followed until a person types in the field.
  const [typedContact, setContact] = useState<string | null>(null);
  const contact = typedContact ?? firstContact;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setRefusal(null);
    try {
      const filled = Object.fromEntries(
        Object.entries({ role, organization, contact })
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== ""),
      );
      const person = await act("add_person", {
        name: name.trim(),
        ...filled,
        via: "ui",
      });
      onCreated({ person_code: person.person_code, name: person.name });
    } catch (error) {
      setRefusal(refusalText(error, "The person was not saved"));
    } finally {
      setSaving(false);
    }
  };

  const onFile = refusal ? codeIn(refusal) : undefined;
  const field = (
    key: string,
    label: string,
    value: string,
    set: (value: string) => void,
  ) => (
    <div className="flex-1 min-w-48">
      <Label htmlFor={`${ids}-${key}`} className="mb-1">
        {label}
      </Label>
      <Input
        id={`${ids}-${key}`}
        value={value}
        onChange={(event) => set(event.target.value)}
      />
    </div>
  );

  return (
    <form
      onSubmit={save}
      data-testid="new-person"
      className="mt-2 flex flex-col gap-2 rounded-md border p-3"
    >
      <div className="flex flex-wrap gap-2">
        {field("name", "Name", name, setName)}
        {field("role", "Role", role, setRole)}
      </div>
      <div className="flex flex-wrap gap-2">
        {field("organization", "Organization", organization, setOrganization)}
        {field("contact", "Contact", contact, setContact)}
      </div>
      <Refusal>{refusal}</Refusal>
      <div className="flex flex-wrap justify-end gap-2">
        {onFile ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onChoose({ person_code: onFile });
              onCancel();
            }}
          >
            Choose {onFile}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || saving}>
          Save person
        </Button>
      </div>
    </form>
  );
};
