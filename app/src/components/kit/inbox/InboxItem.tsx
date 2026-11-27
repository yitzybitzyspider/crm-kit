// One recording in the inbox. Choosing a person and ticking "They agreed to
// be recorded" enables Confirm, which calls confirm_recording with consent
// true. The tick always starts off and is cleared when the person changes:
// it is the teammate's own statement, never copied from the recording.
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Refusal } from "../HubPage";
import { refusalText, useHubAction, useHubActionRows } from "../hubApi";
import { characters } from "../interviews/InterviewPage";
import { OverviewText } from "../interviews/OverviewText";
import { useTeammates } from "../useTeammates";
import { NewPersonFromInbox } from "./NewPersonFromInbox";
import type { ChosenPerson, InboxRecording, PersonMatch } from "./types";

const matchedBy: Record<string, string> = {
  email: "same email",
  domain: "same email domain",
  name: "name in the title",
};

const PersonButton = ({
  match,
  chosen,
  onChoose,
  testId,
}: {
  match: PersonMatch;
  chosen: boolean;
  onChoose: () => void;
  testId: string;
}) => (
  <li data-testid={testId}>
    <Button
      type="button"
      variant={chosen ? "default" : "outline"}
      aria-pressed={chosen}
      onClick={onChoose}
      className="h-auto w-full justify-start gap-x-2 gap-y-0 whitespace-normal py-1.5 text-left flex-wrap"
    >
      <span className="font-mono text-xs">{match.person_code}</span>
      <span>{match.name}</span>
      <span className="font-normal opacity-80">
        {[match.role, match.organization].filter(Boolean).join(", ")}
      </span>
      {match.matched ? (
        <span className="ml-auto text-xs font-normal opacity-80">
          {matchedBy[match.matched] ?? match.matched}
        </span>
      ) : null}
    </Button>
  </li>
);

export const InboxItem = ({
  item,
  onChanged,
  onConfirmed,
}: {
  item: InboxRecording;
  // the list should be read again
  onChanged: () => void;
  onConfirmed: (result: { interview_id: number; person_code: string }) => void;
}) => {
  const ids = useId();
  const act = useHubAction();
  const { nameOf, addresses } = useTeammates();
  const suggestions = useHubActionRows<PersonMatch>("inbox_suggestions", {
    inbox_id: item.id,
  });
  const [chosen, setChosen] = useState<ChosenPerson | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PersonMatch[] | null>(null);

  // Any change of person clears the tick.
  const choose = (person: ChosenPerson) => {
    if (person.person_code !== chosen?.person_code) setAgreed(false);
    setChosen(person);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setRefusal(null);
    try {
      await work();
    } catch (error) {
      setRefusal(refusalText(error));
      // someone else may have got here first: read the list again
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    run(async () => {
      const result = await act("confirm_recording", {
        inbox_id: item.id,
        person_code: chosen!.person_code,
        consent_to_record: true,
        via: "ui",
      });
      onConfirmed(result);
    });

  const skip = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      await act("dismiss_recording", {
        inbox_id: item.id,
        reason: reason.trim(),
        via: "ui",
      });
      onChanged();
    });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    return run(async () => {
      setFound(
        (await act("find_person", { query: query.trim(), via: "ui" })) ?? [],
      );
    });
  };

  const suggested = (suggestions.data ?? []).slice(0, 3);
  const outside = item.attendee_emails.filter(
    (address) => !addresses.has(address.toLowerCase()),
  );

  return (
    <Card data-testid="inbox-item" data-inbox-id={item.id}>
      <CardContent className="flex flex-col gap-3 min-w-0">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold break-words">
            {item.title || "A recording with no title"}
          </h3>
          <p className="text-sm text-muted-foreground flex flex-wrap gap-x-4">
            <span>Recorded {item.recorded_on}</span>
            <span>Submitted by {nameOf(item.submitted_by)}</span>
            <span>
              Transcript:{" "}
              {item.reported_chars != null
                ? characters(item.reported_chars)
                : "size not reported"}
            </span>
          </p>
          <p className="text-sm mt-1 break-words">
            <span className="text-muted-foreground">
              {item.state === "dismissed"
                ? `Skipped by ${nameOf(item.resolved_by)}: `
                : "Waiting because: "}
            </span>
            {item.reason}
          </p>
          <p className="text-sm mt-1 break-all">
            <span className="text-muted-foreground break-normal">
              Attendees:{" "}
            </span>
            {item.attendee_emails.length
              ? item.attendee_emails.join(", ")
              : "none on the invite"}
          </p>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Draft overview
          </summary>
          <OverviewText className="mt-2 rounded-md border p-3">
            {item.overview ?? ""}
          </OverviewText>
        </details>

        <div>
          <h4 className="text-sm font-semibold mb-1">Who was this with?</h4>
          {suggestions.isPending ? null : suggested.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody on file matches this recording.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {suggested.map((match) => (
                <PersonButton
                  key={match.person_code}
                  testId="suggestion"
                  match={match}
                  chosen={chosen?.person_code === match.person_code}
                  onChoose={() => choose(match)}
                />
              ))}
            </ul>
          )}
          <form onSubmit={search} className="mt-2 flex gap-2">
            <Input
              aria-label="Search all people"
              placeholder="Search all people by name, code, contact or organization"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!query.trim()}>
              Search
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreating(!creating)}
            >
              Create new person
            </Button>
          </form>
          {found ? (
            found.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nobody on file matches that search.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {found.map((match) => (
                  <PersonButton
                    key={match.person_code}
                    testId="search-result"
                    match={match}
                    chosen={chosen?.person_code === match.person_code}
                    onChoose={() => choose(match)}
                  />
                ))}
              </ul>
            )
          ) : null}
          {creating ? (
            <NewPersonFromInbox
              contact={outside[0] ?? ""}
              onChoose={choose}
              onCreated={(person) => {
                choose(person);
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
          <p
            data-testid="chosen-person"
            className="text-sm min-w-0 break-words"
          >
            {chosen ? (
              <>
                <span className="text-muted-foreground">Person: </span>
                <span className="font-mono text-xs">
                  {chosen.person_code}
                </span>{" "}
                {chosen.name}
              </>
            ) : (
              <span className="text-muted-foreground">
                No person chosen yet
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <input
              id={`${ids}-agreed`}
              type="checkbox"
              className="size-4 accent-primary"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <Label htmlFor={`${ids}-agreed`}>They agreed to be recorded</Label>
          </div>
          <div className="ml-auto flex gap-2">
            {item.state === "waiting" ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSkipping(!skipping)}
              >
                Skip
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={!chosen || !agreed || busy}
              onClick={confirm}
            >
              Confirm
            </Button>
          </div>
        </div>

        {skipping && item.state === "waiting" ? (
          <form onSubmit={skip} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-56">
              <Label htmlFor={`${ids}-reason`} className="mb-1">
                Reason
              </Label>
              <Input
                id={`${ids}-reason`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this is not an interview to keep"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReason("not an interview")}
            >
              not an interview
            </Button>
            <Button
              type="submit"
              variant="secondary"
              disabled={!reason.trim() || busy}
            >
              Skip this recording
            </Button>
          </form>
        ) : null}

        <Refusal>{refusal}</Refusal>
      </CardContent>
    </Card>
  );
};
