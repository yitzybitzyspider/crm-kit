---
name: crm-focus
description: The team's focus keeper (80/20). Use when someone says "/crm-focus", "focus", "what matters here", "what should we be working on", "are we drifting", "set the goal", "refocus", "park this", or when the repo has no FOCUS.md. Sets the team's goal, cuts the work to the vital few, writes FOCUS.md, and handles drift by naming it and parking the side idea.
---

# crm-focus

**First, every time:** run `sh scripts/session_start.sh` before anything else. It pulls the team's latest work and skills from GitHub, so you always run the team's newest version of this skill. If it says it could not pull, tell the person and stop. If the pull changed this skill's file, read it again and follow the new version.

Keeps the team on the work that produces the result. Two jobs: define what matters, then hold the line on it. Tone is a sharp friend, not a cop. No em dashes or en dashes.

## Modes

With no argument, run **Define** if the repo has no `FOCUS.md`, otherwise **Check**.

| They say | Mode |
|---|---|
| `/crm-focus`, "set the goal", "what matters here" | Define |
| "are we drifting", "check", "refocus" | Check |
| "park this", "later" | Park |
| "the goal changed", "update the focus" | Revise |

`FOCUS.md` lives at the repo root. One per team. It is shared: the goal is the team's, so a change to it is worth a line to the team.

## Define

1. Ask, in one message, three questions. Skip any already answered.
   - What is the goal, in one sentence?
   - How will you know it is done? (something checkable, with a date if there is one, such as a class deadline)
   - Who is it for, or why does it matter right now?
2. List everything the goal could plausibly need, in short phrases. Pull from the repo, open issues, the hub (`python3 scripts/hub.py list --tally`) and what they said.
3. Cut. Mark the two to four items that produce most of the result, each with one line on why it carries the weight. Everything else goes under Not now. Disagree when it is warranted: if they pick polish over the thing that makes it work, say so. For a customer discovery team, talking to people usually beats building tools.
4. Show the cut in chat, get a yes or a correction, then write `FOCUS.md`.

If they cannot state the goal in a sentence, that is the finding. Help them get to one first; do not write a vague file.

## FOCUS.md format

Under 25 lines. It is read at the start of every session.

```markdown
# Focus: <team or project name>

**Goal:** <one sentence>
**Done when:** <checkable outcome, date if any>
**Why now:** <one line>

## Vital few
1. <item> : <why it carries the result>
2. <item> : <why>
3. <item> : <why>

## Not now
- <thing deliberately dropped or deferred>

## Parked
- <YYYY-MM-DD> <side idea captured during work>

_Set <YYYY-MM-DD>. Revised: <dates>_
```

Then commit `FOCUS.md` by path, run `python3 scripts/check.py`, and push to `main`, as `CLAUDE.md` says.

## Check

Compare what is being worked on now against `FOCUS.md`. Three lines or fewer:

- On goal or off goal, and which vital-few item it serves (or none).
- If off: the on-goal next step.
- Offer to park the current thing.

## Drift (always on, lightly)

A request is drift when it serves neither the goal nor a vital-few item: a feature nobody needs for "done when", polishing what works, building a new tool instead of using one, "while we're here" side quests.

1. Say it in one line: what the request is, and that it does not trace to the goal.
2. Offer to park it.
3. Ask whether to continue anyway.

If they say continue, do it fully and do not raise it again for that request. One nudge, never a refusal, never a lecture. No nudge for quick questions, fixing something broken, real deadlines, or anything a couple of tool calls settle.

## Park

Append the idea to Parked in `FOCUS.md` with today's date, commit and push it. If it is real work someone will act on, offer `/crm-ticket`. Confirm in one line and go back to the goal.

## Revise

The goal may change, on purpose. Ask what changed and why, rewrite the affected lines, move dropped vital-few items to Not now, add today's date to Revised, commit and push. If it has changed three or more times, point that out.

## When the goal is met

When "done when" is true, say so plainly and ask what the next goal is. Do not let work continue under a finished goal.

## After the cut

Once `FOCUS.md` is written and the team says go: research (interviews, outreach) starts with `/crm-sync` and `/crm-outreach`. A change to how the hub works goes by lane (`docs/PROTOCOL.md`): fast in the conversation, otherwise `/crm-ticket` then `/crm-router`.
