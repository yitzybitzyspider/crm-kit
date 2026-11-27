// One interview session (issue 98): when one conversation was captured more
// than once, a tab per capture (transcript, notes, debrief), opened on the one
// the address names. Each capture: who and when, its kind (transcript, notes or debrief, issue
// 83), the overview, the hypotheses it touched, and
// the transcript on request. The transcript's text is asked for only when
// "Show transcript" is pressed, and is drawn as plain text exactly as stored.
// Nothing here changes a transcript or takes an interview away: the only
// write is "Edit overview", through the fixed action update_overview.
import { useGetOne } from "ra-core";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { HubPage, Refusal } from "../HubPage";
import {
  refusalText,
  useHubAction,
  useHubRefresh,
  useHubRows,
} from "../hubApi";
import { CategoryChip } from "../people/CategoryChip";
import { PersonCode } from "../people/PersonCode";
import type { Person } from "../people/types";
import { useTeammates } from "../useTeammates";
import { personName } from "./InterviewList";
import { OverviewText } from "./OverviewText";
import {
  HYPOTHESIS_COLUMNS,
  INTERVIEW_COLUMNS,
  kindLabels,
  sessionKey,
  stances,
  TRANSCRIPT_BODY_COLUMNS,
  TRANSCRIPT_SIZE_COLUMNS,
  TRANSCRIPTS,
  type Interview,
  type InterviewHypothesis,
  type TranscriptBody,
  type TranscriptSize,
} from "./types";

export const characters = (count: number) =>
  `${count.toLocaleString("en-US")} characters`;

export const InterviewPage = () => {
  const params = useParams();
  const id = Number(params.id);
  const { rows, error } = useHubRows<Interview>("interviews", {
    filter: { id },
    sort: { field: "id", order: "ASC" },
    columns: INTERVIEW_COLUMNS,
    perPage: 1,
  });
  const interview = rows?.[0];

  return (
    <HubPage title="Interview">
      {error ? (
        <p className="text-sm text-muted-foreground">
          The interview could not be loaded.
        </p>
      ) : !rows ? null : !interview ? (
        <p className="text-sm text-muted-foreground">
          No interview has this address.
        </p>
      ) : (
        <InterviewSession interview={interview} />
      )}
    </HubPage>
  );
};

const InterviewSession = ({ interview }: { interview: Interview }) => {
  const { rows } = useHubRows<Interview>("interviews", {
    filter: { contact_id: interview.contact_id },
    sort: { field: "id", order: "ASC" },
    columns: INTERVIEW_COLUMNS,
  });
  const members = (rows ?? []).filter(
    (row) => sessionKey(row) === sessionKey(interview),
  );
  if (members.length < 2) return <InterviewContent interview={interview} />;
  const label = (member: Interview) => {
    const kind = kindLabels[member.kind] ?? kindLabels.transcript;
    const same = members.filter((m) => m.kind === member.kind);
    return same.length > 1 ? `${kind} ${same.indexOf(member) + 1}` : kind;
  };
  return (
    <Tabs defaultValue={String(interview.id)} data-testid="interview-session">
      <TabsList aria-label="Captures of this conversation">
        {members.map((member) => (
          <TabsTrigger key={member.id} value={String(member.id)}>
            {label(member)}
          </TabsTrigger>
        ))}
      </TabsList>
      {members.map((member) => (
        <TabsContent key={member.id} value={String(member.id)}>
          <InterviewContent interview={member} />
        </TabsContent>
      ))}
    </Tabs>
  );
};

const InterviewContent = ({ interview }: { interview: Interview }) => {
  const { nameOf } = useTeammates();
  const { data: person } = useGetOne<Person>("contacts", {
    id: interview.contact_id,
  });
  const { rows: hypotheses } = useHubRows<InterviewHypothesis>(
    "interview_hypotheses",
    {
      filter: { interview_id: interview.id },
      sort: { field: "hypothesis", order: "ASC" },
      columns: HYPOTHESIS_COLUMNS,
    },
  );
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold break-words">
              {interview.title}
            </h2>
            <Badge variant="outline" data-testid="interview-kind">
              {kindLabels[interview.kind] ?? kindLabels.transcript}
            </Badge>
          </div>
          <dl
            data-testid="interview-facts"
            className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground"
          >
            <div className="flex gap-1.5">
              <dt>Person</dt>
              <dd>
                <Link
                  to={`/contacts/${interview.contact_id}/show`}
                  className="text-primary underline hover:no-underline"
                >
                  {personName(person) || "Open the person"}
                </Link>{" "}
                <PersonCode person={person} />{" "}
                <CategoryChip person={person} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Date</dt>
              <dd className="text-foreground">{interview.date}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Interviewer</dt>
              <dd className="text-foreground">
                {nameOf(interview.interviewer_id)}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Source</dt>
              <dd className="text-foreground">{interview.source}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {editing ? (
            <OverviewEdit
              interview={interview}
              hypotheses={hypotheses ?? []}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 mb-3">
                <h3 className="text-lg font-semibold">Overview</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hypotheses}
                  onClick={() => setEditing(true)}
                >
                  Edit overview
                </Button>
              </div>
              <OverviewText>{interview.overview}</OverviewText>
              <h3 className="text-lg font-semibold mt-6 mb-2">Hypotheses</h3>
              {!hypotheses ? null : hypotheses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hypothesis is linked.
                </p>
              ) : (
                <ul className="text-sm">
                  {hypotheses.map((link) => (
                    <li
                      key={link.hypothesis}
                      data-testid="interview-hypothesis"
                      className="flex flex-wrap gap-x-3 py-0.5"
                    >
                      <span className="font-mono">{link.hypothesis}</span>
                      <span className="text-muted-foreground">
                        {link.stance}
                      </span>
                      <span className="break-words min-w-0">{link.why}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Transcript interviewId={interview.id} />
        </CardContent>
      </Card>
    </div>
  );
};

const Transcript = ({ interviewId }: { interviewId: Interview["id"] }) => {
  const [shown, setShown] = useState(false);
  const [asked, setAsked] = useState(false);
  const { rows: sizes } = useHubRows<TranscriptSize>(TRANSCRIPTS, {
    filter: { interview_id: interviewId },
    sort: { field: "interview_id", order: "ASC" },
    columns: TRANSCRIPT_SIZE_COLUMNS,
    perPage: 1,
  });
  // Asked for once, on the first press, and kept while the page is open.
  const { rows: bodies, error } = useHubRows<TranscriptBody>(TRANSCRIPTS, {
    filter: { interview_id: interviewId },
    sort: { field: "interview_id", order: "ASC" },
    columns: TRANSCRIPT_BODY_COLUMNS,
    perPage: 1,
    enabled: asked,
  });
  const size = sizes?.[0]?.chars;
  const body = bodies?.[0]?.body;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Transcript</h3>
          <p
            data-testid="transcript-size"
            className="text-sm text-muted-foreground"
          >
            {size == null ? "" : `${characters(size)}, word for word`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAsked(true);
            setShown(!shown);
          }}
        >
          {shown ? "Hide transcript" : "Show transcript"}
        </Button>
      </div>
      {shown && error ? (
        <Refusal>
          {refusalText(error, "The transcript could not be loaded")}
        </Refusal>
      ) : null}
      {shown && body != null ? (
        <pre
          data-testid="transcript"
          tabIndex={0}
          className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-4 font-mono text-xs leading-5"
        >
          {body}
        </pre>
      ) : null}
    </>
  );
};

type LinkDraft = { hypothesis: string; stance: string; why: string };

const OverviewEdit = ({
  interview,
  hypotheses,
  onDone,
}: {
  interview: Interview;
  hypotheses: InterviewHypothesis[];
  onDone: () => void;
}) => {
  const act = useHubAction();
  const refresh = useHubRefresh();
  const [overview, setOverview] = useState(interview.overview);
  const [links, setLinks] = useState<LinkDraft[]>(
    hypotheses.map((link) => ({
      hypothesis: link.hypothesis,
      stance: link.stance,
      why: link.why ?? "",
    })),
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setLink = (index: number, change: Partial<LinkDraft>) =>
    setLinks(
      links.map((link, at) => (at === index ? { ...link, ...change } : link)),
    );

  const save = async () => {
    setSaving(true);
    setRefusal(null);
    try {
      await act("update_overview", {
        interview_id: interview.id,
        overview,
        // a line whose number was emptied is left out
        hypotheses: links
          .filter((link) => link.hypothesis.trim() !== "")
          .map((link) => ({
            hypothesis: link.hypothesis.trim(),
            stance: link.stance,
            ...(link.why.trim() ? { why: link.why.trim() } : {}),
          })),
        via: "ui",
      });
      await refresh();
      onDone();
    } catch (error) {
      setRefusal(refusalText(error, "The overview was not saved"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Label htmlFor="hub-overview" className="text-lg font-semibold">
        Overview
      </Label>
      <Textarea
        id="hub-overview"
        value={overview}
        onChange={(event) => setOverview(event.target.value)}
        rows={16}
        className="font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Plain text, shown as written. A passage in quotation marks must be in
        the transcript word for word.
      </p>
      <h3 className="text-lg font-semibold mt-2">Hypotheses</h3>
      {links.map((link, index) => (
        <div key={index} className="flex flex-wrap gap-2">
          <Input
            aria-label={`Hypothesis ${index + 1}`}
            value={link.hypothesis}
            onChange={(event) =>
              setLink(index, { hypothesis: event.target.value })
            }
            placeholder="H2"
            className="w-20"
          />
          <select
            aria-label={`Stance ${index + 1}`}
            value={link.stance}
            onChange={(event) => setLink(index, { stance: event.target.value })}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {stances.map((stance) => (
              <option key={stance} value={stance}>
                {stance}
              </option>
            ))}
          </select>
          <Input
            aria-label={`Why ${index + 1}`}
            value={link.why}
            onChange={(event) => setLink(index, { why: event.target.value })}
            placeholder="Why, in one line"
            className="flex-1 min-w-48"
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        To take a hypothesis off this interview, empty its number.
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setLinks([
              ...links,
              { hypothesis: "", stance: "supports", why: "" },
            ])
          }
        >
          Add a hypothesis
        </Button>
      </div>
      <Refusal>{refusal}</Refusal>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          Save overview
        </Button>
      </div>
    </form>
  );
};
