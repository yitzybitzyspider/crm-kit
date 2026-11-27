---
name: crm-ticket
description: Turn a request to change how the hub works into GitHub issues complete enough that a worker can build them without asking anything. Use when someone says "ticket this", "make issues for X", "I want the hub to do X", or asks for any change to skills, scripts, checks, templates or docs in this repo.
---

# crm-ticket

**First, every time:** run `sh scripts/session_start.sh` before anything else. It pulls the latest hub and skills from GitHub, so you always run the team's newest version of this skill. If it says it could not pull, tell the person and stop. If the pull changed this skill's file, read it again and follow the new version.

A ticket is a GitHub issue on this repo. The worker who builds it never talks to the person, so every question gets answered here. Read `docs/PROTOCOL.md` first.

**Pick the lane first** (`docs/PROTOCOL.md`, section 2). A fast-lane change is not ticketed: say so and do it in the conversation. A ticket says its lane, normal or heavy, on its first line.

**An issue is done only when `sh scripts/test.sh` passes** and every listed test case exists and passes. A heavy-lane issue also needs the worker to break the code once on purpose and watch the tests fail.

## Steps

1. **Read first.** `docs/PROTOCOL.md`, the last entries of `docs/DEVLOG.md` (and `docs/DECISIONS.md`, `docs/FINDINGS.md` if the team keeps them), `FOCUS.md`, and the files the request touches. Anything those answer is not a question for the person.
2. **Check it against `FOCUS.md`.** If the request does not serve the goal, say so in one line and ask whether to continue.
3. **Split** into one issue per sitting of work. If two would edit the same files, make one depend on the other.
4. **Ask until nothing is left to guess.** One question at a time, each with your recommended answer. Stop when a stranger could build it.
5. **Design the tests before writing the issue.** Name the test file and list each case with its input and expected result. Cover the happy path and the cases that would embarrass the team on interview day. Size the tests to the lane: a normal ticket gets a handful of cases; edge sweeps, fault injection and a chain-test issue are for the heavy lane. Never write a test of a document's wording or of the process itself.
6. **Write each issue** with these sections, every one filled in: Lane, Goal, Touches, Must not touch, Settled choices, Acceptance criteria, Edge cases, Test cases, Test command, Depends on. If the repo has `.github/ISSUE_TEMPLATE/task.md`, use its sections instead.
7. **File it.**

```bash
gh issue create --title "<title>" --body-file <file> --label ready
```

If the label does not exist yet, create it once with `gh label create ready`.

8. **Report** the issue links in one short list. Add `queued` only if the person said to build it now.

No em dashes or en dashes.
