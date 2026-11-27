#!/usr/bin/env python3
"""The hub from the command line: what Claude and the skills use to read and write the database.

    hub.py login [--password [--email E]] | logout | whoami
    hub.py find <text>
    hub.py add --name N [--role R] [--org O] [--contact C ...] [--referred-by X] [--owner H] [--quote-by-name]
    hub.py update --person CODE [--contact C ...] [--role R] [--org O]
    hub.py touch --person CODE --channel C --what TEXT [--by H] [--date D] [--next TEXT] [--due D] [--status S]
    hub.py log --json-file FILE
    hub.py status --person CODE --to S
    hub.py owner --person CODE --to H
    hub.py list [--owner H] [--status S] [--followup]
    hub.py recording known --ids ID[,ID...]
    hub.py recording submit --meta FILE --pages DIR --overview FILE --consent yes|no|unknown [--hypotheses FILE] [--kind K]
    hub.py recording paste --person CODE --date D --title T --transcript FILE --overview FILE --consent yes [--hypotheses FILE] [--kind K]
    hub.py inbox list
    hub.py inbox confirm --id N --person CODE --consent yes [--kind K]
    hub.py inbox dismiss --id N --reason TEXT
    hub.py version

Every free text value (find's text, --name, --role, --org, --contact,
--referred-by, --what, --next, --title, --reason) can instead be read from a
UTF-8 file with the same name plus -file, such as --what-file PATH, or - for
standard input (one option per call). The value is the file byte for byte,
less one trailing newline if it ends in one. Giving both forms is refused.
--contact and --contact-file may each be given several times (issue 64): a
contact file holds one detail a line, blank lines skipped, and every detail
goes to the database as one list, in the order given.

`log` (issue 65) adds a new person and their first touches in one call, all
or nothing: the file holds {"person": {...}, "touches": [...], "request_id":
"<uuid>"} (request_id optional; - reads standard input). The database refuses
the whole call if anything in it is refused, naming the touch. With no
request_id in the file, hub.py makes one from the signed in teammate and the
file's person and touches, so sending the same file again after "not known
whether this was saved" never saves twice.

The kind of an interview (issue 83), --kind: transcript (the default; word
for word, at least 1000 characters), notes (typed or handwritten notes, typed
in as written) or debrief (a teammate talking the interview through
afterwards); notes and a debrief need at least 100 characters. The text
file is still --transcript, whatever the kind.

Every command takes --json. Exit codes: 0 done; 2 refused, with one line
saying why (the database's own sentence when it was the database); 3 not
signed in ("sign in: python3 scripts/hub.py login"); 1 something is broken,
with one line saying what.

How it writes. Only by calling one of the database's fixed write actions
(docs/SCHEMA.md) as the signed in teammate, with via set to claude. It holds
no service key and no database password, takes no SQL, and never writes a
table directly. It reads through find_person and plain reads of the tables
and views a teammate may read.

How a teammate signs in (issue 61). `login` signs in with Google, in the
browser: it opens Supabase's sign-in address with a PKCE challenge, waits on
127.0.0.1:CALLBACK_PORT (that address only) for the browser to come back with
a code, trades the code and the verifier once for a session and keeps only
the session, in ~/.config/crm-kit/session.json (mode 600, never inside a
git checkout). Nobody on the team needs a hub password. `login --password` is
the fallback: it asks for the email and then the password with a hidden
prompt, in a terminal only. The code, the verifier, the tokens and the
password are never an argument, never written but to the session file, and
never printed.

`version` (issue 89) needs no sign-in: it reads the live site's
/version.json and compares it with origin/main through git, run in one
function, git(), from a list of arguments.

Standard library only. Importable: main(argv) returns the exit code, and the
network is touched in one function, transport().
"""
import argparse
import base64
import contextlib
import fcntl
import getpass
import hashlib
import hmac
import http.client
import http.server
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import team  # noqa: E402  (team.json: handles, prefixes, categories)

# The fixed write actions this tool may call (plus the read only find_person).
ACTIONS = ("find_person", "add_person", "update_person", "set_owner", "set_status", "log_touch", "save_interview",
           "submit_recording", "confirm_recording", "dismiss_recording", "add_person_with_touches", "link_interviews")
# The tables and views it may read.
READS = ("sales", "contacts", "companies", "follow_ups", "interviews", "call_inbox", "category_tally")
# The stakeholder categories, in the order the tally prints them, from team.json. The database holds the rule.
CATEGORIES = team.CATEGORIES
TALLY_ROWS = CATEGORIES + ("uncategorized", "total")

SIGN_IN_LINE = "sign in: python3 scripts/hub.py login"
NO_HANDLE_LINE = "you have no handle yet: ask the administrator"
LOCAL_HOSTS = ("localhost", "127.0.0.1")
NO_FOLLOWUP = ("declined", "do-not-contact")   # nobody is told to follow up with these
RENEW_BEFORE = 90          # seconds before its end at which a session is renewed
TIMEOUT = 120              # seconds; a long transcript is one large request
PAGE_ROWS = 1000           # rows per read; the API gives no more than this at once
MIN_TRANSCRIPT = 1000      # characters; shorter is notes, not a transcript
MIN_NOTES = 100            # characters, for notes and a debrief (issue 83)
KINDS = ("transcript", "notes", "debrief")
PAGE_NAME = re.compile(r"^page-(\d+)\.json$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Sign-in with Google (issue 61).
CALLBACK_PORT = 52741      # the one port the browser comes back to, on 127.0.0.1 only
CALLBACK_PATH = "/callback"
LOGIN_WAIT = 180           # seconds the browser has to come back; the tests set it shorter
VERIFIER = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")
# The website's sentences, word for word (app/src/components/kit/googleSignIn.ts, issue 58).
GOOGLE_NOT_ON_LIST = "This Google account is not on the team hub's list. Ask your hub administrator to add you."
GOOGLE_OFF = "Sign in with Google is not switched on for the hub yet. Sign in with your email and password, or ask your hub administrator."
GOOGLE_CANCELLED = "Google sign-in was cancelled. Nothing was changed."
GOOGLE_FAILED = "Google sign-in did not work. Try again, or sign in with your email and password."
GOOGLE_UNREACHABLE = "The hub's sign-in service did not answer. Check your connection and try again."
SIGNED_IN_PAGE = "Signed in to the team hub. You can close this tab."
WRONG_STATE = ("that answer did not come from this sign-in, so it was refused and nothing was changed: "
               "run python3 scripts/hub.py login again")
PORT_TAKEN = ("port %d on this computer is already in use, perhaps by another hub.py login: "
              "close that one and try again. Nothing was changed")


# Which version is live (issue 89). The site's address comes from hub.json; the
# paths are the ones whose change starts the deploy (.github/workflows/deploy.yml).
DEFAULT_SITE = "https://hub.example.org"
DEPLOY_PATHS = ("app", "hub.json", "scripts/hub_config.py", "scripts/golive_check.py", "scripts/live_test_golive.py",
                ".github/workflows/deploy.yml")
PR_IN_SUBJECT = (re.compile(r"\(#(\d+)\)\s*$"), re.compile(r"^Merge pull request #(\d+)\b"))
SHA = re.compile(r"^[0-9a-f]{40}$")


class Refused(Exception):
    """Exit 2: the request was understood and turned down. One line."""


class NotSignedIn(Exception):
    """Exit 3: there is no session, or it ended."""


class Broken(Exception):
    """Exit 1: something did not work. One line, nothing half done."""


class Unreachable(Exception):
    """The hub did not answer. sent says whether the request may have reached it."""

    def __init__(self, sent):
        super().__init__("the hub did not answer")
        self.sent = sent


# ---------- the network: one function ----------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is never followed: the sign-in must not travel to another address."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def transport(method, url, headers, body, timeout):
    """Send one request. Returns (status, text). Raises Unreachable. The tests replace this."""
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with opener.open(request, timeout=timeout) as answer:
            return answer.status, answer.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        try:
            return error.code, error.read().decode("utf-8", "replace")
        except (OSError, http.client.HTTPException):
            raise Unreachable(sent=True) from None
    except urllib.error.URLError as error:
        never_left = isinstance(error.reason, (ConnectionRefusedError, socket.gaierror))
        raise Unreachable(sent=not never_left) from None
    except (OSError, http.client.HTTPException):
        raise Unreachable(sent=True) from None


def git(*args):
    """Run git in this checkout. Returns (exit code, output). The tests replace this."""
    try:
        done = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return 127, "git did not run"
    return done.returncode, done.stdout if done.returncode == 0 else done.stderr


# ---------- small helpers ----------

def one_line(text, limit=400):
    """Text from the database or a stranger, made safe to print on one line."""
    flat = " ".join("".join(ch if ch.isprintable() or ch in "\n\t\r" else " " for ch in str(text)).split())
    return flat if len(flat) <= limit else flat[:limit - 3] + "..."


def need_date(value, flag):
    try:
        if not DATE.match(value or ""):
            raise ValueError
        date.fromisoformat(value)
    except ValueError:
        raise Refused("%s must be a date as YYYY-MM-DD, not '%s'" % (flag, one_line(value, 40))) from None
    return value


def read_text(path, what):
    """A file's text exactly as it is on disk: no line ending is changed."""
    try:
        with open(path, "r", encoding="utf-8", newline="") as handle:
            return handle.read()
    except UnicodeDecodeError:
        raise Refused("the %s file is not UTF-8 text: %s" % (what, path)) from None
    except OSError as error:
        raise Refused("the %s file cannot be read: %s (%s)" % (what, path, error.strerror or "error")) from None


def read_json(path, what):
    try:
        return json.loads(read_text(path, what))
    except ValueError:
        raise Refused("the %s file is not JSON: %s" % (what, path)) from None


# ---------- where the hub is ----------

class Config:
    def __init__(self, url, key):
        self.url, self.key = url, key
        self.local = urllib.parse.urlsplit(url).hostname in LOCAL_HOSTS


def hub_home():
    """The folder that holds the session. Never inside a git checkout."""
    given = os.environ.get("CRM_KIT_HOME")
    home = Path(given).expanduser() if given else Path.home() / ".config" / "crm-kit"
    home = Path(os.path.abspath(home))
    for folder in (home, *home.parents):
        if (folder / ".git").exists():
            raise Refused("the hub folder %s is inside a git checkout (%s): a session is never kept in a repo" % (home, folder))
    return home


def _checked(url, key, source):
    if not isinstance(url, str) or not isinstance(key, str) or not url.strip() or not key.strip():
        raise Broken("the hub's address or public key in %s is empty" % source)
    url, key = url.strip().rstrip("/"), key.strip()
    try:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname
    except ValueError:
        parts, host = None, None
    if not host or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        raise Broken("the hub's address in %s is not a plain web address" % source)
    if parts.scheme != "https" and not (parts.scheme == "http" and host in LOCAL_HOSTS):
        raise Broken("the hub's address in %s must be https" % source)
    if key.startswith("sb_secret_") or _token_claim(key, "role") == "service_role":
        raise Broken("the key in %s is not the public key: this tool never holds a service key" % source)
    return Config(url, key)


def load_config(home):
    """First found wins: the environment, the hub folder's config.json, hub.json in the repo."""
    url, key = os.environ.get("CRM_KIT_URL"), os.environ.get("CRM_KIT_KEY")
    if url or key:
        if not (url and key):
            raise Broken("set both CRM_KIT_URL and CRM_KIT_KEY, or neither")
        return _checked(url, key, "the environment")
    for path, source in ((home / "config.json", "the hub folder's config.json"), (ROOT / "hub.json", "hub.json")):
        if path.is_file():
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise Broken("%s cannot be read as JSON" % source) from None
            if not isinstance(doc, dict):
                raise Broken("%s is not a JSON object" % source)
            return _checked(doc.get("url"), doc.get("publishable_key"), source)
    raise Broken("the hub's address is not set yet")


# ---------- the session ----------

def _token_claim(token, claim):
    """One claim of a token's middle part, or None. Used to learn whose sign-in this is."""
    try:
        middle = token.split(".")[1]
        doc = json.loads(base64.urlsafe_b64decode(middle + "=" * (-len(middle) % 4)))
        return doc.get(claim) if isinstance(doc, dict) else None
    except (IndexError, ValueError, AttributeError, TypeError):
        return None


def _read_session(home, cfg):
    path = home / "session.json"
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("url") != cfg.url:
        return None   # a session made for another hub is never sent to this one
    if not all(isinstance(doc.get(k), str) and doc.get(k) for k in ("access_token", "refresh_token")):
        return None
    if not isinstance(doc.get("expires_at"), (int, float)):
        return None
    return doc


def _make_home(home):
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(home, 0o700)


def _write_session(home, cfg, answer):
    """Keep the session and nothing else: two tokens and when the first one ends."""
    access, refresh = answer.get("access_token"), answer.get("refresh_token")
    if not (isinstance(access, str) and access and isinstance(refresh, str) and refresh):
        raise Broken("the hub's sign-in answer was not what was expected")
    ends = answer.get("expires_at")
    if not isinstance(ends, (int, float)):
        lasts = answer.get("expires_in")
        ends = time.time() + (lasts if isinstance(lasts, (int, float)) else 0)
    doc = {"url": cfg.url, "access_token": access, "refresh_token": refresh, "expires_at": int(ends)}
    _make_home(home)
    partial = home / ("session.json.%d.tmp" % os.getpid())
    handle = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(handle, 0o600)
        os.write(handle, json.dumps(doc).encode("utf-8"))
    finally:
        os.close(handle)
    os.replace(partial, home / "session.json")
    return doc


@contextlib.contextmanager
def _locked(home):
    """One run at a time renews the session, so a refresh token is spent once."""
    _make_home(home)
    handle = os.open(home / "session.lock", os.O_WRONLY | os.O_CREAT, 0o600)
    try:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield
    finally:
        os.close(handle)


def current_session(cfg, home):
    """The stored session, renewed first when it is near its end. Raises NotSignedIn."""
    session = _read_session(home, cfg)
    if session is None:
        raise NotSignedIn()
    if session["expires_at"] - time.time() > RENEW_BEFORE:
        return session
    with _locked(home):
        session = _read_session(home, cfg)   # another run may have renewed it while this one waited
        if session is None:
            raise NotSignedIn()
        if session["expires_at"] - time.time() > RENEW_BEFORE:
            return session
        status, text = send(cfg, "POST", "/auth/v1/token?grant_type=" + "refresh_token", body={"refresh_token": session["refresh_token"]})
        if status in (400, 401, 403):
            raise NotSignedIn()   # the session ended, or another run already spent this refresh token
        answer = _json(text)
        if status != 200 or not isinstance(answer, dict):
            raise Broken("the hub could not renew the session (HTTP %d)" % status)
        return _write_session(home, cfg, answer)


# ---------- requests ----------

def _json(text):
    try:
        return json.loads(text)
    except ValueError:
        return None


def send(cfg, method, path, token=None, body=None, write=False):
    """One request to the hub. Returns (status, text). Never sent twice."""
    headers = {"apikey": cfg.key, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        status, text = transport(method, cfg.url + path, headers, data, TIMEOUT)
    except Unreachable as error:
        if write and error.sent:
            raise Broken("not known whether this was saved: the hub did not answer. Look before doing it again") from None
        raise Broken("could not reach the hub" + ("" if error.sent else ": nothing was sent")) from None
    return status, text


def _answer(status, text):
    """The parsed answer of a call, or the right exception for what came back."""
    parsed = _json(text)
    if status == 401:
        raise NotSignedIn()
    if 200 <= status < 300:
        if parsed is None and text.strip() not in ("", "null"):
            raise Broken("the hub's answer was not what was expected (HTTP %d, not JSON)" % status)
        return parsed
    message = parsed.get("message") if isinstance(parsed, dict) else None
    if status == 400 and isinstance(message, str) and message.strip():
        if message.startswith("sign in first: this action is for a signed in teammate"):
            raise NotSignedIn()
        if message.strip() == "this teammate has no handle yet":
            raise Refused(NO_HANDLE_LINE)
        raise Refused(one_line(message))
    raise Broken("the hub's answer was not what was expected (HTTP %d)" % status)


def call_action(cfg, session, name, args):
    """Call one fixed action as the signed in teammate, with via claude. The only way this tool writes."""
    if name not in ACTIONS:
        raise Broken("'%s' is not a fixed action this tool may call" % name)
    body = {key: value for key, value in args.items() if value is not None}
    body["via"] = "claude"
    status, text = send(cfg, "POST", "/rest/v1/rpc/" + name, token=session["access_token"], body=body, write=name != "find_person")
    return _answer(status, text)


def read(cfg, session, table, params):
    """Read rows of one table or view the teammate may read. Every page of them."""
    if table not in READS:
        raise Broken("'%s' is not a table this tool may read" % table)
    rows, start = [], 0
    while True:
        query = urllib.parse.urlencode(dict(params, limit=PAGE_ROWS, offset=start), quote_via=urllib.parse.quote)
        status, text = send(cfg, "GET", "/rest/v1/" + table + "?" + query, token=session["access_token"])
        page = _answer(status, text)
        if not isinstance(page, list):
            raise Broken("the hub's answer was not what was expected (no list of %s)" % table)
        rows += page
        if len(page) < PAGE_ROWS:
            return rows
        start += PAGE_ROWS


def _need(answer, *keys):
    if not isinstance(answer, dict) or any(key not in answer for key in keys):
        raise Broken("the hub's answer was not what was expected: look before doing it again")
    return answer


def _in_list(values):
    """A list of text values for a filter, each quoted so nothing in it is read as syntax."""
    return "in.(" + ",".join('"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"' for v in values) + ")"


# ---------- the transcript pages ----------

def _page(path, number):
    """One saved page of the connector's answer: its text and what it says about itself."""
    try:
        with open(path, "r", encoding="utf-8", newline="") as handle:
            doc = json.load(handle)
    except (OSError, ValueError):
        raise Refused("page %d (%s) is not JSON: save the connector's answer to it unchanged" % (number, path.name)) from None
    if isinstance(doc, list) and len(doc) == 1 and isinstance(doc[0], dict) and isinstance(doc[0].get("text"), str):
        doc = _json(doc[0]["text"])   # the answer as a tool hands it over: one block of text holding the JSON
    if isinstance(doc, dict) and isinstance(doc.get("meetings"), list):
        if len(doc["meetings"]) != 1:
            raise Refused("page %d holds %d meetings: fetch one meeting per call" % (number, len(doc["meetings"])))
        doc = doc["meetings"][0]
    if not isinstance(doc, dict):
        raise Refused("page %d (%s) is not the connector's answer for one meeting" % (number, path.name))
    text = doc.get("transcript")
    if not isinstance(text, str):
        why = doc.get("transcript_unavailable")
        why = why.get("reason") if isinstance(why, dict) else why
        raise Refused("page %d has no transcript%s: nothing is saved without the transcript"
                      % (number, " (%s)" % one_line(why, 60) if why else ""))
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        raise Refused("page %d holds half a character: it was cut in the middle of one" % number) from None
    total, truncated, following = doc.get("total_chars"), doc.get("truncated"), doc.get("next_offset")
    if not isinstance(total, int) or isinstance(total, bool) or total < 0:
        raise Refused("page %d does not say the transcript's total size (total_chars)" % number)
    if not isinstance(truncated, bool):
        raise Refused("page %d does not say whether more follows (truncated)" % number)
    if truncated and (not isinstance(following, int) or isinstance(following, bool)):
        raise Refused("page %d says more follows but not where the next page begins (next_offset)" % number)
    own = doc.get("offset")
    own = own if isinstance(own, int) and not isinstance(own, bool) else None
    meeting = next((doc[k] for k in ("meeting_id", "note_id", "id") if isinstance(doc.get(k), str)), None)
    return {"text": text, "total": total, "truncated": truncated, "next": following, "offset": own, "meeting": meeting}


def join_pages(folder, granola_id=None, without_id=False):
    """The whole transcript from a folder of saved pages, proven complete. Returns (text, reported total).

    The connector counts offsets and the total in characters (its page size is
    in bytes, which is a different thing), so every comparison here is in
    characters. Refused, naming the page: a missing page, a gap, an overlap, a
    page out of order, a last page that says more follows, a total that is short.
    Pages that carry no meeting id at all are refused when the meta file names
    a meeting, unless the teammate confirmed they are of it (without_id).
    """
    folder = Path(folder)
    if not folder.is_dir():
        raise Refused("no page folder at %s" % folder)
    found = {}
    for path in folder.iterdir():
        match = PAGE_NAME.match(path.name)
        if match:
            if int(match.group(1)) in found:
                raise Refused("page %d is there twice (%s and %s)" % (int(match.group(1)), found[int(match.group(1))].name, path.name))
            found[int(match.group(1))] = path
    if not found:
        raise Refused("no page files in %s: they are named page-0001.json, page-0002.json and so on" % folder)
    count = max(found)
    for number in range(1, count + 1):
        if number not in found:
            raise Refused("page %d is missing: the folder has pages up to %d" % (number, count))
    pages = [_page(found[number], number) for number in range(1, count + 1)]
    carrying = [number for number, page in enumerate(pages, 1) if page["meeting"]]
    if carrying and len(carrying) != count:
        bare = next(number for number in range(1, count + 1) if number not in carrying)
        raise Refused("page %d carries no meeting id but page %d does: the pages are from two fetches, fetch them all again"
                      % (bare, carrying[0]))
    if granola_id and not carrying and not without_id:
        raise Refused("no page carries a meeting id, so nothing shows they are of the meeting the meta file names (%s). "
                      "Ask the teammate whether these pages are of that meeting; only on their yes run the same command "
                      "again with --pages-without-id" % one_line(granola_id, 80))
    for number, page in enumerate(pages, 1):
        if granola_id and page["meeting"] and page["meeting"] != granola_id:
            raise Refused("page %d is from another meeting than the one in the meta file" % number)
        if page["meeting"] and page["meeting"] != pages[0]["meeting"]:
            raise Refused("page %d is from another meeting than page 1" % number)
    parts, at, total = [], 0, None
    for number in range(1, count + 1):
        page = pages[number - 1]
        if total is None:
            total = page["total"]
        elif page["total"] != total:
            raise Refused("page %d says the transcript is %d characters, the pages before it said %d" % (number, page["total"], total))
        if page["offset"] is not None and page["offset"] != at:
            raise Refused("page %d begins at %d, but the page before it ended at %d: a page is missing, repeated or out of order"
                          % (number, page["offset"], at))
        parts.append(page["text"])
        at += len(page["text"])
        last = number == count
        if page["truncated"]:
            if last:
                raise Refused("page %d is the last one here and says more follows from %d: fetch the rest" % (number, page["next"]))
            if page["next"] != at:
                raise Refused("page %d ends at %d but says the next page begins at %d: a %s, or a page repeated or out of order"
                              % (number, at, page["next"], "gap" if page["next"] > at else "overlap"))
        elif not last:
            raise Refused("page %d says the transcript ends there, but %d more page%s follow%s: pages are out of order or from two fetches"
                          % (number, count - number, "" if count - number == 1 else "s", "s" if count - number == 1 else ""))
    text = "".join(parts)
    if at != total:
        other = ""
        if len(text.encode("utf-8")) == total:
            other = " (it does fit counted in bytes: the recorder's unit is not characters, tell whoever looks after the hub)"
        elif len(text.encode("utf-16-le")) // 2 == total:
            other = " (it does fit counted in UTF-16 units: the recorder's unit is not characters, tell whoever looks after the hub)"
        raise Refused("page %d ends at %d characters but the recorder reported %d: the transcript is %s%s"
                      % (count, at, total, "%d short" % (total - at) if total > at else "%d too long" % (at - total), other))
    return text, total


def _hypotheses(path):
    if not path:
        return None
    doc = read_json(path, "hypotheses")
    if not isinstance(doc, list):
        raise Refused("the hypotheses file must hold a list")
    return doc


def _consent(value, must_be_yes, what, agreed="recorded"):
    if value not in ("yes", "no", "unknown"):
        raise Refused("--consent must be yes, no or unknown")
    if must_be_yes and value != "yes":
        raise Refused("%s needs --consent yes: say so only when the person agreed to be %s" % (what, agreed))
    return {"yes": True, "no": False, "unknown": None}[value]


# ---------- the commands ----------
# Each returns (lines to print, the same as data for --json).

def cmd_login(args, home):
    """Google in the browser by default (issue 61); --password is the fallback, unchanged."""
    if args.password:
        return login_password(args, home)
    if args.email:
        raise Refused("--email goes with --password: with no flags, login signs in with Google in your browser")
    return login_google(args, home)


def login_password(args, home):
    test_password = os.environ.get("HUB_TEST_PASSWORD")
    if not test_password and not sys.stdin.isatty():
        raise Refused("run this yourself in a terminal: python3 scripts/hub.py login")
    cfg = load_config(home)
    if test_password and cfg.local:   # the tests' way in, honoured only for a hub on this machine
        email, password = args.email or os.environ.get("HUB_TEST_EMAIL", ""), test_password
    else:
        if not sys.stdin.isatty():
            raise Refused("run this yourself in a terminal: python3 scripts/hub.py login")
        email = args.email or input("Email: ")
        password = getpass.getpass("Password: ")
    email = email.strip()
    if not email or not password:
        raise Refused("an email and a password are both needed")
    status, text = send(cfg, "POST", "/auth/v1/token?grant_type=" + "password", body={"email": email, "password": password})
    del password
    answer = _json(text)
    if status in (400, 401, 403, 422):
        raise Refused("the hub did not accept that email and password")
    if status != 200 or not isinstance(answer, dict):
        raise Broken("the hub's sign-in answer was not what was expected (HTTP %d)" % status)
    return _signed_in(cfg, _write_session(home, cfg, answer))


def _signed_in(cfg, session):
    try:
        who = _whoami(cfg, session)
    except Refused as error:
        return ["signed in. %s" % error], {"signed_in": True, "handle": None}
    return ["signed in as %s (%s)" % (who["handle"], who["id_prefix"])], dict(who, signed_in=True)


# ---------- sign-in with Google (issue 61) ----------

def pkce_pair():
    """A fresh verifier (64 characters of the allowed set) and its challenge: base64url SHA-256, no padding."""
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    return verifier, challenge


def callback_address(state):
    return "http://127.0.0.1:%d%s?%s" % (CALLBACK_PORT, CALLBACK_PATH, urllib.parse.urlencode({"state": state}))


def authorize_url(cfg, challenge, state, provider="google"):
    """Where the browser starts. It holds the challenge and the state, never the verifier."""
    return cfg.url + "/auth/v1/authorize?" + urllib.parse.urlencode({
        "provider": provider, "redirect_to": callback_address(state),
        "code_challenge": challenge, "code_challenge_method": "s256"})


def open_browser(address):
    """Open the system browser at the address. False when none could be opened. The tests replace this."""
    try:
        return bool(webbrowser.open(address, new=2))
    except webbrowser.Error:
        return False


_NOT_ON_LIST_CODES = ("signup_disabled", "user_not_found", "identity_not_found", "user_banned")
_NOT_ON_LIST_WORDS = (r"^database error (saving|creating) new user\.?$", r"not on the hub's list",
                      r"^sign up is not allowed", r"signups not allowed")
_PROVIDER_OFF_WORDS = (r"provider is not enabled", r"unsupported provider")


def google_refusal(error, code, description):
    """The website's sentence for what Supabase sent back (googleRefusal in googleSignIn.ts). Never its own text."""
    description = (description or "").strip()
    if code in _NOT_ON_LIST_CODES or any(re.search(w, description, re.I) for w in _NOT_ON_LIST_WORDS):
        return GOOGLE_NOT_ON_LIST
    if any(re.search(w, description, re.I) for w in _PROVIDER_OFF_WORDS):
        return GOOGLE_OFF
    if error == "access_denied" and not code:
        return GOOGLE_CANCELLED
    return GOOGLE_FAILED


def _exchange(cfg, home, code, verifier):
    """Trade the code and the verifier once for a session, and keep it. Raises Broken with the website's sentence."""
    try:
        status, text = send(cfg, "POST", "/auth/v1/token?grant_type=" + "pkce", body={"auth_code": code, "code_verifier": verifier})
    except Broken:
        raise Broken(GOOGLE_UNREACHABLE) from None
    answer = _json(text)
    if status == 200 and isinstance(answer, dict):
        return _write_session(home, cfg, answer)
    if 400 <= status < 500 and isinstance(answer, dict):
        said = next((answer[k] for k in ("msg", "error_description", "message") if isinstance(answer.get(k), str)), "")
        raise Broken(google_refusal(str(answer.get("error") or ""), str(answer.get("error_code") or ""), said))
    raise Broken(GOOGLE_FAILED)


class _CallbackServer(http.server.HTTPServer):
    allow_reuse_address = True   # a run that just ended leaves the port waiting a minute; another program on it still refuses


def _callback_server(state, on_code):
    """Listen on 127.0.0.1:CALLBACK_PORT for the one answer whose state matches. Raises Broken when the port is taken."""
    done = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        timeout = 15

        def log_message(self, *args):   # the address holds the code: never logged
            pass

        def _page(self, status, sentence):
            body = ("<!doctype html><meta charset=\"utf-8\"><title>team hub</title><p>%s</p>\n"
                    % sentence.replace("&", "&amp;").replace("<", "&lt;")).encode("utf-8")
            self.send_response(status)
            for name, value in (("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(body))),
                                ("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer")):
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parts = urllib.parse.urlsplit(self.path)
            if parts.path != CALLBACK_PATH or done:
                return self._page(404, "Nothing here.")   # not the callback: ignored, the wait goes on
            query = urllib.parse.parse_qs(parts.query)

            def got(key):
                return (query.get(key) or [""])[0]
            try:
                if not hmac.compare_digest(got("state").encode("utf-8"), state.encode("utf-8")):
                    raise Broken(WRONG_STATE)
                if got("error") or got("error_code") or got("error_description"):
                    raise Broken(google_refusal(got("error"), got("error_code"), got("error_description")))
                if not got("code"):
                    raise Broken(GOOGLE_FAILED)
                done["session"] = on_code(got("code"))
            except Exception as error:   # noqa: BLE001  handed to the main thread, never shown raw to the browser
                done["error"] = error
                self._page(400, str(error) if isinstance(error, Broken) else GOOGLE_FAILED)
                return
            self._page(200, SIGNED_IN_PAGE)

    try:
        server = _CallbackServer(("127.0.0.1", CALLBACK_PORT), Callback)
    except OSError:
        raise Broken(PORT_TAKEN % CALLBACK_PORT) from None
    return server, done


def _wait_words(seconds):
    return "%d minutes" % (seconds // 60) if seconds >= 120 and seconds % 60 == 0 else "%d seconds" % seconds


def login_google(args, home):
    cfg = load_config(home)
    provider = "google"
    test_provider = os.environ.get("HUB_TEST_OAUTH_PROVIDER")
    if test_provider and cfg.local:   # the live tests' stand-in provider, honoured only for a hub on this machine
        provider = test_provider
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(24)
    address = authorize_url(cfg, challenge, state, provider)
    server, done = _callback_server(state, lambda code: _exchange(cfg, home, code, verifier))
    try:
        wait = LOGIN_WAIT
        if open_browser(address):
            print("Signing in with Google in your browser (waiting up to %s). If no tab opened, or it shows the wrong "
                  "Google account, open this address: %s" % (_wait_words(wait), address), file=sys.stderr, flush=True)
        else:
            print("Open this address in your browser to sign in with Google (waiting up to %s): %s"
                  % (_wait_words(wait), address), file=sys.stderr, flush=True)
        ends = time.monotonic() + wait
        while not done:
            left = ends - time.monotonic()
            if left <= 0:
                raise Broken("no answer came back from the browser in %s, so nothing was changed; if the browser ended "
                             "on the hub's website instead, tell your hub administrator the terminal's sign-in address is not set up "
                             "(docs/DEPLOY.md)" % _wait_words(wait))
            server.timeout = left
            server.handle_request()
    finally:
        server.server_close()   # one answer only: a second request finds nobody listening
    if "error" in done:
        raise done["error"]
    return _signed_in(cfg, done["session"])


MIN_PASSWORD = 12


def cmd_password(args, cfg, session):
    """Replace the signed in teammate's password (issue 28). There is no mail
    sender at go-live, and the app's own "change password" sends a mail."""
    test_password = os.environ.get("HUB_TEST_NEW_PASSWORD")
    if test_password and cfg.local:   # the tests' way in, honoured only for a hub on this machine
        password = test_password
    else:
        if not sys.stdin.isatty():
            raise Refused("run this yourself in a terminal: python3 scripts/hub.py password")
        password = getpass.getpass("New password (%d characters or more): " % MIN_PASSWORD)
        if getpass.getpass("The same again: ") != password:
            raise Refused("the two did not match. Nothing was changed")
    if len(password) < MIN_PASSWORD:
        raise Refused("a password needs %d characters or more. Nothing was changed" % MIN_PASSWORD)
    status, text = send(cfg, "PUT", "/auth/v1/user", token=session["access_token"], body={"password": password}, write=True)
    del password
    if status == 401:
        raise NotSignedIn()
    if status in (400, 403, 422):
        raise Refused("the hub did not take that password (too short, too common, or the same as before). Nothing was changed")
    if status != 200:
        raise Broken("the hub's answer was not what was expected (HTTP %d)" % status)
    return ["password changed. Sign in with it from now on"], {"changed": True}


def cmd_logout(args, home):
    try:
        (home / "session.json").unlink()
    except FileNotFoundError:
        return ["already signed out"], {"signed_in": False}
    return ["signed out"], {"signed_in": False}


# ---------- which version is live (issue 89) ----------

def _pr_of(subject):
    for pattern in PR_IN_SUBJECT:
        found = pattern.search(subject)
        if found:
            return int(found.group(1))
    return None


def _site():
    try:
        address = json.loads((ROOT / "hub.json").read_text(encoding="utf-8")).get("address")
    except (OSError, ValueError, AttributeError):
        address = None
    return (address if isinstance(address, str) and address.startswith("https://") else DEFAULT_SITE).rstrip("/")


def _git_or_broken(*args):
    code, text = git(*args)
    if code != 0:
        raise Broken("git %s did not work: %s" % (args[0], one_line(text, 200)))
    return text


def cmd_version(args):
    """The live version, the newest app commit on origin/main, and whether live is behind."""
    url = _site() + "/version.json"
    try:
        status, text = transport("GET", url, {"Accept": "application/json", "User-Agent": "crm-kit-cli"}, None, 30)
    except Unreachable:
        raise Broken("the live version cannot be read: %s did not answer" % url) from None
    if status != 200:
        raise Broken("the live version cannot be read: %s answered %d" % (url, status))
    try:
        live = json.loads(text)
        if not isinstance(live, dict) or not isinstance(live.get("sha"), str) or not isinstance(live.get("built_at"), str):
            raise ValueError
    except ValueError:
        raise Broken("the live version cannot be read: %s is not a version file" % url) from None
    sha = live["sha"]
    if not SHA.match(sha):
        raise Broken("live was built outside git, its commit is %s: it cannot be compared" % one_line(sha, 60))
    pr = live.get("pr") if isinstance(live.get("pr"), int) else None
    label = "v%s.%s%s" % (live["built_at"][:10].replace("-", "."), sha[:7], " #%d" % pr if pr else "")

    _git_or_broken("fetch", "-q", "origin", "main")
    newest_line = _git_or_broken("log", "-1", "--format=%H%x09%s", "origin/main", "--", *DEPLOY_PATHS).strip()
    newest_sha, _, subject = newest_line.partition("\t")
    newest_pr = _pr_of(subject)
    if git("cat-file", "-e", sha + "^{commit}")[0] != 0:
        raise Broken("live runs %s, a commit this checkout does not hold after fetching origin/main" % sha[:7])
    behind = int(_git_or_broken("rev-list", "--count", sha + "..origin/main", "--", *DEPLOY_PATHS).strip() or 0)

    lines = ["live: %s, built %s" % (label, one_line(live["built_at"], 40)),
             "newest app commit on origin/main: %s%s %s" % (newest_sha[:7], " #%d" % newest_pr if newest_pr else "",
                                                             one_line(subject, 120))]
    if behind == 0:
        lines.append("live is up to date")
    else:
        lines.append("live is behind: %d app commit%s not deployed yet (newest %s)"
                     % (behind, "" if behind == 1 else "s", "#%d" % newest_pr if newest_pr else newest_sha[:7]))
    data = {"live": {"sha": sha, "short": sha[:7], "built_at": live["built_at"], "pr": pr},
            "newest": {"sha": newest_sha, "short": newest_sha[:7], "pr": newest_pr, "subject": subject},
            "behind": behind, "up_to_date": behind == 0}
    return lines, data


def _whoami(cfg, session):
    user = _token_claim(session["access_token"], "sub")
    if not isinstance(user, str) or not user:
        raise NotSignedIn()
    rows = read(cfg, session, "sales", {"select": "handle,id_prefix,disabled", "user_id": "eq." + user})
    if not rows or not isinstance(rows[0], dict):
        raise Refused("this sign-in is not a teammate")
    if not rows[0].get("handle"):
        raise Refused(NO_HANDLE_LINE)
    return {"handle": rows[0]["handle"], "id_prefix": rows[0].get("id_prefix")}


def cmd_whoami(args, cfg, session):
    who = _whoami(cfg, session)
    return ["%s (%s)" % (who["handle"], who["id_prefix"])], who


def _person_line(row):
    if row.get("last_touch_date"):
        touch = "%s via %s: %s" % (row["last_touch_date"], row.get("last_touch_channel") or "?", row.get("last_touch_text") or "")
    else:
        touch = "none"
    return one_line(" | ".join([
        str(row.get("person_code", "?")), str(row.get("name") or ""),
        ("role: %s" % (row.get("role") or "")).rstrip(), ("org: %s" % (row.get("organization") or "")).rstrip(),
        ("contact: %s" % ", ".join(str(d) for d in (row.get("contact") or []) if d)).rstrip(),
        "owner: %s" % (row.get("owner") or ""), "status: %s" % (row.get("status") or ""), "last touch: %s" % touch]))


def cmd_find(args, cfg, session):
    rows = call_action(cfg, session, "find_person", {"query": args.text})
    if not isinstance(rows, list):
        raise Broken("the hub's answer was not what was expected (no list of people)")
    return [_person_line(row) for row in rows if isinstance(row, dict)], rows


def contact_details(args):
    """Every contact detail given, in order: a --contact value is one detail, a --contact-file one detail a line."""
    out = []
    for kind, value in getattr(args, "contact_items", None) or []:
        if kind == "text":
            out.append(value)
        else:
            out += read_value_file(value, "--contact-file").splitlines()
    return [detail for detail in out if detail.strip()]


def cmd_add(args, cfg, session):
    details = contact_details(args)
    done = _need(call_action(cfg, session, "add_person", {
        "name": args.name, "owner": args.owner, "role": args.role, "organization": args.org,
        "contacts": details or None, "referred_by": args.referred_by,
        "quote_by_name": True if args.quote_by_name else None, "category": args.category}), "person_code")
    return [one_line("added %s: %s, owner %s, status %s" % (done["person_code"], done.get("name", args.name),
                                                           done.get("owner", "?"), done.get("status", "?")))], done


def cmd_update(args, cfg, session):
    details = contact_details(args)
    if not details and args.role is None and args.org is None and args.category is None:
        raise Refused("nothing to change: give --contact-file, --role-file, --org-file or --category")
    done = _need(call_action(cfg, session, "update_person", {
        "person_code": args.person, "contacts": details or None, "role": args.role, "organization": args.org,
        "category": args.category}), "person_code")
    changed = [str(part) for part in done.get("changed") or []]
    if not changed:
        return [one_line("nothing new for %s: every detail given is already on file" % done["person_code"])], done
    return [one_line("updated %s: %s" % (done["person_code"], ", ".join(changed)))], done


def cmd_touch(args, cfg, session):
    when = need_date(args.date, "--date") if args.date else None
    due = need_date(args.due, "--due") if args.due else None
    done = _need(call_action(cfg, session, "log_touch", {
        "person_code": args.person, "by": args.by, "date": when, "channel": args.channel, "what": args.what,
        "next_step": args.next, "next_due": due, "status": args.status}), "touch_id")
    return [one_line("logged touch %s on %s by %s; status now %s" % (done["touch_id"], done.get("person_code", args.person),
                                                                    done.get("by", "?"), done.get("status", "?")))], done


# The keys a log file may hold, and the namespace its made up request ids are in.
LOG_KEYS = ("person", "touches", "request_id")
LOG_IDS = uuid.UUID("6f1d5b8e-6565-4e1a-9c65-6c6f67000000")


def read_log_file(path):
    """The person, touches and request id of a log file, checked before anything is sent. Refuses with one line."""
    try:
        doc = json.loads(read_value_file(path, "--json-file"))
    except ValueError:
        raise Refused("--json-file: %s is not JSON" % one_line(path, 200)) from None
    if not isinstance(doc, dict):
        raise Refused("--json-file: %s must hold one JSON object with person and touches" % one_line(path, 200))
    extra = sorted(key for key in doc if key not in LOG_KEYS)
    if extra:
        raise Refused("--json-file: unknown key %s: the file holds person, touches and request_id only"
                      % ", ".join("'%s'" % one_line(key, 40) for key in extra))
    if not isinstance(doc.get("person"), dict):
        raise Refused("--json-file: person must be an object with at least a name")
    if not isinstance(doc.get("touches"), list):
        raise Refused("--json-file: touches must be a list of 1 to 20 touches")
    rid = doc.get("request_id")
    if rid is not None:
        try:
            rid = str(uuid.UUID(rid)) if isinstance(rid, str) else None
        except ValueError:
            rid = None
        if rid is None:
            raise Refused("--json-file: request_id must be a UUID, as uuidgen makes")
    return {"person": doc["person"], "touches": doc["touches"], "request_id": rid}


def cmd_log(args, cfg, session):
    body = dict(args.log_body)
    if args.category is not None:   # the flag wins over a category in the file
        body["person"] = dict(body["person"], category=args.category)
    if body["request_id"] is None:   # the same teammate and the same file make the same id
        same = json.dumps([_token_claim(session["access_token"], "sub"), body["person"], body["touches"]],
                          sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        body["request_id"] = str(uuid.uuid5(LOG_IDS, same))
    try:
        done = call_action(cfg, session, "add_person_with_touches", body)
    except Broken as error:
        if "not known whether" in str(error):
            raise Broken("not known whether this was saved: the hub did not answer. Run the same command with the same "
                         "file again: the same request is never saved twice") from None
        raise
    done = _need(done, "person_code")
    n = done.get("touches", "?")
    line = "%s %s: %s, owner %s, status %s, %s touch%s" % (
        "already logged" if done.get("repeat") else "added", done["person_code"], done.get("name", "?"),
        done.get("owner", "?"), done.get("status", "?"), n, "" if n == 1 else "es")
    return [one_line(line + (" (nothing new written)" if done.get("repeat") else ""))], done


def cmd_status(args, cfg, session):
    done = _need(call_action(cfg, session, "set_status", {"person_code": args.person, "status": args.to}), "status")
    return [one_line("%s status is now %s" % (done.get("person_code", args.person), done["status"]))], done


def cmd_owner(args, cfg, session):
    done = _need(call_action(cfg, session, "set_owner", {"person_code": args.person, "owner": args.to}), "owner")
    return [one_line("%s is now owned by %s" % (done.get("person_code", args.person), done["owner"]))], done


def cmd_tally(args, cfg, session):
    """Per stakeholder category: people interviewed, scheduled, and contacted or later. Every row, 0 when empty."""
    if args.owner or args.status or args.followup or args.category:
        raise Refused("--tally counts everyone: give it alone, without --owner, --status, --followup or --category")
    got = {row.get("category"): row for row in read(cfg, session, "category_tally",
                                                     {"select": "category,interviewed,scheduled,contacted_or_later",
                                                      "order": "id.asc"}) if isinstance(row, dict)}
    rows = [{"category": name,
             "interviewed": int(got.get(name, {}).get("interviewed") or 0),
             "scheduled": int(got.get(name, {}).get("scheduled") or 0),
             "contacted_or_later": int(got.get(name, {}).get("contacted_or_later") or 0)} for name in TALLY_ROWS]
    width = max(len(name) for name in TALLY_ROWS)
    lines = ["%-*s  %11s  %9s  %18s" % (width, "category", "interviewed", "scheduled", "contacted_or_later")]
    lines += ["%-*s  %11d  %9d  %18d" % (width, r["category"], r["interviewed"], r["scheduled"],
                                         r["contacted_or_later"]) for r in rows]
    return lines, rows


def cmd_list(args, cfg, session):
    if args.tally:
        return cmd_tally(args, cfg, session)
    sales = read(cfg, session, "sales", {"select": "id,handle"})
    handle_of = {row.get("id"): row.get("handle") for row in sales if isinstance(row, dict)}
    owner_id = None
    if args.owner:
        owner_id = next((key for key, handle in handle_of.items() if handle == args.owner), None)
        if owner_id is None:
            known = ", ".join(sorted(h for h in handle_of.values() if h)) or "none yet"
            raise Refused("--owner '%s' is not a teammate's handle (on file: %s)" % (one_line(args.owner, 40), known))
    people_filter = {"select": "person_code,first_name,last_name,title,status,sales_id,company_id,category",
                     "order": "person_code.asc"}
    if owner_id is not None:
        people_filter["sales_id"] = "eq.%s" % owner_id
    if args.status:
        people_filter["status"] = "eq." + args.status
    if args.category:
        people_filter["category"] = "is.null" if args.category == "uncategorized" else "eq." + args.category
    if args.followup:
        wanted = {"select": "person_code,next_step,next_due,date,channel,owner_id"}
        if owner_id is not None:
            wanted["owner_id"] = "eq.%s" % owner_id
        steps = read(cfg, session, "follow_ups", wanted)
        people = {row.get("person_code"): row for row in read(cfg, session, "contacts", people_filter)}
        rows = []
        for step in steps:
            person = people.get(step.get("person_code"))
            if person is None or person.get("status") in NO_FOLLOWUP:
                continue   # filtered out by --status, or someone nobody should chase
            name = " ".join(part for part in (person.get("first_name"), person.get("last_name")) if part)
            rows.append({"person_code": step.get("person_code"), "name": name, "next_step": step.get("next_step"),
                         "next_due": step.get("next_due"), "status": person.get("status"),
                         "owner": handle_of.get(step.get("owner_id")), "last_touch_date": str(step.get("date") or "")[:10],
                         "last_touch_channel": step.get("channel")})
        rows.sort(key=lambda r: (r["next_due"] is None, r["next_due"] or "", str(r["person_code"])))
        return [one_line("%s | %s | next: %s | due: %s | owner: %s | status: %s | last touch: %s via %s" % (
            r["person_code"], r["name"], r["next_step"], r["next_due"] or "no date", r["owner"] or "", r["status"],
            r["last_touch_date"], r["last_touch_channel"])) for r in rows], rows
    people = read(cfg, session, "contacts", people_filter)
    names = {}
    if any(row.get("company_id") is not None for row in people):
        names = {row.get("id"): row.get("name") for row in read(cfg, session, "companies", {"select": "id,name"})}
    rows = [{"person_code": row.get("person_code"),
             "name": " ".join(part for part in (row.get("first_name"), row.get("last_name")) if part),
             "role": row.get("title"), "organization": names.get(row.get("company_id")),
             "owner": handle_of.get(row.get("sales_id")), "status": row.get("status"),
             "category": row.get("category")} for row in people]
    return [one_line(" | ".join([str(r["person_code"]), r["name"], ("role: %s" % (r["role"] or "")).rstrip(),
                                 ("org: %s" % (r["organization"] or "")).rstrip(), "owner: %s" % (r["owner"] or ""),
                                 "status: %s" % (r["status"] or ""),
                                 "category: %s" % (r["category"] or "uncategorized")])) for r in rows], rows


def cmd_recording_known(args, cfg, session):
    ids = [part.strip() for part in args.ids.split(",") if part.strip()]
    if not ids:
        raise Refused("--ids needs at least one recording id")
    rows = []
    for start in range(0, len(ids), 40):
        some = _in_list(ids[start:start + 40])
        for row in read(cfg, session, "interviews", {"select": "id,granola_id", "granola_id": some}):
            rows.append({"granola_id": row.get("granola_id"), "where": "saved as interview %s" % row.get("id")})
        for row in read(cfg, session, "call_inbox", {"select": "id,granola_id,state", "granola_id": some}):
            rows.append({"granola_id": row.get("granola_id"), "where": "in the inbox as item %s (%s)" % (row.get("id"), row.get("state"))})
    return [one_line("%s  %s" % (row["granola_id"], row["where"])) for row in rows], rows


def cmd_recording_submit(args, cfg, session):
    consent = _consent(args.consent, False, "")
    meta = read_json(args.meta, "meta")
    if not isinstance(meta, dict):
        raise Refused("the meta file must hold one JSON object")
    granola_id, title, emails = meta.get("granola_id"), meta.get("title"), meta.get("attendee_emails")
    if not isinstance(granola_id, str) or not granola_id.strip():
        raise Refused("the meta file has no granola_id")
    if not isinstance(title, str) or not title.strip():
        raise Refused("the meta file has no title")
    if not isinstance(emails, list) or not all(isinstance(item, str) for item in emails):
        raise Refused("the meta file's attendee_emails must be a list of addresses (an empty list when the invite had none)")
    when = need_date(meta.get("date") if isinstance(meta.get("date"), str) else "", "the meta file's date")
    overview = read_text(args.overview, "overview")
    links = _hypotheses(args.hypotheses)
    transcript, total = join_pages(args.pages, granola_id.strip(), args.pages_without_id)   # refuses before anything is sent
    try:
        done = call_action(cfg, session, "submit_recording", {
            "granola_id": granola_id.strip(), "source": "granola", "title": title, "recorded_on": when,
            "attendee_emails": emails, "overview": overview, "transcript": transcript, "consent_to_record": consent,
            "hypotheses": links, "reported_chars": total, "kind": args.kind})
    except Refused as refusal:
        sentence = str(refusal)
        if sentence.startswith("this recording is already "):   # a second run after a lost reply: done, not an error
            return [sentence[len("this recording is "):]], {"result": "already", "message": sentence}
        raise
    except Broken as error:
        if "not known whether" in str(error):
            raise Broken("not known whether this was saved: the hub did not answer. Run the same command again: "
                         "a recording already on file is never saved twice") from None
        raise
    done = _need(done, "result")
    if done["result"] == "saved":
        return [one_line("saved as interview %s for %s (%d characters)" % (done.get("interview_id"), done.get("person_code"), total))] + _same_day(done), done
    if done["result"] == "inbox":
        return [one_line("in the inbox as item %s, waiting: %s" % (done.get("inbox_id"), done.get("reason")))], done
    raise Broken("the hub's answer was not what was expected: look before doing it again")


def cmd_recording_paste(args, cfg, session):
    kind = args.kind
    consent = _consent(args.consent, True, "saving an interview", "recorded" if kind == "transcript" else "interviewed")
    when = need_date(args.date, "--date")
    transcript = read_text(args.transcript, "transcript")
    if kind == "transcript" and len(transcript) < MIN_TRANSCRIPT:
        raise Refused("that file is %d characters: a transcript is at least %d. For notes or a debrief, say so with --kind notes or --kind debrief"
                      % (len(transcript), MIN_TRANSCRIPT))
    if kind != "transcript" and len(transcript) < MIN_NOTES:
        raise Refused("that file is %d characters: %s at least %d" % (
            len(transcript), "notes need" if kind == "notes" else "a debrief needs", MIN_NOTES))
    overview = read_text(args.overview, "overview")
    done = _need(call_action(cfg, session, "save_interview", {
        "person_code": args.person, "date": when, "source": "paste", "consent_to_record": consent, "title": args.title,
        "overview": overview, "transcript": transcript, "hypotheses": _hypotheses(args.hypotheses), "kind": kind}),
        "interview_id")
    size = "%s characters" % done.get("chars", len(transcript))
    return [one_line("saved as interview %s for %s (%s)" % (done["interview_id"], done.get("person_code", args.person),
                                                           size if kind == "transcript" else "%s, %s" % (kind, size)))] + _same_day(done), done


def _same_day(done):
    """The line when the hub knows another interview of this person on this day (issue 98)."""
    other = done.get("same_conversation_as") if isinstance(done, dict) else None
    if other is None:
        return []
    return ["possible same conversation as interview %s (same person, same day)" % other]


def cmd_recording_link(args, cfg, session):
    done = _need(call_action(cfg, session, "link_interviews", {"primary_id": args.primary, "other_id": args.other}),
                 "result", "primary_id")
    if done["result"] == "already linked":
        return [one_line("already linked: interview %s is in the session of interview %s" % (args.other, done["primary_id"]))], done
    return [one_line("linked: interview %s is now in the session of interview %s" % (args.other, done["primary_id"]))], done


def cmd_inbox_list(args, cfg, session):
    rows = read(cfg, session, "call_inbox", {"select": "id,title,recorded_on,reason,state,attendee_emails",
                                             "state": "eq.waiting", "order": "id.asc"})
    return [one_line("item %s | %s | %s | waiting: %s | invited: %s" % (
        row.get("id"), row.get("recorded_on"), row.get("title") or "(no title)", row.get("reason"),
        ", ".join(str(e) for e in (row.get("attendee_emails") or [])) or "nobody")) for row in rows], rows


def cmd_inbox_confirm(args, cfg, session):
    consent = _consent(args.consent or "unknown", True, "confirming a recording",
                       "recorded" if args.kind in (None, "transcript") else "interviewed")
    values = {"inbox_id": args.id, "person_code": args.person, "consent_to_record": consent}
    if args.kind:   # left out, the recording keeps the kind it was sent with
        values["kind"] = args.kind
    done = _need(call_action(cfg, session, "confirm_recording", values), "interview_id")
    return [one_line("item %s is now interview %s for %s" % (done.get("inbox_id", args.id), done["interview_id"],
                                                            done.get("person_code", args.person)))], done


def cmd_inbox_dismiss(args, cfg, session):
    done = _need(call_action(cfg, session, "dismiss_recording", {"inbox_id": args.id, "reason": args.reason}), "state")
    return [one_line("item %s is %s" % (done.get("inbox_id", args.id), done["state"]))], done


# ---------- the command line ----------

class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refused(one_line("%s (see: python3 scripts/hub.py --help)" % message))


def _text_option(parser, flag, required=False, positional=False):
    """A free text value, given on the line or read from a file with FLAG-file (- for standard input)."""
    dest = flag.lstrip("-").replace("-", "_")
    if positional:
        parser.add_argument(dest, nargs="?")
        name = "<%s>" % dest
    else:
        parser.add_argument(flag)
        name = flag
    file_flag = "--%s-file" % dest.replace("_", "-")
    parser.add_argument(file_flag, dest=dest + "_file", metavar="PATH",
                        help="read %s from this UTF-8 file, - for standard input" % name)
    texts = parser.get_default("texts") or []
    parser.set_defaults(texts=texts + [(dest, name, file_flag, required)])


class _ContactItem(argparse.Action):
    """--contact and --contact-file, kept together in the order given."""

    def __call__(self, parser, namespace, value, option_string=None):
        items = list(getattr(namespace, "contact_items", None) or [])
        items.append(("file" if option_string == "--contact-file" else "text", value))
        setattr(namespace, "contact_items", items)


def _contact_options(parser):
    parser.add_argument("--contact", action=_ContactItem, help="one contact detail; may be given several times")
    parser.add_argument("--contact-file", action=_ContactItem, metavar="PATH",
                        help="contact details, one a line, from this UTF-8 file (- for standard input); "
                             "may be given several times")


def read_value_file(path, flag):
    """A free text value from a file: byte for byte, less one trailing newline if it ends in one."""
    try:
        if path == "-":
            stream = getattr(sys.stdin, "buffer", None)
            raw = stream.read() if stream is not None else sys.stdin.read().encode("utf-8")
        else:
            with open(path, "rb") as handle:
                raw = handle.read()
    except OSError:
        raise Refused("%s: cannot read %s" % (flag, path))
    try:
        value = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise Refused("%s: %s is not UTF-8 text" % (flag, path))
    return value[:-1] if value.endswith("\n") else value


def resolve_texts(args):
    """Fill each free text value from its file where one was given. Refuses both forms, or two reading standard input."""
    texts = getattr(args, "texts", None) or []
    from_stdin = [file_flag for dest, _, file_flag, _ in texts if getattr(args, dest + "_file", None) == "-"]
    from_stdin += ["--contact-file" for kind, path in getattr(args, "contact_items", None) or [] if kind == "file" and path == "-"]
    if len(from_stdin) > 1:
        raise Refused("only one option may read standard input in one call, here: %s" % ", ".join(from_stdin))
    for dest, name, file_flag, required in texts:
        path = getattr(args, dest + "_file", None)
        if path is not None:
            if getattr(args, dest, None) is not None:
                raise Refused("give %s or %s, not both" % (name, file_flag))
            setattr(args, dest, read_value_file(path, file_flag))
        elif required and getattr(args, dest, None) is None:
            raise Refused("%s or %s is needed (see: python3 scripts/hub.py --help)" % (name, file_flag))
    return args


def build_parser():
    parser = _Parser(prog="hub.py", description="Read and write the team hub as the signed in teammate.")
    parser.add_argument("--json", action="store_true", help="print the result as JSON")
    common = _Parser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="print the result as JSON")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("login", parents=[common], help="sign in with Google, in your browser",
                       description="Signs in with Google in your browser: no password needed. "
                                   "--password is the fallback, email and password in a terminal.")
    p.add_argument("--password", action="store_true",
                   help="the fallback: sign in with email and password instead (run it yourself, in a terminal)")
    p.add_argument("--email", help="with --password: the email to sign in with")
    p.set_defaults(run=cmd_login)
    sub.add_parser("logout", parents=[common], help="forget the session").set_defaults(run=cmd_logout)
    sub.add_parser("whoami", parents=[common], help="the signed in teammate's handle and prefix").set_defaults(run=cmd_whoami)
    sub.add_parser("password", parents=[common],
                   help="replace your own password (run it yourself, in a terminal)").set_defaults(run=cmd_password)

    p = sub.add_parser("find", parents=[common], help="people matching a name, organization, contact detail or code")
    _text_option(p, "text", required=True, positional=True)
    p.set_defaults(run=cmd_find)

    p = sub.add_parser("add", parents=[common], help="add a person")
    _text_option(p, "--name", required=True)
    _text_option(p, "--role")
    _text_option(p, "--org")
    _contact_options(p)
    _text_option(p, "--referred-by")
    p.add_argument("--owner")
    p.add_argument("--quote-by-name", action="store_true")
    p.add_argument("--category", help="stakeholder category: %s" % ", ".join(CATEGORIES))
    p.set_defaults(run=cmd_add)

    p = sub.add_parser("update", parents=[common], help="add contact details to a person, or change the role or organization")
    p.add_argument("--person", required=True)
    _contact_options(p)
    _text_option(p, "--role")
    _text_option(p, "--org")
    p.add_argument("--category", help="stakeholder category: %s" % ", ".join(CATEGORIES) + "; empty clears it")
    p.set_defaults(run=cmd_update)

    p = sub.add_parser("touch", parents=[common], help="log one touch on a person")
    p.add_argument("--person", required=True)
    p.add_argument("--channel", required=True)
    _text_option(p, "--what", required=True)
    p.add_argument("--by")
    p.add_argument("--date")
    _text_option(p, "--next")
    p.add_argument("--due")
    p.add_argument("--status")
    p.set_defaults(run=cmd_touch)

    p = sub.add_parser("log", parents=[common], help="add a new person and their first touches in one call, all or nothing")
    p.add_argument("--json-file", required=True, metavar="FILE",
                   help='{"person": {...}, "touches": [...], "request_id": "<uuid>"}; - for standard input')
    p.add_argument("--category", help="stakeholder category: %s" % ", ".join(CATEGORIES))
    p.set_defaults(run=cmd_log)

    p = sub.add_parser("status", parents=[common], help="set where a person stands")
    p.add_argument("--person", required=True)
    p.add_argument("--to", required=True)
    p.set_defaults(run=cmd_status)

    p = sub.add_parser("owner", parents=[common], help="hand a person to another teammate")
    p.add_argument("--person", required=True)
    p.add_argument("--to", required=True)
    p.set_defaults(run=cmd_owner)

    p = sub.add_parser("list", parents=[common], help="people, or who needs a follow-up")
    p.add_argument("--owner")
    p.add_argument("--status")
    p.add_argument("--followup", action="store_true")
    p.add_argument("--category", help="only people of this stakeholder category, or uncategorized")
    p.add_argument("--tally", action="store_true",
                   help="per stakeholder category: interviewed, scheduled, contacted or later")
    p.set_defaults(run=cmd_list)

    rec = sub.add_parser("recording", help="recordings and interviews").add_subparsers(dest="what", required=True)
    p = rec.add_parser("known", parents=[common], help="which of these recordings the hub already holds")
    p.add_argument("--ids", required=True)
    p.set_defaults(run=cmd_recording_known)
    p = rec.add_parser("submit", parents=[common], help="send a Granola recording with its whole transcript")
    p.add_argument("--meta", required=True)
    p.add_argument("--pages", required=True)
    p.add_argument("--overview", required=True)
    p.add_argument("--consent", required=True)
    p.add_argument("--hypotheses")
    p.add_argument("--pages-without-id", action="store_true",
                   help="the pages carry no meeting id and the teammate confirmed they are of the meeting in the meta file")
    p.add_argument("--kind", choices=KINDS, default="transcript")
    p.set_defaults(run=cmd_recording_submit)
    p = rec.add_parser("paste", parents=[common], help="save a pasted transcript, notes or a debrief as an interview for one person")
    p.add_argument("--person", required=True)
    p.add_argument("--date", required=True)
    _text_option(p, "--title", required=True)
    p.add_argument("--transcript", required=True)
    p.add_argument("--overview", required=True)
    p.add_argument("--consent", required=True)
    p.add_argument("--hypotheses")
    p.add_argument("--kind", choices=KINDS, default="transcript")
    p.set_defaults(run=cmd_recording_paste)
    p = rec.add_parser("link", parents=[common], help="mark two interviews of one person as one conversation (one session)")
    p.add_argument("--primary", required=True, type=int)
    p.add_argument("--other", required=True, type=int)
    p.set_defaults(run=cmd_recording_link)

    box = sub.add_parser("inbox", help="recordings waiting for a person").add_subparsers(dest="what", required=True)
    box.add_parser("list", parents=[common], help="what is waiting").set_defaults(run=cmd_inbox_list)
    p = box.add_parser("confirm", parents=[common], help="turn a waiting recording into an interview for one person")
    p.add_argument("--id", required=True, type=int)
    p.add_argument("--person", required=True)
    p.add_argument("--consent")
    p.add_argument("--kind", choices=KINDS)
    p.set_defaults(run=cmd_inbox_confirm)
    p = box.add_parser("dismiss", parents=[common], help="set a waiting recording aside, with a reason")
    p.add_argument("--id", required=True, type=int)
    _text_option(p, "--reason", required=True)
    p.set_defaults(run=cmd_inbox_dismiss)

    sub.add_parser("version", parents=[common],
                   help="which version is live on the website, and whether it is behind origin/main (no sign-in)"
                   ).set_defaults(run=cmd_version)
    return parser


def run(args):
    """Run one parsed command. Returns (lines, data)."""
    if args.run is cmd_version:
        return cmd_version(args)
    if args.run is cmd_log:   # the file is read and checked before anything else
        args.log_body = read_log_file(args.json_file)
    home = hub_home()
    if args.run in (cmd_login, cmd_logout):
        return args.run(args, home)
    cfg = load_config(home)
    return args.run(args, cfg, current_session(cfg, home))


def main(argv=None):
    as_json = False
    try:
        args = resolve_texts(build_parser().parse_args(argv))
        as_json = bool(getattr(args, "json", False))
        lines, data = run(args)
    except Refused as reason:
        print(one_line(str(reason), 1000), file=sys.stderr)
        return 2
    except NotSignedIn:
        print(SIGN_IN_LINE, file=sys.stderr)
        return 3
    except Broken as reason:
        print(one_line(str(reason), 1000), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("stopped", file=sys.stderr)
        return 1
    except Exception as error:   # noqa: BLE001  one line, never a stack trace, never the values involved
        print("could not do that: %s. Look before doing it again" % type(error).__name__, file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps(data, ensure_ascii=False))
    else:
        for line in lines:
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
