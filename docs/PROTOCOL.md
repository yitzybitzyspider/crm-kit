# How this repo gets changed

There are two kinds of change, and they take different paths.

## 1. Content: straight to `main`

Hypotheses, research notes and anything else you write as files go straight to `main`. People, touches and interviews are rows in the database, entered through the app or the skills (`/crm-sync`, `/crm-outreach`), never files.

## 2. The system: three lanes, by risk

The system is anything that changes how the hub works: `.claude/`, `scripts/`, `.github/`, `.githooks/`, `app/`, any `_TEMPLATE.md`, `CLAUDE.md`, `README.md`, `docs/`.

Pick the lane by asking: what breaks if this change is wrong?

| Lane | What | How |
|---|---|---|
| **Fast** | Docs, wording, branding, skill text, one-line fixes, anything a revert undoes with no harm | Do it in the conversation where the idea came up. Commit (the hook runs the quick checks), push. No issue, no worker, no full test run. |
| **Normal** | App screens, scripts, workflows, new features | `/crm-ticket` writes one issue, `/crm-router` hands it to one worker. Tests first, run the tests for the parts it touches, a draft pull request, one push, merge on green. One line in `docs/DEVLOG.md`. |
| **Heavy** | Database migrations, sign-in, row security, anything touching real people's data, going live | As normal, plus: break the code once on purpose and watch the tests fail, run the full suite, have a second session check the work, and a person merges. |

When unsure, take the faster lane that is still safe. If a mistake would only cost a revert, it is fast.

## The normal and heavy path

1. **Scope** it: talk it through until you know what done looks like.
2. **Ticket** it with `/crm-ticket`: one GitHub issue per sitting of work, complete enough that a worker never has to ask anything.
3. **Route** it with `/crm-router`: the router hands each queued issue to a worker session and checks what comes back. The router does not do the work itself.

### What a worker does

- **Claim.** Label the issue `in-progress`. Work in its own git worktree, never in the shared checkout.
- **Build.** The issue is the whole spec. Write the tests first, then the code.
- **Land.** Open a pull request that closes the issue. Its description says what changed, how it was checked, and what was not checked.
- **Stuck.** If only a person can decide, stop and say so in one message with two options and a pick.

## Logs

- `docs/DEVLOG.md`: one line per normal or heavy change.
- A decisions log, only for a real choice between options.
- A findings log, only for a surprise, with the rule that follows from it.

All logs are append only. A wrong entry is fixed by a new entry, never by editing the old one.

## Rules for both paths

- Person and interview rows are never deleted.
- Stage files by path. Never `git add -A`.
- The process serves the goal in `FOCUS.md`. Before adding a rule, a check or a test of the process itself, ask whether it moves the goal.

## Labels

`ready` fully written. `queued` build it now. `in-progress` a worker has it. `blocked` waiting on something named in a comment. `needs-human-merge` a person merges it.
