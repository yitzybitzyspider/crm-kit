# CRM Kit

A research CRM for a student team doing customer discovery. It gives you:

- **A team hub:** a web app (a fork of Atomic CRM) on your own Supabase database, where everyone tracks people, outreach and interviews.
- **A command line,** `scripts/hub.py`, that writes to the hub with your own sign-in.
- **Claude skills** that log interviews and outreach for you while you talk.
- **A playbook:** how to interview, how to track hypotheses, and how to build the hub without drowning in process.

## Start here

1. Click **Use this template** on GitHub to make your team's own copy. Keep it private: it will hold real people's details.
2. Clone your copy and open it in Claude Code.
3. Type `/setup`. The [setup skill](.claude/skills/setup/SKILL.md) walks each teammate from a fresh clone to ready for their first interview, one checked step at a time.
4. The first teammate also creates the database: [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md).

## What to read

| Doc | What it is for |
|---|---|
| [FOCUS.md](FOCUS.md) | Your team's goal and the few things that matter. Fill it in first. |
| [docs/INTERVIEWING.md](docs/INTERVIEWING.md) | How to run an interview: listen, do not ask; keep transcripts verbatim; no blame. |
| [hypotheses/_TEMPLATE.md](hypotheses/_TEMPLATE.md) | The hypotheses table, with the nine business model canvas buckets explained. |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | How the hub itself gets changed: three lanes, sized by risk. |
| [docs/LESSONS.md](docs/LESSONS.md) | What we learned building the first version, so you can skip our mistakes. |
| [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md) | Create your own Supabase project with Google sign-in. |
| [docs/DEVLOG.md](docs/DEVLOG.md) | One line per real change to the system. |

## Skills

Type these in Claude Code inside the repo:

- `/setup`: get a teammate ready, from clone to first interview.
- `/sync`: bring an interview into the hub, from a recording tool or pasted notes, with the whole transcript.
- `/outreach`: log who you contacted and what needs a follow-up.
- `/focus`: set or check the team's goal in `FOCUS.md`.
- `/ticket` and `/router`: turn a change to the hub into an issue and hand it to a worker.

Every skill pulls the latest from GitHub when it starts, so a fix one teammate pushes reaches everyone.

## Rules that matter most

- Transcripts go in word for word. Interpretation goes in the overview.
- Describe what people said they saw and did. Do not blame anyone.
- Nothing about a real person leaves the team without their consent.
- Measure progress by your `FOCUS.md` goal, not by how much you built.
