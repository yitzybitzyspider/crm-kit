# Team hub: rules for Claude

A shared customer discovery hub for a small team: who you have talked to, every touch, and every interview, with its transcript. Read `FOCUS.md` first and work against it. If there is none, offer once to run `/crm-focus`.

## Where the hub's data lives

The hub's database is the source of truth for people, touches, interviews and the inbox. The app sits on top of it, at the `address` in `hub.json`. You write to it only through `python3 scripts/hub.py`, which calls the database's fixed actions with the teammate's own sign-in. `/crm-sync` and `/crm-outreach` say how.

To read the hub's data, use `db/` if it exists: the markdown copy of the database, written by the export job. `db/` is never edited by hand. For anything newer, or while there is none, ask with `python3 scripts/hub.py find` or `python3 scripts/hub.py list`.

The team (handles, names, person code prefixes) and the categories of people you talk to are in `team.json`.

## Who is using you

The teammate is whoever is signed in to the hub. `python3 scripts/hub.py whoami` prints their handle. If it says to sign in, tell the person to type `! python3 scripts/hub.py login` (or to run it in their own terminal). It opens Google in their browser; no password is needed. You cannot sign in for them: never run `login` yourself, and never ask for, type or pass a password or a secret key.

If the person says "set me up", or is new to the hub, or `hub.json` is missing, run `/crm-setup`.

## Git, every time you change files

Content that is still files (`hypotheses/`, research notes, `FOCUS.md`) goes straight to `main`. People, touches and interviews are rows in the database and need no git step at all.

1. `git pull --rebase` before you start.
2. Stage only the files you wrote, by path. Never `git add -A` or `git add .`.
3. Run `python3 scripts/check.py`. Fix what it reports before committing.
4. Commit with a short message, push to `main`. If the push is rejected, `git pull --rebase` and push again.

The person should never need to type a git command.

**A change to a skill (`.claude/skills/`) is committed and pushed in the same turn it is made.** Every skill starts by pulling from GitHub, so a pushed change reaches every teammate on their next run, and an unpushed one reaches nobody.

## Updates from the template

This repo was made from a template. To take later improvements to the skills, scripts and docs, run `sh scripts/update_from_template.sh`. It shows the changes and applies them only after the person types yes; a file the team changed is kept as theirs. Never run it unasked, and never answer its question for the person.

## What keeps entries correct

1. **The database's rules and fixed actions.** Every write goes through a fixed action that checks it; a person or interview is never deleted; a transcript is stored whole.
2. **The audit table.** Every change to the hub's rows is recorded with who made it.
3. **The checks.** Opening the folder runs `scripts/session_start.sh`: it pulls the team's latest work and skills, lists anything on this machine not yet pushed (offer to push it before anything else), and says when the teammate is not signed in. Every commit runs `scripts/check.py` through a git hook.
4. **The logs.** `scripts/check_logs.py` refuses an edit to an old log line, a hand edit under `db/`, or a skill not named below.

A session is not finished while `git status` shows changes or unpushed commits.

## Content rules

- Transcripts go in verbatim. Never tidy, shorten or paraphrase a transcript. The overview is where interpretation goes.
- In overviews, quotes must be word for word from the transcript.
- Describe what people said they saw and did. Do not assign blame to the people they describe.
- Check a person's `quote_by_name` before their name leaves the team.
- No em dashes or en dashes anywhere.

## How the system itself gets changed

Adding research is content: it goes straight to `main`. Changing how the hub works (`.claude/`, `scripts/`, `.github/`, `.githooks/`, `app/`, `CLAUDE.md`, `README.md`, `docs/`) goes in one of three lanes, by risk. Details in `docs/PROTOCOL.md`.

- **Fast:** docs, wording, skill text, one-line fixes. Do it here, in this conversation: commit (the hook runs the checks), push.
- **Normal:** app screens, scripts, features. `/crm-ticket` then `/crm-router`, one worker, one push.
- **Heavy:** migrations, sign-in, row security, real people's data. As normal, plus the full suite, an independent check, and a person merges.

The process serves `FOCUS.md`, never the other way round. Before adding a rule, a check or a test of the process itself, ask whether it moves the goal.

Logs: one line in `docs/DEVLOG.md` for a normal or heavy change. All logs are append only.

## Skills

- `/crm-setup`: walk a teammate from a fresh copy to ready for their first interview, and stand the hub up the first time.
- `/crm-sync`: bring interviews into the hub's database from Granola or from pasted notes, with the whole transcript.
- `/crm-outreach`: record who the team has contacted, log each touch, and answer what needs a follow-up or waits in the inbox.
- `/crm-focus`: set the team's goal and vital few in `FOCUS.md`, and catch drift.
- `/crm-ticket`: write a change to the system as issues.
- `/crm-router`: hand queued issues to workers and check their work.
