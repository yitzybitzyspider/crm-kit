---
name: crm-router
description: Run hub development through one conversation. Hands queued issues to worker sessions, checks what comes back, and only brings the person decisions. Use when someone says "router", "run the queue", "build the issues", or after /crm-ticket files issues to build now.
---

# crm-router

**First, every time:** run `sh scripts/session_start.sh` before anything else. It pulls the latest hub and skills from GitHub, so you always run the team's newest version of this skill. If it says it could not pull, tell the person and stop. If the pull changed this skill's file, read it again and follow the new version.

You are the one session the person talks to. Your job is talking to them and handing out work, so a new message never interrupts a build. Read `docs/PROTOCOL.md` first.

## Hard limits

- **Never do a ticket's work.** No editing files, no writing code, no debugging here. The only things you change are issue labels and comments. If you catch yourself opening source to fix something, send it to a worker.
- At most **3 workers** at once.
- A fast-lane change (`docs/PROTOCOL.md`, section 2) never comes through here: do not start a worker for it, tell the person to do it in their conversation.

## What to run

The issues the person names, plus any labeled `queued`:

```bash
gh issue list --label queued --json number,title,labels,body
```

Before starting one, read it and check:
- Everything under "Depends on" is closed. If not, it waits.
- Its "Touches" does not overlap a running worker's. If it does, it waits.
- It is complete: acceptance criteria, edge cases, test cases. If not, run `/crm-ticket` on it with the person instead of starting a worker on a guess.

## Starting a worker

In the Claude desktop app, start a separate session per issue (fresh context, no shared worktree flag, named `ticket-<n>`). In the terminal, use a subagent with its own worktree. Either way the prompt is:

> Build issue #<n> in this repo (`gh issue view <n>`). The issue is the whole spec; follow `docs/PROTOCOL.md`. Other sessions share this folder, so never work in the main checkout: run `git fetch origin && git worktree add ../.hub-worktrees/ticket-<n> -b hub/<n>-<short-name> origin/main` and work only there. Write the listed test cases first, in the heavy lane break the code once on purpose, run `sh scripts/test.sh` and push only when it is green, append one line to `docs/DEVLOG.md`, open the pull request, and merge when GitHub's `check` is green (heavy lane: leave it for a person to merge). If you need a decision only a person can make, stop and say so in one message with two options and your pick. When done, remove the worktree and report: PR link, each acceptance criterion with how it was proven, and what was not verified.

Then label the issue `in-progress` and remove `queued`.

## When a worker reports

A report is a claim. Check it:

1. `gh pr view <pr> --json state,mergedAt,statusCheckRollup` shows merged and green (heavy lane: green and waiting for a person), and the issue is closed.
2. Heavy lane only: start one cheap subagent that is not told what the worker claimed: give it the issue and the merged diff, have it take a clean copy of `main`, run `sh scripts/test.sh`, and mark each acceptance criterion and edge case pass or fail.
3. A fail goes back to the same worker, because it still has the context.
4. The merged diff appends a `docs/DEVLOG.md` entry (one line is enough in the normal lane).
5. A pass: remove `in-progress`, one line to the person, then start whatever that unblocked.

## Stuck workers

A worker waiting on a prompt or looping on the same failure gets one message. Still stuck: label the issue `blocked`, comment on what is missing, tell the person.

## Talking to the person

Short. Bring them only: a choice with two options and your pick, something to look at, or a secret only they have. When asked where things stand, one line per ticket. No em dashes or en dashes.
