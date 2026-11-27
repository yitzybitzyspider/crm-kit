---
name: crm-setup
description: Walk a teammate from a fresh copy of the team hub to ready for their first synced interview, and walk the first teammate through standing the hub up. Use when someone says "/crm-setup", "set me up", "get me started", "I just cloned this", "how do I start", or is new to the hub.
---

# crm-setup

**First, every time:** run `sh scripts/session_start.sh` before anything else. It pulls the team's latest work and skills from GitHub, so you always run the team's newest version of this skill. If it says it could not pull, tell the person and stop. If the pull changed this skill's file, read it again and follow the new version.

Takes a teammate from a fresh copy of this repo to ready for their first `/crm-sync`, one step at a time. The teammate may never have used a terminal: say each instruction as one plain action and what they should see.

## How to run it

- **One step at a time, checked before the next.** Do the check yourself wherever you can. Where only the person can see the result (a browser page), ask them to tell you.
- **A step that fails:** say in one plain sentence what to do, then stop at that step. Never skip ahead. When they say it is done, check that step again and carry on.
- **Already set up:** a step that already passes is not redone. Say "already done" in a few words and move on. A teammate who is signed in gets through in under a minute.
- **Never run `python3 scripts/hub.py login` yourself, never ask for a password, never type or pass one.** Only the person signs in.
- **Never ask for or paste a secret key.** The only key that goes in this repo is the publishable key, which is public by design.
- **Windows:** if `python3` is not found but `python` is, use `python` for every command here and tell them to do the same.
- "The administrator" is the teammate who set the hub up (step 3).
- No em dashes or en dashes in anything you say or write.

## 1. The tools are there

Run `python3 --version` and `git --version`.

- Both print a version: done.
- `python3` missing on a Mac: tell them to run `xcode-select --install` in a terminal (it brings both Python and git), then say when it finishes.
- `python3` missing on Windows: install Python from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
- `git` missing on Windows: install it from https://git-scm.com/download/win .

## 2. The latest, and the checks switched on

Run `git pull --rebase`.

- "Already up to date" or a list of changes: good.
- "Repository not found", "could not read from remote" or "permission denied": they have not accepted the GitHub invite to the team's repo, or git is signed in as another GitHub account. Tell them to accept the invite (in their GitHub notifications and email), then say so. Stop here.
- Asks for a GitHub sign-in: tell them to run `git pull` once in their own terminal, sign in when asked, and say when it is done.

Then run `git config core.hooksPath`. It should print `.githooks`. If it prints nothing, run `sh scripts/session_start.sh` and look again.

## 3. Is the hub stood up yet?

Run `python3 scripts/hub_config.py check`.

- Exit 0: the hub exists. Go to step 4.
- Anything else: nobody has stood the hub up yet. Ask: "Are you the one setting up the hub for your team?"
  - No: tell them to ask whoever is setting it up, and stop here.
  - Yes: walk them through 3a to 3d, one at a time.

### 3a. The team

Open `team.json` with them. Replace the placeholder members with the real team: for each, a `handle` (lowercase, such as `sam`), a `name`, and a two letter `id_prefix` (such as `SR`) used in person codes. Change `team_name`, and the `categories` to the kinds of people this team talks to. Run `python3 scripts/team.py sql >/dev/null`: no output means the file is good; one line means fix what it names.

### 3b. The database

Follow `docs/SETUP_SUPABASE.md` with them, step by step: their own free project, the migrations, Google sign-in. Then run `python3 scripts/team.py sql`, and have them paste what it prints into the project's SQL editor and run it. That loads the team and categories. They run it again whenever `team.json` changes.

### 3c. hub.json

Ask for two things from the project settings: the project URL (`https://<something>.supabase.co`) and the publishable key (starts `sb_publishable_`). Never the secret key. Ask where the app will live (its web address; the project URL is fine until they deploy). With your file writing tool write `hub.json`:

```json
{"url": "<project URL>", "publishable_key": "<publishable key>", "address": "<app address>", "live": false}
```

Run `python3 scripts/hub_config.py check` until it exits 0. Then commit `hub.json` and `team.json` by path, run `python3 scripts/check.py`, and push to `main`, as `CLAUDE.md` says. Every teammate gets them on their next pull.

### 3d. Invite the team

Tell them to add each teammate as a collaborator on the GitHub repo, and to add each teammate's Google address on the hub as `docs/SETUP_SUPABASE.md` says. Then carry on with step 4 for themselves.

## 4. The website

Read `address` from `hub.json`. Tell them:

> Open <address>, click "Sign in with Google" and pick the Google account your team uses for this. If Google says it has not verified the app, click Continue. Tell me when you see the People page.

Wait for their answer.

- They see People: done.
- "This Google account is not on the hub's list": they picked another Google account, or the administrator has not added them yet. Ask them to try once more with the right account; if it still says that, tell them to send the administrator the exact Google address they picked, and stop here.
- "Sign in with Google is not switched on for the hub yet": tell them to send the administrator that sentence, and stop here.

## 5. The terminal

Run `python3 scripts/hub.py whoami`.

- It prints a handle and a prefix, such as `alpha (AA)`: already signed in. Go to step 6.
- "sign in: python3 scripts/hub.py login": tell them to type exactly this in the message box here and press return:

  `! python3 scripts/hub.py login`

  A Google page opens in their browser; they pick the same account as on the website. The tab then says they are signed in and can close it. No password. When they say it is done, run `whoami` again.
- "you have no handle yet: ask the administrator": their Google address is not tied to a member of `team.json` yet. Tell them to ask the administrator, and stop here.
- "the hub's address is not set yet": their copy is old. Run `git pull --rebase` and try again; if it still says that, the hub is not stood up (step 3).

Done when `whoami` prints their handle. Say it back: "You are `<handle>` in the hub."

## 6. Interviews: Granola, or pasted notes

`/crm-sync` takes interviews two ways: from Granola, or from a transcript or notes pasted into the conversation. Granola is optional. Ask whether they use it.

- **No:** done. After an interview they paste the transcript or their notes and type `/crm-sync`.
- **Yes:**
  1. Granola installed and signed in. If not: https://www.granola.ai .
  2. The connector: call the `granola` connector's folder list (`list_meeting_folders`, or the tool that lists folders). It answers: done. No `granola` tools, or it says to authenticate: tell them to type `/mcp`, pick `granola`, Authenticate, and sign in in the browser, then list again.
  3. The folder: look for a folder named `Interviews`. If there is none, tell them to make one in Granola and drop every interview's note into it. A meeting with "interview" in its title is found too.
  4. On a free Granola plan the connector gives notes, not the transcript. Then they copy the transcript from the Granola app and paste it when `/crm-sync` asks. Say this once.

## 7. The end

Three lines, plain:

- who they are (their handle);
- what works (website, terminal sign-in, and Granola if they use it);
- what is left, if anything, and who does it.

Then their first task, word for word: "After your next interview, type `/crm-sync`." And: "After you reach out to someone, tell me what you did, or type `/crm-outreach`." If the team has no `FOCUS.md` yet, add: "Type `/crm-focus` to set the goal your team is working toward."

Outside step 3, this skill changes no file in the repo and needs no git step.
