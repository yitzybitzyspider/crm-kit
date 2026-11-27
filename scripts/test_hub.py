#!/usr/bin/env python3
"""Tests for hub.py with no network. Run: python3 scripts/test_hub.py

hub.py touches the network in one function, hub.transport. Here it is
replaced by a queue of recorded answers from scripts/fixtures/hub/, and every
request hub.py makes is kept and looked at. The Granola pages come from
scripts/fixtures/granola/: made up text in the shape the connector documents.
No real Granola answer and no real hub answer was recorded.

Tokens, the public key and the test password are made up fresh on every run,
so none is in the repo. Cases 1 to 18 of issue #26; the G cases are issue #61
(sign-in with Google), cases 1 to 11.
"""
import base64
import contextlib
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import stat
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
try:
    import hub  # noqa: E402
except ImportError as error:
    print("FAIL  scripts/hub.py cannot be imported  -> %s" % error)
    print("\n0 passed, 1 failed")
    sys.exit(1)

HUB_FIX = HERE / "fixtures" / "hub"
GRANOLA = HERE / "fixtures" / "granola"
URL = "https://hub.fixture.example"
LOCAL = "http://127.0.0.1:54341"
KEY = "public-" + secrets.token_urlsafe(12)
PASSWORD = "pw-" + secrets.token_urlsafe(16)
USER_ID = "00000000-0000-4000-8000-0000000000f1"
ACTION_NAMES = ("find_person", "add_person", "update_person", "set_owner", "set_status", "log_touch", "save_interview",
                "submit_recording", "confirm_recording", "dismiss_recording", "update_overview", "add_person_with_touches",
                "link_interviews")

results = []
captured = []   # every stdout and stderr of every run, for case 15
secrets_made = [PASSWORD]


def case(label, ok, detail=""):
    results.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + label + ("" if ok else "  -> " + str(detail)[:900]))


def make_token():
    """Something shaped like an access token, with a subject, made up now."""
    def part(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    token = ".".join([part({"alg": "none"}), part({"sub": USER_ID, "role": "authenticated"}), secrets.token_urlsafe(24)])
    secrets_made.append(token)
    return token


def make_refresh():
    token = "refresh-" + secrets.token_urlsafe(18)
    secrets_made.append(token)
    return token


def fixture(name):
    doc = json.loads((HUB_FIX / (name + ".json")).read_text(encoding="utf-8"))
    body = doc["body"]
    return doc["status"], body if isinstance(body, str) else json.dumps(body)


def token_answer(expires_in=3600):
    return 200, json.dumps({"access_token": make_token(), "refresh_token": make_refresh(), "token_type": "bearer",
                            "expires_in": expires_in, "expires_at": int(time.time()) + expires_in,
                            "user": {"id": USER_ID, "email": "fixture@example.org"}})


class FakeHub:
    """Stands in for hub.transport: hands out the queued answers in order and keeps each request."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.requests = []

    def __call__(self, method, url, headers, body, timeout):
        self.requests.append({"method": method, "url": url, "headers": dict(headers),
                              "body": None if body is None else json.loads(body.decode("utf-8"))})
        if not self.answers:
            raise AssertionError("hub.py made a request the test did not expect: %s %s" % (method, url))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def new_home(signed_in=True, url=URL, expires_in=3600):
    home = Path(tempfile.mkdtemp(prefix="hubtest-")) / "crm-kit"
    if signed_in:
        home.mkdir(mode=0o700)
        session = {"url": url, "access_token": make_token(), "refresh_token": make_refresh(),
                   "expires_at": int(time.time()) + expires_in}
        path = home / "session.json"
        path.write_text(json.dumps(session), encoding="utf-8")
        path.chmod(0o600)
    return home


def run(argv, answers=(), home=None, url=URL, env=None, key=KEY, stdin=""):
    """Run hub.main in this process. Returns (exit code, stdout, stderr, requests made, the home folder)."""
    home = home if home is not None else new_home(url=url)
    fake = FakeHub(answers)
    keep_env, keep_transport = dict(os.environ), hub.transport
    for name in ("CRM_KIT_URL", "CRM_KIT_KEY", "CRM_KIT_HOME", "HUB_TEST_PASSWORD", "HUB_TEST_EMAIL"):
        os.environ.pop(name, None)
    os.environ["CRM_KIT_HOME"] = str(home)
    if url:
        os.environ["CRM_KIT_URL"], os.environ["CRM_KIT_KEY"] = url, key
    os.environ.update(env or {})
    out, err = io.StringIO(), io.StringIO()
    hub.transport = fake
    keep_stdin, sys.stdin = sys.stdin, io.TextIOWrapper(io.BytesIO(stdin.encode("utf-8")), encoding="utf-8", newline="")
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = hub.main(list(argv))
            except SystemExit as stop:
                code = stop.code
            except AssertionError as error:
                code, _ = 99, print(str(error), file=sys.stderr)
    finally:
        hub.transport = keep_transport
        sys.stdin = keep_stdin
        os.environ.clear()
        os.environ.update(keep_env)
    captured.append(out.getvalue() + err.getvalue())
    return code, out.getvalue(), err.getvalue(), fake.requests, home


def lines(text):
    return [line for line in text.splitlines() if line.strip()]


def one_plain_line(code, want, out, err):
    """The exit code wanted, one line in all, no stack trace."""
    return code == want and "Traceback" not in out + err and len(lines(out + err)) == 1


def path_of(request):
    return request["url"][len(URL):] if request["url"].startswith(URL) else request["url"]


def temp_file(text, name="file.txt"):
    path = Path(tempfile.mkdtemp(prefix="hubtest-")) / name
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    return path


# ---------------------------------------------------------------- 1. find
code, out, err, reqs, _ = run(["find", "maria"], [fixture("find_one")])
line = out.strip()
case("1 find maria prints one line with code, name, owner, status and last touch",
     code == 0 and len(lines(out)) == 1 and all(part in line for part in
                                                 ("CC-01", "Maria Okafor", "charlie", "contacted", "2026-11-20", "email")), out + err)
case("1 find posts to rpc/find_person with the text and via claude",
     len(reqs) == 1 and reqs[0]["method"] == "POST" and path_of(reqs[0]) == "/rest/v1/rpc/find_person"
     and reqs[0]["body"] == {"query": "maria", "via": "claude"}, reqs)
code, out, err, reqs, _ = run(["find", "nobody"], [fixture("find_none")])
case("1 find with no match prints nothing and exits 0", code == 0 and out.strip() == "" and err.strip() == "", out + err)
code, out, err, reqs, _ = run(["find", "okafor"], [fixture("find_several")])
case("1 find with several matches prints one line each (a line break inside a touch stays on its line)",
     code == 0 and len(lines(out)) == 3 and [ln.split()[0] for ln in lines(out)] == ["CC-01", "BB-02", "AA-03"], out + err)
code, out, err, reqs, _ = run(["find", "okafor", "--json"], [fixture("find_several")])
try:
    as_json = json.loads(out)
except ValueError:
    as_json = None
case("1 --json gives the same rows as JSON", code == 0 and isinstance(as_json, list) and len(as_json) == 3
     and as_json[0].get("person_code") == "CC-01", out + err)

# ---------------------------------------------------------------- 2. add
code, out, err, reqs, _ = run(["add", "--name", "Maria Okafor", "--org", "Northbay"], [fixture("add_ok")])
case("2 add posts to rpc/add_person with those arguments and via claude",
     len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/add_person"
     and reqs[0]["body"] == {"name": "Maria Okafor", "organization": "Northbay", "via": "claude"}, reqs)
case("2 add prints the new code", code == 0 and "BB-04" in out and len(lines(out)) == 1, out + err)
code, out, err, reqs, _ = run(["add", "--name", "Maria Okafor", "--role", "Charge nurse", "--contact", "maria@northbay-example.example.org",
                               "--referred-by", "Charlie", "--owner", "charlie", "--quote-by-name"], [fixture("add_ok")])
case("2 add sends role, contact, referrer, owner and the quote permission when given",
     len(reqs) == 1 and reqs[0]["body"] == {"name": "Maria Okafor", "role": "Charge nurse", "contacts": ["maria@northbay-example.example.org"],
                                            "referred_by": "Charlie", "owner": "charlie", "quote_by_name": True, "via": "claude"}, reqs)
code, out, err, reqs, _ = run(["add", "--name", "Maria Okafor"], [fixture("add_duplicate")])
case("2 a recorded duplicate refusal gives exit 2 and the database's sentence",
     one_plain_line(code, 2, out, err) and "already on file (same name): CC-01, Maria Okafor, owner charlie" in out + err, out + err)

# ------------------------------------------- issue 64: several contact details


def contact_file(value):
    return str(temp_file(value, "contact.txt"))


code, out, err, reqs, _ = run(["add", "--name", "Casey Lane", "--contact-file", contact_file("a@b-org.example.org\n"),
                               "--contact-file", contact_file("https://www.linkedin.com/in/x/\n\n  \nemergency.metro.edu/content/x"),
                               "--contact", "+1 415 555 0100"], [fixture("add_ok")])
case("64 case 15 add with two --contact-file flags, one file of two lines and a blank one, sends a four item list",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("contacts") == [
         "a@b-org.example.org", "https://www.linkedin.com/in/x/", "emergency.metro.edu/content/x", "+1 415 555 0100"]
     and "contact" not in reqs[0]["body"], (code, out + err, reqs))
code, out, err, reqs, _ = run(["update", "--person", "DD-01"])
case("64 case 16 update with no field given exits 2 with nothing to change, and sends nothing",
     one_plain_line(code, 2, out, err) and "nothing to change" in out + err and reqs == [], (code, out + err, reqs))
code, out, err, reqs, _ = run(["update", "--person", "DD-01", "--contact-file", contact_file("https://emergency.metro.edu/content/casey-lane\n"),
                               "--role-file", contact_file("Resident"), "--org-file", contact_file("Metro")],
                              [(200, json.dumps({"person_code": "DD-01", "changed": ["role", "organization", "contact"]}))])
case("64 update posts to rpc/update_person with the code, the details as a list, role and organization",
     code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/update_person"
     and reqs[0]["body"] == {"person_code": "DD-01", "contacts": ["https://emergency.metro.edu/content/casey-lane"],
                             "role": "Resident", "organization": "Metro", "via": "claude"}, (code, out + err, reqs))
case("64 update prints one line naming the person and what changed",
     code == 0 and len(lines(out)) == 1 and "DD-01" in out and "contact" in out, out + err)
code, out, err, reqs, _ = run(["update", "--person", "DD-01", "--contact-file", contact_file("a@b-org.example.org")],
                              [(200, json.dumps({"person_code": "DD-01", "changed": []}))])
case("64 update that adds nothing says so in one line", code == 0 and len(lines(out)) == 1 and "nothing new" in out, out + err)
REFUSAL = 'contact detail "iMessage" is not an email, phone, LinkedIn or web link'
code, out, err, reqs, _ = run(["update", "--person", "DD-01", "--contact-file", contact_file("iMessage")],
                              [(400, json.dumps({"code": "23514", "message": REFUSAL}))])
case("64 case 17 a refusal from the database is printed as is, exit 2", one_plain_line(code, 2, out, err)
     and (out + err).strip() == REFUSAL, (code, out + err))
code, out, err, reqs, _ = run(["add", "--name", "Eleven", "--contact-file",
                               contact_file("\n".join("e%d@x-org.example.org" % i for i in range(11)))],
                              [(400, json.dumps({"code": "23514", "message": "at most 10 contact details in one call: 11 given"}))])
case("64 eleven details are sent and the database's refusal is printed", one_plain_line(code, 2, out, err)
     and "at most 10" in out + err and len(reqs) == 1 and len(reqs[0]["body"]["contacts"]) == 11, (code, out + err))
code, out, err, reqs, _ = run(["find", "metro"], [(200, json.dumps([{
    "person_code": "DD-01", "name": "Casey Lane", "role": None, "organization": "Metro", "owner": "delta",
    "status": "contacted", "last_touch_date": None, "last_touch_channel": None, "last_touch_text": None,
    "contact": ["a@b-org.example.org", "https://www.linkedin.com/in/x/", "https://emergency.metro.edu/content/x"]}]))])
case("64 find shows contact: with every detail joined by a comma",
     code == 0 and "contact: a@b-org.example.org, https://www.linkedin.com/in/x/, https://emergency.metro.edu/content/x" in out, out + err)

# ---------------------------------------------------------------- 3. touch
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what", "Sent the intro note",
                               "--next", "Follow up", "--due", "2026-11-27", "--date", "2026-11-20", "--by", "bravo",
                               "--status", "replied"], [fixture("touch_ok")])
case("3 touch posts to rpc/log_touch with every argument",
     len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/log_touch"
     and reqs[0]["body"] == {"person_code": "CC-01", "channel": "email", "what": "Sent the intro note", "next_step": "Follow up",
                             "next_due": "2026-11-27", "date": "2026-11-20", "by": "bravo", "status": "replied", "via": "claude"}, reqs)
case("3 touch prints one line with the touch and the status", code == 0 and len(lines(out)) == 1 and "CC-01" in out
     and "contacted" in out, out + err)
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what", "x", "--date", "11/22"])
case("3 --date 11/22 is refused with no request made", one_plain_line(code, 2, out, err) and reqs == [], (out + err, reqs))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what", "x", "--due", "2026-13-45"])
case("3 --due that is no real date is refused with no request made", one_plain_line(code, 2, out, err) and reqs == [], out + err)
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what=- text"], [fixture("touch_ok")])
case("3 --what=\"- text\" is sent as given", code == 0 and len(reqs) == 1 and reqs[0]["body"].get("what") == "- text", reqs)
nasty = "She said \"no\".\nSecond line'); drop table contacts; -- $(rm -rf ~) `id`"
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what", nasty], [fixture("touch_ok")])
case("3 quotes, a line break and SQL in a value are sent as text, unchanged",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("what") == nasty, reqs)
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "fax", "--what", "x"], [fixture("touch_bad_channel")])
case("3 a channel outside the six is refused by the database: exit 2 with its sentence",
     one_plain_line(code, 2, out, err) and "the channel 'fax' is not one of" in out + err, out + err)

# ---------------------------------------------------------------- issue 63: the text channel
import team  # noqa: E402
chans = list(team.CHANNELS)
case("issue 63 case 5 team.CHANNELS holds text between phone and intro",
     "text" in chans and chans.index("text") == chans.index("phone") + 1 and chans.index("intro") == chans.index("text") + 1,
     chans)
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "text", "--what", "Texted about a time"],
                              [fixture("touch_ok")])
case("issue 63 case 6 touch --channel text posts to rpc/log_touch with channel text",
     code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/log_touch"
     and reqs[0]["body"].get("channel") == "text", (code, out + err, reqs))

# ---------------------------------------------------------------- issue 65: log, a person and their touches in one call
LOG_RID = "6f1d5b8e-6565-4e1a-9c65-0000000000a1"
LOG_BODY = {"person": {"name": "Casey Lane", "organization": "Metro",
                       "contact": ["casey@example-test.example.org", "https://www.linkedin.com/in/casey-lane-x/"]},
            "touches": [{"channel": "text", "what": "Texted her about the study.", "date": "2026-11-20"},
                        {"channel": "email", "what": "Emailed her colleague.", "status": "contacted"}],
            "request_id": LOG_RID}
LOG_OK = (200, json.dumps({"person_code": "DD-02", "slug": "casey-lane", "name": "Casey Lane", "owner": "delta",
                           "status": "contacted", "touches": 2, "touch_ids": [7, 8], "request_id": LOG_RID}))


def log_file(doc):
    return str(temp_file(doc if isinstance(doc, str) else json.dumps(doc), "log.json"))


code, out, err, reqs, _ = run(["log", "--json-file", log_file(LOG_BODY)], [LOG_OK])
case("65 case 11 log reads the file and sends one call to rpc/add_person_with_touches with person, touches and the request id",
     code == 0 and len(reqs) == 1 and reqs[0]["method"] == "POST" and path_of(reqs[0]) == "/rest/v1/rpc/add_person_with_touches"
     and reqs[0]["body"] == {"person": LOG_BODY["person"], "touches": LOG_BODY["touches"], "request_id": LOG_RID,
                             "via": "claude"}, (code, out + err, reqs))
case("65 case 11 and prints one line: added, code, name, owner, status and how many touches",
     code == 0 and out.strip() == "added DD-02: Casey Lane, owner delta, status contacted, 2 touches", out + err)
for bad, why in (("{not json", "not JSON"), ("[1, 2]", "an array"), ('"text"', "a string"), ("", "empty")):
    code, out, err, reqs, _ = run(["log", "--json-file", log_file(bad)])
    case("65 case 12 a file that is %s: exit 2 in one line, nothing sent" % why,
         one_plain_line(code, 2, out, err) and reqs == [] and "--json-file" in err, (code, out + err, reqs))
code, out, err, reqs, _ = run(["log", "--json-file", str(Path(tempfile.gettempdir()) / "hubtest-none" / "log.json")])
case("65 case 12 a file that is not there: exit 2, nothing sent", one_plain_line(code, 2, out, err) and reqs == [], (code, out + err))
for doc, said in (({"person": {"name": "A"}}, "touches"), ({"touches": [{"channel": "email", "what": "x"}]}, "person"),
                  (dict(LOG_BODY, extra=1), "extra"), (dict(LOG_BODY, person="Casey"), "person"),
                  (dict(LOG_BODY, touches={"channel": "email"}), "touches"),
                  (dict(LOG_BODY, request_id="not-a-uuid"), "request_id")):
    code, out, err, reqs, _ = run(["log", "--json-file", log_file(doc)])
    case("65 a log file with a bad or missing %s: exit 2 in one line naming it, nothing sent" % said,
         one_plain_line(code, 2, out, err) and reqs == [] and said in err, (code, out + err, reqs))
code, out, err, reqs, home = run(["log", "--json-file", log_file(LOG_BODY)], [hub.Unreachable(sent=True)])
case("65 case 13 no answer after sending: exit 1, not known whether it was saved, and the same file is safe to send again",
     one_plain_line(code, 1, out, err) and "not known whether this was saved" in err
     and "same file" in err and "never saved twice" in err, (code, out + err))
code, out, err, reqs, _ = run(["log", "--json-file", log_file(LOG_BODY)], [hub.Unreachable(sent=False)])
case("65 nothing sent: exit 1 saying nothing was sent", one_plain_line(code, 1, out, err) and "nothing was sent" in err,
     (code, out + err))
no_rid = {k: v for k, v in LOG_BODY.items() if k != "request_id"}
code, out, err, reqs, home = run(["log", "--json-file", log_file(no_rid)], [LOG_OK])
first = reqs[0]["body"].get("request_id") if reqs else None
code2, out2, err2, reqs2, _ = run(["log", "--json-file", log_file(no_rid)], [LOG_OK], home=home)
case("65 with no request id in the file, hub.py sends one made from the file and the teammate, the same on a second run",
     code == code2 == 0 and isinstance(first, str) and re.fullmatch(r"[0-9a-f-]{36}", first)
     and reqs2[0]["body"].get("request_id") == first, (first, reqs2 and reqs2[0]["body"].get("request_id")))
changed = dict(no_rid, touches=[{"channel": "email", "what": "Something else."}])
code3, out3, err3, reqs3, _ = run(["log", "--json-file", log_file(changed)], [LOG_OK], home=home)
case("65 and a different file makes a different one", code3 == 0 and reqs3[0]["body"].get("request_id") != first,
     reqs3 and reqs3[0]["body"])
code, out, err, reqs, _ = run(["log", "--json-file", log_file(LOG_BODY)],
                              [(200, json.dumps(dict(json.loads(LOG_OK[1]), repeat=True)))])
case("65 the same request again: exit 0, one line saying it was already logged and nothing new was written",
     code == 0 and out.strip() == "already logged DD-02: Casey Lane, owner delta, status contacted, 2 touches (nothing new written)",
     out + err)
code, out, err, reqs, _ = run(["log", "--json-file", log_file(dict(LOG_BODY, touches=LOG_BODY["touches"][:1]))],
                              [(200, json.dumps(dict(json.loads(LOG_OK[1]), touches=1, touch_ids=[7])))])
case("65 one touch is said as 1 touch", code == 0 and out.strip().endswith("status contacted, 1 touch"), out + err)
REFUSAL = "touch 2: channel 'sms' is not allowed: use email, linkedin, phone, text, intro, in-person or other"
code, out, err, reqs, _ = run(["log", "--json-file", log_file(LOG_BODY)], [(400, json.dumps({"code": "P0001", "message": REFUSAL}))])
case("65 a refusal from the database is printed as is, exit 2", one_plain_line(code, 2, out, err) and err.strip() == REFUSAL,
     (code, out + err))
code, out, err, reqs, _ = run(["log", "--json-file", "-"], [LOG_OK], stdin=json.dumps(LOG_BODY))
case("65 --json-file - reads standard input", code == 0 and len(reqs) == 1 and reqs[0]["body"]["person"] == LOG_BODY["person"],
     (code, out + err))
code, out, err, reqs, _ = run(["log", "--json-file", log_file(LOG_BODY), "--json"], [LOG_OK])
case("65 --json prints the hub's answer", code == 0 and json.loads(out).get("person_code") == "DD-02", out + err)
code, out, err, reqs, _ = run(["log", "--json-file", log_file(LOG_BODY)], home=new_home(signed_in=False))
case("65 signed out: exit 3, nothing sent", code == 3 and reqs == [], (code, out + err, reqs))

# ---------------------------------------------------------------- 4. status, owner, inbox confirm, inbox dismiss
code, out, err, reqs, _ = run(["status", "--person", "CC-01", "--to", "declined"], [fixture("status_ok")])
case("4 status posts to rpc/set_status", code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/set_status"
     and reqs[0]["body"] == {"person_code": "CC-01", "status": "declined", "via": "claude"}, reqs)
code, out, err, reqs, _ = run(["owner", "--person", "CC-01", "--to", "alpha"], [fixture("owner_ok")])
case("4 owner posts to rpc/set_owner", code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/set_owner"
     and reqs[0]["body"] == {"person_code": "CC-01", "owner": "alpha", "via": "claude"}, reqs)
code, out, err, reqs, _ = run(["inbox", "confirm", "--id", "5", "--person", "CC-01", "--consent", "yes"], [fixture("confirm_ok")])
case("4 inbox confirm posts to rpc/confirm_recording with consent true",
     code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/confirm_recording"
     and reqs[0]["body"] == {"inbox_id": 5, "person_code": "CC-01", "consent_to_record": True, "via": "claude"}
     and "12" in out and "CC-01" in out, (reqs, out + err))
for argv, why in ((["inbox", "confirm", "--id", "5", "--person", "CC-01"], "without --consent"),
                  (["inbox", "confirm", "--id", "5", "--person", "CC-01", "--consent", "unknown"], "with --consent unknown"),
                  (["inbox", "confirm", "--id", "5", "--person", "CC-01", "--consent", "no"], "with --consent no")):
    code, out, err, reqs, _ = run(argv)
    case("4 inbox confirm %s is refused with no request made" % why, one_plain_line(code, 2, out, err) and reqs == [],
         (code, out + err, reqs))
code, out, err, reqs, _ = run(["inbox", "dismiss", "--id", "5", "--reason", "A team check-in, not an interview"],
                              [fixture("dismiss_ok")])
case("4 inbox dismiss posts to rpc/dismiss_recording", code == 0 and len(reqs) == 1
     and path_of(reqs[0]) == "/rest/v1/rpc/dismiss_recording"
     and reqs[0]["body"] == {"inbox_id": 5, "reason": "A team check-in, not an interview", "via": "claude"}, reqs)
code, out, err, reqs, _ = run(["inbox", "list"], [fixture("inbox_list")])
case("4 inbox list reads call_inbox (never the transcript) and prints one line per waiting item",
     code == 0 and len(reqs) == 1 and reqs[0]["method"] == "GET" and path_of(reqs[0]).startswith("/rest/v1/call_inbox?")
     and "transcript" not in path_of(reqs[0]) and "state=eq.waiting" in path_of(reqs[0])
     and len(lines(out)) == 2 and "no person matches an attendee" in lines(out)[0], (reqs, out + err))

# ---------------------------------------------------------------- 5. list
code, out, err, reqs, _ = run(["list", "--followup", "--owner", "bravo"],
                              [fixture("sales"), fixture("follow_ups_bravo"), fixture("contacts_bravo")])
follow = [r for r in reqs if "/rest/v1/follow_ups?" in r["url"]]
case("5 list --followup --owner bravo reads follow_ups filtered by that owner, and only reads",
     code == 0 and len(follow) == 1 and "owner_id=eq.2" in follow[0]["url"] and all(r["method"] == "GET" for r in reqs),
     (code, out + err, [r["url"] for r in reqs]))
got = lines(out)
case("5 it prints person, next step and due date, soonest first, with no due date last",
     len(got) == 3 and got[0].startswith("BB-02") and "Send the consent form" in got[0] and "2026-11-24" in got[0]
     and got[1].startswith("BB-07") and "2026-11-27" in got[1] and got[2].startswith("BB-05"), out + err)
case("5 a person who asked not to be contacted is left off the follow-up list", "BB-09" not in out, out)
code, out, err, reqs, _ = run(["list", "--owner", "bravo", "--status", "replied"],
                              [fixture("sales"), fixture("contacts_bravo"), fixture("companies")])
people = [r for r in reqs if "/rest/v1/contacts?" in r["url"]]
case("5 list --owner --status reads contacts with both filters",
     code == 0 and len(people) == 1 and "sales_id=eq.2" in people[0]["url"] and "status=eq.replied" in people[0]["url"]
     and all(r["method"] == "GET" for r in reqs), (code, out + err, [r["url"] for r in reqs]))
code, out, err, reqs, _ = run(["list", "--owner", "bob"], [fixture("sales")])
case("5 list --owner with a handle nobody has is refused", one_plain_line(code, 2, out, err), out + err)

# ---------------------------------------------------------------- 6 to 9. pages
THREE = GRANOLA / "three-pages"
EMOJI = GRANOLA / "accents-emoji"
expected = json.loads((THREE / "expected.json").read_text(encoding="utf-8"))
expected_emoji = json.loads((EMOJI / "expected.json").read_text(encoding="utf-8"))


def submit_args(folder, pages=None, consent="yes", without_id=True):
    # The fixture pages carry no meeting id, so the teammate's confirmation
    # (issue 47 item 3) is given unless a case is about it.
    return (["recording", "submit", "--meta", str(folder / "meta.json"), "--pages", str(pages or folder),
             "--overview", str(folder / "overview.md"), "--consent", consent, "--hypotheses", str(folder / "hypotheses.json")]
            + (["--pages-without-id"] if without_id else []))


def page_objects(folder):
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(folder.glob("page-*.json"))]


def pages_dir(objects, names=None):
    """A folder of page files. objects are written as JSON; a str is written as it is."""
    folder = Path(tempfile.mkdtemp(prefix="hubpages-"))
    for index, obj in enumerate(objects):
        name = names[index] if names else "page-%04d.json" % (index + 1)
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
        (folder / name).write_text(text, encoding="utf-8")
    return folder


def cut(text, bounds):
    """Pages of a text cut at the given offsets, as the connector documents them."""
    edges = [0] + list(bounds) + [len(text)]
    return [{"transcript": text[a:b], "total_chars": len(text), "truncated": b != len(text),
             "next_offset": None if b == len(text) else b} for a, b in zip(edges, edges[1:])]


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


code, out, err, reqs, _ = run(submit_args(THREE), [fixture("submit_saved")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("6 three pages that chain join to the reported total and one rpc/submit_recording is posted",
     code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/submit_recording" and reqs[0]["method"] == "POST",
     (code, out + err, len(reqs)))
case("6 it carries the whole text and reported_chars",
     len(body.get("transcript", "")) == expected["chars"] == 2026 and body.get("reported_chars") == expected["chars"], body.keys())
case("6 and the meeting's details, the overview, the links, consent and via claude",
     body.get("granola_id") == "fixture-three-pages-0001" and body.get("source") == "granola"
     and body.get("recorded_on") == "2026-11-17" and body.get("title", "").startswith("CRM Kit interview")
     and body.get("attendee_emails") == ["fixture.guest@clinic-example.example.org", "teammate@team-example.example.org"]
     and body.get("overview") == (THREE / "overview.md").read_text(encoding="utf-8")
     and body.get("hypotheses") == json.loads((THREE / "hypotheses.json").read_text(encoding="utf-8"))
     and body.get("consent_to_record") is True and body.get("via") == "claude", {k: v for k, v in body.items() if k != "transcript"})
case("9 the joined text is byte for byte the pages' text in order (hash equals the fixture's known hash)",
     sha(body.get("transcript", "")) == expected["sha256"], sha(body.get("transcript", "")))
case("10 answered saved: prints the person code", code == 0 and "CC-01" in out and "12" in out and len(lines(out)) == 1, out + err)

for consent, want in (("no", False), ("unknown", None)):
    code, out, err, reqs, _ = run(submit_args(THREE, consent=consent), [fixture("submit_inbox")])
    sent = reqs[0]["body"] if reqs else {}
    case("6 --consent %s is sent as %s" % (consent, "false" if want is False else "not known (left out)"),
         code == 0 and len(reqs) == 1 and sent.get("consent_to_record", None) is want, sent.get("consent_to_record", "(absent)"))

pages = page_objects(THREE)
full = "".join(p["transcript"] for p in pages)
second_twice = [pages[0], pages[1], pages[1], pages[2]]
overlap = cut(full, [701, 1388])
overlap[1] = dict(overlap[1], transcript=full[650:1388])
still_truncated = [pages[0], pages[1], dict(pages[2], truncated=True, next_offset=2026)]
one_short = [pages[0], pages[1], dict(pages[2], transcript=pages[2]["transcript"][:-1])]
ends_early = [pages[0], dict(pages[1], truncated=False, next_offset=None), pages[2]]
refusals = [
    ("a missing middle page (file 2 absent)", pages_dir([pages[0], pages[2]], ["page-0001.json", "page-0003.json"]), "page 2"),
    ("a missing middle page (files renumbered)", pages_dir([pages[0], pages[2]]), "page 2"),
    ("pages whose offsets overlap", pages_dir(overlap), "page 2"),
    ("the same page twice", pages_dir(second_twice), "page 3"),
    ("a page out of order by file name", pages_dir([pages[0], pages[2], pages[1]]), "page 2"),
    ("the last page still marked truncated", pages_dir(still_truncated), "page 3"),
    ("the joined total one short of reported", pages_dir(one_short), "page 3"),
    ("a page that says the transcript ends with pages after it", pages_dir(ends_early), "page 2"),
    ("an empty folder", pages_dir([]), "no page"),
    ("a page file that is not JSON", pages_dir([pages[0], "this is not json {", pages[2]]), "page 2"),
    ("a page with no transcript (the free plan)", pages_dir([{"transcript": None, "transcript_unavailable": {"reason": "no_transcript"}}]), "page 1"),
    ("pages that disagree on the total", pages_dir([pages[0], dict(pages[1], total_chars=2027), pages[2]]), "page 2"),
]
for label, folder, names in refusals:
    code, out, err, reqs, _ = run(submit_args(THREE, pages=folder))
    case("7 refused with no request made and the page named: " + label,
         one_plain_line(code, 2, out, err) and reqs == [] and names in out + err, (code, out + err, len(reqs)))

missing = Path(tempfile.mkdtemp(prefix="hubpages-")) / "not-there"
code, out, err, reqs, _ = run(submit_args(THREE, pages=missing))
case("7 a page folder that does not exist is refused with no request made", one_plain_line(code, 2, out, err) and reqs == [], out + err)

single = "".join(p["transcript"] for p in pages)
code, out, err, reqs, _ = run(submit_args(THREE, pages=pages_dir(cut(single, []))), [fixture("submit_saved")])
case("6 a transcript of one page is accepted", code == 0 and len(reqs) == 1 and sha(reqs[0]["body"]["transcript"]) == expected["sha256"],
     out + err)
long_text = (single * 30)[:56000]
fourteen = cut(long_text, [4000 * n for n in range(1, 14)])
code, out, err, reqs, _ = run(submit_args(THREE, pages=pages_dir(fourteen)), [fixture("submit_saved")])
case("6 a transcript of 14 pages is accepted whole", code == 0 and len(fourteen) == 14 and len(reqs) == 1
     and reqs[0]["body"]["transcript"] == long_text and reqs[0]["body"]["reported_chars"] == 56000, out + err)
wrapped = [{"meetings": [p]} for p in pages]
code, out, err, reqs, _ = run(submit_args(THREE, pages=pages_dir(wrapped)), [fixture("submit_saved")])
case("6 pages saved from a call that named the meeting in a list are read the same way",
     code == 0 and len(reqs) == 1 and sha(reqs[0]["body"]["transcript"]) == expected["sha256"], out + err)
with_offsets = [dict(p, offset=o) for p, o in zip(pages, (0, 701, 1388))]
code, out, err, reqs, _ = run(submit_args(THREE, pages=pages_dir(with_offsets)), [fixture("submit_saved")])
case("6 pages that also state their own offset are accepted when it agrees", code == 0 and len(reqs) == 1, out + err)
with_offsets[2] = dict(with_offsets[2], offset=1400)
code, out, err, reqs, _ = run(submit_args(THREE, pages=pages_dir(with_offsets)))
case("7 and refused, naming the page, when a page's own offset is not where the one before ended",
     one_plain_line(code, 2, out, err) and reqs == [] and "page 3" in out + err, out + err)

code, out, err, reqs, _ = run(submit_args(EMOJI), [fixture("submit_saved")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("8 pages with emoji and accented text are accepted when complete, counted in characters",
     code == 0 and expected_emoji["chars"] != expected_emoji["utf8_bytes"] and body.get("reported_chars") == expected_emoji["chars"]
     and len(body.get("transcript", "")) == expected_emoji["chars"] and sha(body.get("transcript", "")) == expected_emoji["sha256"],
     (code, out + err))
emoji_pages = page_objects(EMOJI)
for label, where, char in (("an accented letter", 0, "\u00ed"), ("an emoji", 1, "\U0001F44D")):
    text = emoji_pages[where]["transcript"]
    at = text.index(char)
    dropped = list(emoji_pages)
    dropped[where] = dict(dropped[where], transcript=text[:at] + text[at + 1:])
    code, out, err, reqs, _ = run(submit_args(EMOJI, pages=pages_dir(dropped)))
    case("8 refused with no request made when %s is dropped" % label,
         one_plain_line(code, 2, out, err) and reqs == [] and "page %d" % (where + 1) in out + err, (code, out + err))
in_bytes = [dict(p, total_chars=expected_emoji["utf8_bytes"]) for p in emoji_pages]
code, out, err, reqs, _ = run(submit_args(EMOJI, pages=pages_dir(in_bytes)))
case("8 a total that only fits when counted in bytes is refused, and the line says so",
     one_plain_line(code, 2, out, err) and reqs == [] and "bytes" in out + err, (code, out + err))

# ---------------------------------------------------------------- 10. the three answers to a submit
code, out, err, reqs, _ = run(submit_args(THREE), [fixture("submit_inbox")])
case("10 answered inbox: prints the reason and exits 0",
     code == 0 and len(lines(out)) == 1 and "inbox" in out and "no person matches an attendee" in out and "5" in out, out + err)
code, out, err, reqs, _ = run(submit_args(THREE), [fixture("submit_already")])
case("10 answered \"already saved\": exits 0 with that line",
     code == 0 and len(lines(out + err)) == 1 and "already saved as interview 12 for CC-01" in out, (code, out + err))
code, out, err, reqs, _ = run(submit_args(THREE), [fixture("submit_cut_short")])
case("10 any other refusal of a submit is exit 2 with the database's sentence",
     one_plain_line(code, 2, out, err) and "the transcript is cut short: 2025 of 2026 characters" in out + err, out + err)
bad_meta = temp_file(json.dumps({"granola_id": "x", "title": "t", "date": "17 Nov", "attendee_emails": []}), "meta.json")
code, out, err, reqs, _ = run(["recording", "submit", "--meta", str(bad_meta), "--pages", str(THREE),
                               "--overview", str(THREE / "overview.md"), "--consent", "yes"])
case("10 a meta file whose date is not YYYY-MM-DD is refused with no request made",
     one_plain_line(code, 2, out, err) and reqs == [], out + err)
code, out, err, reqs, _ = run(["recording", "known", "--ids", "g-aaa,g-bbb,g-ccc"], [fixture("known_interviews"), fixture("known_inbox")])
case("10 recording known reads interviews and the inbox and prints the ids already held, one per line",
     code == 0 and len(reqs) == 2 and all(r["method"] == "GET" for r in reqs)
     and sorted(ln.split()[0] for ln in lines(out)) == ["g-aaa", "g-bbb"] and "g-ccc" not in out, (out + err, [r["url"] for r in reqs]))

# ---------------------------------------------------------------- 11. paste
overview = THREE / "overview.md"
short = temp_file("x" * 900)
code, out, err, reqs, _ = run(["recording", "paste", "--person", "CC-01", "--date", "2026-11-20", "--title", "Interview: Maria Okafor",
                               "--transcript", str(short), "--overview", str(overview), "--consent", "yes"])
case("11 recording paste with a 900 character file is refused with no request made",
     one_plain_line(code, 2, out, err) and reqs == [] and "900" in out + err, (code, out + err))
pasted_text = ("Me: how long did they wait?\r\nHer: \u201cabout two hours\u201d, caf\u00e9 time. \U0001F642\n" * 40)[:1500]
pasted = temp_file(pasted_text)
code, out, err, reqs, _ = run(["recording", "paste", "--person", "CC-01", "--date", "2026-11-20", "--title", "Interview: Maria Okafor",
                               "--transcript", str(pasted), "--overview", str(overview), "--consent", "yes"],
                              [fixture("save_interview_ok")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("11 with a 1500 character file it posts rpc/save_interview with source paste and no reported_chars",
     code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/save_interview" and body.get("source") == "paste"
     and "reported_chars" not in body and "granola_id" not in body and body.get("person_code") == "CC-01"
     and body.get("date") == "2026-11-20" and body.get("consent_to_record") is True and body.get("via") == "claude",
     (code, out + err, {k: v for k, v in body.items() if k != "transcript"}))
case("11 the pasted text goes in as it is in the file, line endings included", body.get("transcript") == pasted_text,
     sha(body.get("transcript", "")))
code, out, err, reqs, _ = run(["recording", "paste", "--person", "CC-01", "--date", "2026-11-20", "--title", "t",
                               "--transcript", str(pasted), "--overview", str(overview), "--consent", "unknown"])
case("11 recording paste without consent yes is refused with no request made",
     one_plain_line(code, 2, out, err) and reqs == [], out + err)

# ---------------------------------------------------------------- 12. a session that ended, and a lost reply
code, out, err, reqs, _ = run(["find", "maria"], [fixture("unauthorized")])
case("12 a recorded 401 gives exit 3 and the sign-in line",
     one_plain_line(code, 3, out, err) and "python3 scripts/hub.py login" in out + err, (code, out + err))
code, out, err, reqs, _ = run(["find", "maria"], home=new_home(signed_in=False))
case("12 with no session: exit 3 and the sign-in line, and no request made",
     one_plain_line(code, 3, out, err) and "python3 scripts/hub.py login" in out + err and reqs == [], (code, out + err))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what", "x"], [hub.Unreachable(sent=True)])
case("12 a recorded timeout on a write gives exit 1 and \"not known whether this was saved\"",
     one_plain_line(code, 1, out, err) and "not known whether this was saved" in out + err, (code, out + err))
case("12 and no second request", len(reqs) == 1, len(reqs))
code, out, err, reqs, _ = run(submit_args(THREE), [hub.Unreachable(sent=True)])
case("12 the same for a recording, with no second request",
     one_plain_line(code, 1, out, err) and "not known whether this was saved" in out + err and len(reqs) == 1, (code, out + err))
code, out, err, reqs, _ = run(["find", "maria"], [hub.Unreachable(sent=False)])
case("12 no network on a read: exit 1, one line, and it does not claim anything may have been saved",
     one_plain_line(code, 1, out, err) and "not known whether" not in out + err, (code, out + err))
for name in ("html_error", "html_ok"):
    code, out, err, reqs, _ = run(["add", "--name", "Maria Okafor"], [fixture(name)])
    case("12 an HTML page where JSON was expected (%s): exit 1, one line, no stack trace, the page not echoed" % name,
         one_plain_line(code, 1, out, err) and "<html" not in out + err, (code, out + err))
code, out, err, reqs, _ = run(["status", "--person", "CC-01", "--to", "declined"], [fixture("no_handle")])
case("12 a teammate with no handle is told the plain line",
     one_plain_line(code, 2, out, err) and "you have no handle yet: ask the administrator" in out + err, out + err)

# ---------------------------------------------------------------- 13. the session
home = new_home(signed_in=False, url=LOCAL)
code, out, err, reqs, _ = run(["login", "--password", "--email", "fixture@example.org"], [token_answer(), fixture("whoami")], home=home, url=LOCAL,
                              env={"HUB_TEST_PASSWORD": PASSWORD})
session_file = home / "session.json"
case("13 login on a local hub with the test password signs in with one request to the auth API",
     code == 0 and reqs and reqs[0]["method"] == "POST" and reqs[0]["url"] == LOCAL + "/auth/v1/token?grant_type=password"
     and reqs[0]["body"] == {"email": "fixture@example.org", "password": PASSWORD}, (code, out + err, [r["url"] for r in reqs]))
case("13 the session file is written with mode 600 in a folder of mode 700 under CRM_KIT_HOME",
     session_file.is_file() and stat.S_IMODE(session_file.stat().st_mode) == 0o600
     and stat.S_IMODE(home.stat().st_mode) == 0o700,
     (session_file.is_file() and oct(session_file.stat().st_mode), home.is_dir() and oct(home.stat().st_mode)))
stored = json.loads(session_file.read_text(encoding="utf-8")) if session_file.is_file() else {}
case("13 it holds the tokens and the expiry, and no password",
     {"access_token", "refresh_token", "expires_at"} <= set(stored) and PASSWORD not in json.dumps(stored), sorted(stored))
code, out, err, reqs, _ = run(["whoami"], [fixture("whoami")], home=home, url=LOCAL)
case("13 whoami reads sales for this sign-in and prints the handle and the prefix",
     code == 0 and len(reqs) == 1 and reqs[0]["method"] == "GET" and "/rest/v1/sales?" in reqs[0]["url"]
     and "user_id=eq." + USER_ID in reqs[0]["url"] and "bravo" in out and "BB" in out
     and reqs[0]["headers"].get("Authorization") == "Bearer " + stored.get("access_token", "?"), (out + err, reqs))
code, out, err, reqs, _ = run(["whoami"], [fixture("whoami_no_handle")], home=home, url=LOCAL)
case("13 whoami for a teammate with no handle says so", one_plain_line(code, 2, out, err)
     and "you have no handle yet: ask the administrator" in out + err, out + err)
code, out, err, reqs, _ = run(["logout"], home=home, url=LOCAL)
case("13 logout removes the session file", code == 0 and not session_file.exists(), (code, out + err))

checkout = Path(tempfile.mkdtemp(prefix="hubtest-"))
(checkout / ".git").mkdir()
inside = checkout / "sub" / "crm-kit"
code, out, err, reqs, _ = run(["login", "--password", "--email", "fixture@example.org"], [token_answer(), fixture("whoami")], home=inside, url=LOCAL,
                              env={"HUB_TEST_PASSWORD": PASSWORD})
case("13 a hub folder inside a git checkout is refused, before any request, and nothing is written there",
     one_plain_line(code, 2, out, err) and reqs == [] and not inside.exists(), (code, out + err, len(reqs)))
code, out, err, reqs, _ = run(["find", "maria"], [fixture("find_one")], home=inside)
case("13 and every other command refuses it too", one_plain_line(code, 2, out, err) and reqs == [], (code, out + err))

home = new_home(expires_in=20)
before = json.loads((home / "session.json").read_text(encoding="utf-8"))
code, out, err, reqs, _ = run(["find", "maria"], [token_answer(), fixture("find_one")], home=home)
after = json.loads((home / "session.json").read_text(encoding="utf-8"))
case("13 a session near its end is renewed once, with the refresh token, before the call",
     code == 0 and len(reqs) == 2 and reqs[0]["url"] == URL + "/auth/v1/token?grant_type=refresh_token"
     and reqs[0]["body"] == {"refresh_token": before["refresh_token"]}, (code, out + err, [r["url"] for r in reqs]))
case("13 the new session is stored (mode 600) and the call carries the new access token",
     after["access_token"] != before["access_token"] and after["refresh_token"] != before["refresh_token"]
     and len(reqs) == 2 and reqs[1]["headers"].get("Authorization") == "Bearer " + after["access_token"]
     and stat.S_IMODE((home / "session.json").stat().st_mode) == 0o600, sorted(after))
code, out, err, reqs, _ = run(["find", "maria"], [fixture("find_one")], home=home)
case("13 the next run does not renew again", code == 0 and len(reqs) == 1 and "/rpc/find_person" in reqs[0]["url"], [r["url"] for r in reqs])
home = new_home(expires_in=20)
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what", "x"], [fixture("refresh_used")], home=home)
case("13 a refresh token already used by another run: exit 3 with the line to type, nothing written",
     one_plain_line(code, 3, out, err) and "python3 scripts/hub.py login" in out + err and len(reqs) == 1
     and "/auth/v1/token" in reqs[0]["url"], (code, out + err, [r["url"] for r in reqs]))
home = new_home(url="https://another-hub.example")
code, out, err, reqs, _ = run(["find", "maria"], home=home)
case("13 a session made for another hub address is never sent to this one",
     one_plain_line(code, 3, out, err) and reqs == [], (code, out + err, len(reqs)))

# ---------------------------------------------------------------- 14. login needs a terminal
home = new_home(signed_in=False)
code, out, err, reqs, _ = run(["login", "--password"], home=home)
case("14 login --password with input that is not a terminal exits 2 and asks for nothing",
     one_plain_line(code, 2, out, err) and reqs == [] and "run this yourself in a terminal" in out + err
     and "mail" not in (out + err).lower() and "password" not in (out + err).lower(), (code, out + err))
code, out, err, reqs, _ = run(["login", "--password", "--email", "fixture@example.org"], home=home, env={"HUB_TEST_PASSWORD": PASSWORD})
case("14 the test password is ignored when the hub is not on this machine",
     one_plain_line(code, 2, out, err) and reqs == [] and not (home / "session.json").exists(), (code, out + err))
code, out, err, reqs, _ = run(["login", "--password", "--email", "fixture@example.org"], [fixture("login_bad")], home=new_home(signed_in=False, url=LOCAL),
                              url=LOCAL, env={"HUB_TEST_PASSWORD": PASSWORD})
case("14 a sign-in the hub does not accept is exit 2 in one line", one_plain_line(code, 2, out, err), (code, out + err))

# ---------------------------------------------------------------- 16. where the address and the key come from
keep_root = hub.ROOT
try:
    fake_root = Path(tempfile.mkdtemp(prefix="hubroot-"))
    hub.ROOT = fake_root
    (fake_root / "hub.json").write_text(json.dumps({"url": "https://from-repo.example", "publishable_key": "key-repo"}))
    home = new_home(url="https://from-env.example")
    (home / "config.json").write_text(json.dumps({"url": "https://from-folder.example", "publishable_key": "key-folder"}))
    code, out, err, reqs, _ = run(["find", "maria"], [fixture("find_one")], home=home, url="https://from-env.example", key="key-env")
    case("16 the environment beats the hub folder and hub.json",
         code == 0 and len(reqs) == 1 and reqs[0]["url"].startswith("https://from-env.example/")
         and reqs[0]["headers"].get("apikey") == "key-env", (code, out + err, reqs))
    home = new_home(url="https://from-folder.example")
    (home / "config.json").write_text(json.dumps({"url": "https://from-folder.example", "publishable_key": "key-folder"}))
    code, out, err, reqs, _ = run(["find", "maria"], [fixture("find_one")], home=home, url=None)
    case("16 the hub folder's config.json beats hub.json",
         code == 0 and len(reqs) == 1 and reqs[0]["url"].startswith("https://from-folder.example/")
         and reqs[0]["headers"].get("apikey") == "key-folder", (code, out + err, reqs))
    home = new_home(url="https://from-repo.example")
    code, out, err, reqs, _ = run(["find", "maria"], [fixture("find_one")], home=home, url=None)
    case("16 with neither, hub.json at the repo root is used",
         code == 0 and len(reqs) == 1 and reqs[0]["url"].startswith("https://from-repo.example/")
         and reqs[0]["headers"].get("apikey") == "key-repo", (code, out + err, reqs))
    (fake_root / "hub.json").unlink()
    for argv in (["find", "maria"], ["whoami"], ["add", "--name", "Maria Okafor"], ["inbox", "list"], submit_args(THREE)):
        code, out, err, reqs, _ = run(argv, home=new_home(), url=None)
        case("16 with none of the three, %s exits 1 with the plain line" % argv[0],
             one_plain_line(code, 1, out, err) and "the hub's address is not set yet" in out + err and reqs == [], (code, out + err))
    code, out, err, reqs, _ = run(["find", "maria"], home=new_home(url="http://hub.fixture.example"), url="http://hub.fixture.example")
    case("16 an address that is not https, and not this machine, is refused with no request made",
         code in (1, 2) and len(lines(out + err)) == 1 and reqs == [], (code, out + err))
    service_like = ".".join(base64.urlsafe_b64encode(json.dumps(p).encode()).decode().rstrip("=")
                            for p in ({"alg": "none"}, {"role": "service_role"})) + ".x"
    for label, key in (("a key that says service_role", service_like), ("a key marked secret", "sb_secret_" + "x" * 12)):
        code, out, err, reqs, _ = run(["find", "maria"], key=key)
        case("16 %s is refused with no request made" % label, code in (1, 2) and len(lines(out + err)) == 1 and reqs == []
             and key not in out + err, (code, out + err))
finally:
    hub.ROOT = keep_root

# ---------------------------------------------------------------- 23. sign-in with Google (issue 61, cases 1 to 11)
# The browser is a stand-in for hub.open_browser: it reads the address hub.py
# would open and, in a thread, calls hub.py's own callback on 127.0.0.1 the
# way Supabase sends the browser back. The token endpoint is the FakeHub, as
# for every other request. Codes are made up here.
import socket  # noqa: E402
import threading  # noqa: E402
import urllib.error  # noqa: E402
import urllib.parse  # noqa: E402
import urllib.request  # noqa: E402

made_verifiers = []
keep_pkce = hub.pkce_pair


def recording_pkce():
    verifier, challenge = keep_pkce()
    made_verifiers.append(verifier)
    secrets_made.append(verifier)
    return verifier, challenge


def make_code():
    code = "code-" + secrets.token_urlsafe(16)
    secrets_made.append(code)
    return code


def hit(address):
    """What a browser does: one GET. Returns (status, page text), or (None, why) when nobody answers."""
    try:
        with urllib.request.urlopen(address, timeout=10) as answer:
            return answer.status, answer.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as error:
        return None, str(error)


class Browser:
    """Stands in for hub.open_browser. back(redirect_to, state) gives the address to call, or None to do nothing."""

    def __init__(self, back, opens=True, before=()):
        self.back, self.opens, self.before = back, opens, list(before)
        self.address, self.redirect, self.state, self.pages, self.thread = None, None, None, [], None

    def __call__(self, address):
        self.address = address
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(address).query)
        self.redirect = query.get("redirect_to", [""])[0]
        self.state = urllib.parse.parse_qs(urllib.parse.urlsplit(self.redirect).query).get("state", [""])[0]
        target = self.back(self.redirect, self.state)
        calls = [self.redirect.split("?")[0].rsplit("/", 1)[0] + path for path in self.before] + ([target] if target else [])

        def go():
            for call in calls:
                self.pages.append(hit(call))
        self.thread = threading.Thread(target=go, daemon=True)
        self.thread.start()
        return self.opens


def google_run(back, answers=(), home=None, wait=None, opens=True, before=(), argv=("login",)):
    """Run `login` with the stand-in browser. Returns (code, out, err, requests, home, browser)."""
    browser = Browser(back, opens, before)
    keep_open, keep_wait = hub.open_browser, hub.LOGIN_WAIT
    hub.open_browser, hub.pkce_pair = browser, recording_pkce
    if wait is not None:
        hub.LOGIN_WAIT = wait   # the test-only setting: a short wait
    try:
        code, out, err, reqs, home = run(list(argv), answers, home=home if home is not None else new_home(signed_in=False))
    finally:
        hub.open_browser, hub.pkce_pair, hub.LOGIN_WAIT = keep_open, keep_pkce, keep_wait
    if browser.thread:
        browser.thread.join(15)
    return code, out, err, reqs, home, browser


def with_code(code):
    return lambda redirect, state: redirect + "&" + urllib.parse.urlencode({"code": code})


def ends_with(err, sentence):
    got = lines(err)
    return bool(got) and got[-1] == sentence and "Traceback" not in err


def same_bytes(path, before):
    return path.is_file() and path.read_bytes() == before


google_outputs = []
G_CFG = hub.Config(URL, KEY)

# 1 pkce_pair
pairs = [hub.pkce_pair() for _ in range(30)]
allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
case("G1 pkce_pair: the verifier is 43 to 128 characters of the allowed set, new each time",
     all(43 <= len(v) <= 128 and set(v) <= allowed for v, _ in pairs) and len({v for v, _ in pairs}) == 30, pairs[0][0][:8])
case("G1 pkce_pair: the challenge is base64url SHA-256 of the verifier, without padding",
     all(c == base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip("=") and "=" not in c
         for v, c in pairs), pairs[0][1])

# 2 authorize_url
verifier, challenge = hub.pkce_pair()
state = "state-" + secrets.token_urlsafe(8)
address = hub.authorize_url(G_CFG, challenge, state)
parts = urllib.parse.urlsplit(address)
query = urllib.parse.parse_qs(parts.query)
back = query.get("redirect_to", [""])[0]
back_parts = urllib.parse.urlsplit(back)
case("G2 authorize_url: Supabase's authorize address with provider google, the challenge and s256",
     address.startswith(URL + "/auth/v1/authorize?") and query.get("provider") == ["google"]
     and query.get("code_challenge") == [challenge] and query.get("code_challenge_method") == ["s256"], address)
case("G2 it comes back to 127.0.0.1 on the one fixed port above 49152, with the state",
     back_parts.scheme == "http" and back_parts.hostname == "127.0.0.1" and back_parts.port == hub.CALLBACK_PORT
     and hub.CALLBACK_PORT > 49152 and back_parts.path == hub.CALLBACK_PATH
     and urllib.parse.parse_qs(back_parts.query).get("state") == [state], back)
case("G2 no secret in it: not the verifier, not the key", verifier not in address and KEY not in address
     and "apikey" not in address, address)

# 3 callback_happy
CODE = make_code()
code, out, err, reqs, home, browser = google_run(with_code(CODE), [token_answer(), fixture("whoami")])
google_outputs.append(out + err)
stored = json.loads((home / "session.json").read_text(encoding="utf-8")) if (home / "session.json").is_file() else {}
sent = reqs[0]["body"] if reqs else {}
said_challenge = urllib.parse.parse_qs(urllib.parse.urlsplit(browser.address or "").query).get("code_challenge", [""])[0]
case("G3 callback_happy: the browser's code is traded once at grant_type=pkce with the verifier of the challenge it was shown",
     code == 0 and len(reqs) == 2 and reqs[0]["method"] == "POST" and reqs[0]["url"] == URL + "/auth/v1/token?grant_type=pkce"
     and sent.get("auth_code") == CODE and set(sent) == {"auth_code", "code_verifier"}
     and base64.urlsafe_b64encode(hashlib.sha256(sent.get("code_verifier", "").encode()).digest()).decode().rstrip("=")
     == said_challenge, (code, out + err, [r["url"] for r in reqs]))
case("G3 the session is written as the password path writes it, mode 600, and whoami runs as it",
     {"url", "access_token", "refresh_token", "expires_at"} == set(stored)
     and stat.S_IMODE((home / "session.json").stat().st_mode) == 0o600
     and len(reqs) == 2 and reqs[1]["headers"].get("Authorization") == "Bearer " + stored.get("access_token", "?"), sorted(stored))
case("G3 it says who signed in, exit 0", code == 0 and out.strip() == "signed in as bravo (BB)", out + err)
case("G3 the browser is told in a plain page that it can close the tab",
     browser.pages and browser.pages[0][0] == 200 and "Signed in to the team hub. You can close this tab." in browser.pages[0][1],
     browser.pages)
again = hit(browser.redirect + "&code=" + CODE)
case("G3 a second request to the callback after the first finds nobody listening", again[0] is None, again)
code, out, err, reqs, _ = run(["whoami"], [fixture("whoami")], home=home)
case("G3 whoami works on that session unchanged", code == 0 and "bravo" in out, out + err)

# 3b no browser could be opened: the address is printed on one line and the wait goes on
CODE = make_code()
code, out, err, reqs, home, browser = google_run(with_code(CODE), [token_answer(), fixture("whoami")], opens=False)
google_outputs.append(out + err)
case("G3 no browser: the address is printed on one line and the sign-in still completes",
     code == 0 and any(browser.address and browser.address in line for line in lines(err)) and (home / "session.json").is_file(),
     (code, out + err))

# 3c a request to another path first (a browser's favicon, a stray tab) is ignored, the wait goes on
CODE = make_code()
code, out, err, reqs, home, browser = google_run(with_code(CODE), [token_answer(), fixture("whoami")], before=["/favicon.ico"])
google_outputs.append(out + err)
case("G3 a request to another path is answered 404 and ignored; the real callback still signs in",
     code == 0 and browser.pages and browser.pages[0][0] == 404 and len(browser.pages) == 2 and browser.pages[1][0] == 200,
     (code, out + err, browser.pages))

# 4 callback_wrong_state (and missing)
for label, back in (("a forged state", lambda r, s: r.replace(s, "forged-" + secrets.token_urlsafe(8)) + "&code=" + make_code()),
                    ("no state", lambda r, s: r.split("?")[0] + "?code=" + make_code())):
    code, out, err, reqs, home, browser = google_run(back)
    google_outputs.append(out + err)
    case("G4 callback_wrong_state (%s): refused with one sentence, no token request, no session, exit 1" % label,
         code == 1 and ends_with(err, hub.WRONG_STATE) and reqs == [] and not (home / "session.json").exists()
         and out.strip() == "", (code, out + err, len(reqs)))

# 5 callback_error_param
code, out, err, reqs, home, browser = google_run(
    lambda r, s: r + "&error=access_denied&error_description=The+user+cancelled")
google_outputs.append(out + err)
case("G5 callback_error_param: error=access_denied gives the plain sentence, exit 1, nothing sent or written",
     code == 1 and ends_with(err, hub.GOOGLE_CANCELLED) and reqs == [] and not (home / "session.json").exists()
     and "The user cancelled" not in out + err, (code, out + err))
case("G5 the browser is shown the same sentence", browser.pages and hub.GOOGLE_CANCELLED in browser.pages[0][1], browser.pages)
for words, codeword, want in (("Signups not allowed for this instance", "signup_disabled", hub.GOOGLE_NOT_ON_LIST),
                              ("Database error saving new user", "", hub.GOOGLE_NOT_ON_LIST),
                              ("User is banned", "user_banned", hub.GOOGLE_NOT_ON_LIST),
                              ("Unsupported provider: provider is not enabled", "validation_failed", hub.GOOGLE_OFF),
                              ("Something else", "unexpected_failure", hub.GOOGLE_FAILED)):
    code, out, err, reqs, home, browser = google_run(
        lambda r, s, w=words, c=codeword: r + "&" + urllib.parse.urlencode({"error": "server_error", "error_code": c,
                                                                             "error_description": w}))
    google_outputs.append(out + err)
    case("G5 an error that came back as \"%s\" gives the website's sentence, never Supabase's" % words,
         code == 1 and ends_with(err, want) and words not in out + err and reqs == [], (code, out + err))

# 6 callback_timeout
started = time.monotonic()
code, out, err, reqs, home, browser = google_run(lambda r, s: None, wait=1)
google_outputs.append(out + err)
case("G6 callback_timeout: nothing comes back, the short test wait ends it with one sentence, exit 1, nothing written",
     code == 1 and lines(err) and lines(err)[-1].startswith("no answer came back from the browser in 1 seconds")
     and reqs == [] and not (home / "session.json").exists() and time.monotonic() - started < 8, (code, out + err))
case("G6 the port is free again afterwards", hit("http://127.0.0.1:%d/callback" % hub.CALLBACK_PORT)[0] is None)

# 7 port_taken (also what a second login run at the same time meets)
squatter = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
squatter.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    squatter.bind(("127.0.0.1", hub.CALLBACK_PORT))
    squatter.listen(1)
    code, out, err, reqs, home, browser = google_run(with_code(make_code()))
finally:
    squatter.close()
google_outputs.append(out + err)
case("G7 port_taken: one sentence naming the port, exit 1, no browser opened, nothing sent or written",
     one_plain_line(code, 1, out, err) and str(hub.CALLBACK_PORT) in err and "already in use" in err
     and browser.address is None and reqs == [] and not (home / "session.json").exists(), (code, out + err))

# 8 refused_not_on_list, at the token endpoint
for answer, raw, want in (((400, json.dumps({"code": 400, "error_code": "user_banned", "msg": "User is banned"})), "User is banned",
                           hub.GOOGLE_NOT_ON_LIST),
                          ((422, json.dumps({"code": 422, "error_code": "unexpected_failure",
                                             "msg": "Database error saving new user"})), "Database error", hub.GOOGLE_NOT_ON_LIST),
                          ((400, json.dumps({"error": "invalid_grant", "error_description": "invalid flow state, no valid flow state found"})),
                           "flow state", hub.GOOGLE_FAILED),
                          ((500, "<html>bad gateway</html>"), "<html", hub.GOOGLE_FAILED),
                          (hub.Unreachable(sent=False), "could not reach", hub.GOOGLE_UNREACHABLE)):
    code, out, err, reqs, home, browser = google_run(with_code(make_code()), [answer])
    google_outputs.append(out + err)
    case("G8 token endpoint refusal (%s): the website's sentence only, exit 1, nothing written" % raw,
         code == 1 and ends_with(err, want) and raw not in out + err and len(reqs) == 1
         and not (home / "session.json").exists(), (code, out + err))
    case("G8 (%s) the browser is shown the same sentence, not 'signed in'" % raw,
         browser.pages and browser.pages[0][0] == 400 and want in browser.pages[0][1], browser.pages)

# the sentences are the website's, word for word
site = (ROOT / "app" / "src" / "components" / "kit" / "googleSignIn.ts").read_text(encoding="utf-8")
for name in ("GOOGLE_NOT_ON_LIST", "GOOGLE_OFF", "GOOGLE_CANCELLED", "GOOGLE_FAILED", "GOOGLE_UNREACHABLE"):
    found = re.search(r"export const %s =\s*\"([^\"]*)\"" % name, site)
    case("G8 %s in hub.py is the website's sentence word for word" % name,
         found and found.group(1) == getattr(hub, name), (found and found.group(1), getattr(hub, name)))

# 9 old_session_kept_on_failure
failures = (("a forged state", lambda: google_run(lambda r, s: r.replace(s, "forged") + "&code=" + make_code(), home=old)),
            ("an error parameter", lambda: google_run(lambda r, s: r + "&error=access_denied", home=old)),
            ("a timeout", lambda: google_run(lambda r, s: None, home=old, wait=1)),
            ("a refusal at the token endpoint",
             lambda: google_run(with_code(make_code()), [(400, json.dumps({"error_code": "user_banned", "msg": "x"}))], home=old)))
for label, attempt in failures:
    old = new_home()
    before = (old / "session.json").read_bytes()
    code, out, err, reqs, _, _ = attempt()
    google_outputs.append(out + err)
    case("G9 old_session_kept_on_failure (%s): the session already there is untouched" % label,
         code == 1 and same_bytes(old / "session.json", before), (code, out + err))
old = new_home()
before = (old / "session.json").read_bytes()
squatter = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
squatter.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    squatter.bind(("127.0.0.1", hub.CALLBACK_PORT))
    squatter.listen(1)
    code, out, err, reqs, _, _ = google_run(with_code(make_code()), home=old)
finally:
    squatter.close()
case("G9 old_session_kept_on_failure (port taken): untouched", code == 1 and same_bytes(old / "session.json", before), (code, out + err))
old = new_home()
before = (old / "session.json").read_bytes()
fresh = token_answer()
code, out, err, reqs, _, _ = google_run(with_code(make_code()), [fresh, fixture("whoami")], home=old)
case("G9 and after a success it is replaced by the new session", code == 0 and not same_bytes(old / "session.json", before)
     and json.loads((old / "session.json").read_text())["access_token"] == json.loads(fresh[1])["access_token"], (code, out + err))

# 10 password_flag_unchanged (cases 13 and 14 above run --password); --email alone is not a Google flag
code, out, err, reqs, home, browser = google_run(with_code(make_code()), argv=("login", "--email", "fixture@example.org"))
case("G10 login --email without --password is refused before anything: no browser, no request, exit 2",
     one_plain_line(code, 2, out, err) and "--password" in err and browser.address is None and reqs == [], (code, out + err))
code, out, err, reqs, home, browser = google_run(with_code(make_code()), [token_answer(), fixture("whoami")],
                                                 argv=("login", "--password", "--email", "fixture@example.org"))
case("G10 login --password never opens the browser (here: no terminal, no test password, so refused as before)",
     one_plain_line(code, 2, out, err) and browser.address is None and reqs == [], (code, out + err))
code, out, err, reqs, home = run(["login", "--help"])
case("G10 the help names Google as the default and --password as the fallback",
     "Google" in out and "--password" in out, out + err)

# 11 no_secrets_in_output
leaks = [(index, secret[:6]) for index, text in enumerate(google_outputs) for secret in secrets_made if secret in text]
case("G11 no_secrets_in_output: across cases 3 to 9 no code, verifier or token is in stdout or stderr (%d outputs, %d verifiers)"
     % (len(google_outputs), len(made_verifiers)), len(google_outputs) >= 20 and len(made_verifiers) >= 20 and not leaks, leaks)

# ---------------------------------------------------------------- 15. nothing secret in any output
leaks = [(index, secret[:6]) for index, text in enumerate(captured) for secret in secrets_made if secret in text]
case("15 no output of any command above holds an access token, a refresh token or the test password (%d outputs, %d secrets)"
     % (len(captured), len(secrets_made)), len(captured) > 80 and len(secrets_made) > 20 and not leaks, leaks)

# ---------------------------------------------------------------- 17. the source of hub.py
source = (HERE / "hub.py").read_text(encoding="utf-8")
rest_paths = set(re.findall(r"""["'](/(?:rest|auth)/v1[^"']*)["']""", source))
case("17 every request path written in hub.py is the auth token path, the teammate's own user (issue 28), rpc/ or a plain read,"
     " plus the authorize address the browser opens (issue 61)",
     rest_paths == {"/rest/v1/rpc/", "/rest/v1/", "/auth/v1/token?grant_type=", "/auth/v1/user", "/auth/v1/authorize?"},
     sorted(rest_paths))
case("17 the authorize address is only ever opened in the browser, never sent by hub.py",
     len(re.findall(r"/auth/v1/authorize\?", source)) == 1
     and re.search(r'return cfg\.url \+ "/auth/v1/authorize\?"', source) and "send(cfg, \"GET\", \"/auth/v1/authorize" not in source)
case("17 the actions hub.py may call are fixed action names and nothing else",
     isinstance(hub.ACTIONS, tuple) and 0 < len(hub.ACTIONS) and set(hub.ACTIONS) <= set(ACTION_NAMES), hub.ACTIONS)
named = set(re.findall(r"""call_action\(\s*[a-z_]+\s*,\s*[a-z_]+\s*,\s*["']([^"']+)["']""", source))
calls = len(re.findall(r"\bcall_action\(", source)) - 1   # one is its own definition
case("17 every call of an action names it in the source, from that list",
     named and named <= set(hub.ACTIONS) and len(re.findall(r"""call_action\(\s*[a-z_]+\s*,\s*[a-z_]+\s*,\s*["']""", source)) == calls,
     (sorted(named), calls))
methods = set(re.findall(r"""["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']""", source))
case("17 hub.py only ever says GET and POST, and PUT once: a teammate's own password (issue 28)",
     methods == {"GET", "POST", "PUT"} and source.count('"PUT"') == 1
     and 'send(cfg, "PUT", "/auth/v1/user"' in source, methods)
posts = re.findall(r"""send\([^\n]*["']POST["'][^\n]*""", source)
case("17 a POST goes to rpc/ or to the auth API, never to a table",
     posts and all(("/rest/v1/rpc/" in line) or ("/auth/v1/token" in line) for line in posts), posts)
case("17 there is no service key, no database address and no SQL in it",
     not re.search(r"service_role_key|SERVICE_ROLE|SERVICE_KEY|postgres(ql)?://|psql|\bDROP\b|\bINSERT\b|\bexecute\(", source), "found")
case("17 it uses the standard library only and never runs a shell",
     not re.search(r"^\s*(import|from)\s+(requests|supabase|httpx|pty)\b", source, re.M)
     and "os.system" not in source and "os.popen" not in source and "shell=True" not in source, "found")
# Issue 89: `version` runs git, and nothing else, as a list of arguments.
runs = re.findall(r"subprocess\.\w+\(([^\n]*)", source)
case("17 subprocess runs only git, from a list of arguments, in one place",
     len(runs) == 1 and runs[0].startswith('["git", "-C", str(ROOT), *args]'), runs)
try:
    hub.call_action(None, None, "contacts", {})
    closed = False
except Exception as error:   # noqa: BLE001
    closed = "not a fixed action" in str(error)
case("17 call_action refuses a name that is not on the list, before any request", closed)
try:
    hub.read(None, None, "audit_log", {})
    closed = False
except Exception as error:   # noqa: BLE001
    closed = "not a table" in str(error)
case("17 read refuses a table that is not on its list, before any request", closed)
all_requests = []
for argv, answers in ((["find", "x"], [fixture("find_one")]), (["add", "--name", "A B"], [fixture("add_ok")]),
                      (["touch", "--person", "CC-01", "--channel", "email", "--what", "x"], [fixture("touch_ok")]),
                      (["status", "--person", "CC-01", "--to", "declined"], [fixture("status_ok")]),
                      (["owner", "--person", "CC-01", "--to", "bravo"], [fixture("owner_ok")]),
                      (["list"], [fixture("sales"), fixture("contacts_bravo"), fixture("companies")]),
                      (["list", "--followup"], [fixture("sales"), fixture("follow_ups_bravo"), fixture("contacts_bravo")]),
                      (["inbox", "list"], [fixture("inbox_list")]),
                      (["inbox", "confirm", "--id", "5", "--person", "CC-01", "--consent", "yes"], [fixture("confirm_ok")]),
                      (["inbox", "dismiss", "--id", "5", "--reason", "r"], [fixture("dismiss_ok")]),
                      (["recording", "known", "--ids", "a"], [fixture("known_interviews"), fixture("known_inbox")]),
                      (submit_args(THREE), [fixture("submit_saved")]), (["whoami"], [fixture("whoami")]),
                      (["log", "--json-file", log_file(LOG_BODY)], [LOG_OK])):
    code, out, err, reqs, _ = run(argv, answers)
    all_requests += [(code, r) for r in reqs]
bad = [(r["method"], r["url"]) for code, r in all_requests
       if not ((r["method"] == "POST" and re.fullmatch(re.escape(URL) + r"/rest/v1/rpc/(%s)" % "|".join(ACTION_NAMES), r["url"])
                and r["body"].get("via") == "claude")
               or (r["method"] == "GET" and re.match(re.escape(URL) + r"/rest/v1/(sales|contacts|companies|follow_ups|interviews|call_inbox)\?", r["url"])))]
case("17 across every command, each request made was a POST to a fixed action with via claude, or a GET of a table (%d requests)"
     % len(all_requests), len(all_requests) >= 18 and not bad and all(code == 0 for code, _ in all_requests), bad)
case("17 the public key and the sign-in travel in headers, never in the address",
     all(KEY not in r["url"] and "token" not in r["url"].lower() and r["headers"].get("apikey") == KEY for _, r in all_requests), "")

# ---------------------------------------------------------------- 18. the two skills
for skill in ("crm-sync", "crm-outreach"):
    text = (ROOT / ".claude" / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
    case("18 %s uses scripts/hub.py" % skill, "scripts/hub.py" in text)
    found = [word for word in ("scripts/contact.py", ".crm-me", "git commit", "git push") if word in text]
    case("18 %s names none of scripts/contact.py, .crm-me, git commit, git push" % skill, not found, found)
    places = [m for m in re.findall(r"`(?:people|touches|interviews)/[^`]*`", text)]
    case("18 %s names no file under people/, touches/ or interviews/" % skill, not places, places)
    dashes = [ch for ch in text if ch in "\u2013\u2014"]
    case("18 %s has no em dash or en dash" % skill, not dashes)
claude_md = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
case("18 both skills are still named in CLAUDE.md, and it no longer sends anyone to .crm-me",
     "/crm-sync" in claude_md and "/crm-outreach" in claude_md and ".crm-me" not in claude_md)
gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
case("18 .gitignore names session.json as a second guard", "session.json" in gitignore)
fixture_text = "".join(p.read_text(encoding="utf-8") for p in list(HUB_FIX.glob("*.json")) + list(GRANOLA.rglob("*.json")))
case("15 no fixture holds a token, a key or a password",
     not re.search(r"""eyJ[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_|"(access_token|refresh_token|password)"\s*:""", fixture_text))

# ---------------------------------------------------------------- 19. free text from a file (issue 40, item 6)
# The skills write what a teammate said to a file with the file writing tool and
# pass only the path, so no shell quoting ever touches it. Rule (DECISIONS):
# the value is the file byte for byte, less one trailing newline if there is one.
NASTY = "Dr. Lane's office said \"maybe\", `id` and $(rm -rf ~)\nsecond line → done \U0001F600"


def text_file(value):
    return str(temp_file(value, "value.txt"))


code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what-file", text_file(NASTY + "\n"),
                               "--next-file", text_file(NASTY)], [fixture("touch_ok")])
case("19 touch --what-file and --next-file: an apostrophe, quotes, a backtick, $(...), a newline and an emoji arrive byte for byte",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("what") == NASTY and reqs[0]["body"].get("next_step") == NASTY,
     (code, out + err, reqs))
code, out, err, reqs, _ = run(["add", "--name-file", text_file(NASTY + "\n"), "--role-file", text_file("role " + NASTY),
                               "--org-file", text_file("org " + NASTY), "--contact-file", text_file("contact " + NASTY),
                               "--referred-by-file", text_file("ref " + NASTY)], [fixture("add_ok")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("19 add --name-file, --role-file, --org-file, --referred-by-file arrive byte for byte; --contact-file one detail a line",
     code == 0 and body.get("name") == NASTY and body.get("role") == "role " + NASTY and body.get("organization") == "org " + NASTY
     and body.get("contacts") == ["contact " + NASTY.split("\n")[0], NASTY.split("\n")[1]]
     and body.get("referred_by") == "ref " + NASTY, (code, out + err, body))
code, out, err, reqs, _ = run(["find", "--text-file", text_file(NASTY)], [fixture("find_none")])
case("19 find --text-file arrives byte for byte", code == 0 and len(reqs) == 1 and reqs[0]["body"].get("query") == NASTY,
     (code, out + err, reqs))
code, out, err, reqs, _ = run(["inbox", "dismiss", "--id", "5", "--reason-file", text_file(NASTY)], [fixture("dismiss_ok")])
case("19 inbox dismiss --reason-file arrives byte for byte",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("reason") == NASTY, (code, out + err, reqs))
code, out, err, reqs, _ = run(["recording", "paste", "--person", "CC-01", "--date", "2026-11-20", "--title-file", text_file(NASTY),
                               "--transcript", str(pasted), "--overview", str(overview), "--consent", "yes"],
                              [fixture("save_interview_ok")])
case("19 recording paste --title-file arrives byte for byte",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("title") == NASTY, (code, out + err, reqs))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what-file", "-"], [fixture("touch_ok")],
                              stdin=NASTY + "\n")
case("19 --what-file - reads standard input, byte for byte",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("what") == NASTY, (code, out + err, reqs))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what-file", text_file("two\n\n")],
                              [fixture("touch_ok")])
case("19 only one trailing newline is taken off: \"two\\n\\n\" arrives as \"two\\n\"",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("what") == "two\n", reqs)
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what-file", text_file("crlf\r\n")],
                              [fixture("touch_ok")])
case("19 a carriage return is kept: \"crlf\\r\\n\" arrives as \"crlf\\r\"",
     code == 0 and len(reqs) == 1 and reqs[0]["body"].get("what") == "crlf\r", reqs)
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what", "x", "--what-file", text_file("y")])
case("19 --what and --what-file together are refused with no request made", one_plain_line(code, 2, out, err) and reqs == [],
     (code, out + err))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email"])
case("19 touch with neither --what nor --what-file is refused with no request made",
     one_plain_line(code, 2, out, err) and reqs == [] and "--what" in out + err, (code, out + err))
code, out, err, reqs, _ = run(["find"])
case("19 find with neither text nor --text-file is refused with no request made", one_plain_line(code, 2, out, err) and reqs == [],
     (code, out + err))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what-file", "-", "--next-file", "-"],
                              stdin="a")
case("19 two options reading standard input in one call are refused with no request made",
     one_plain_line(code, 2, out, err) and reqs == [], (code, out + err))
bad_bytes = Path(tempfile.mkdtemp(prefix="hubtest-")) / "latin1.txt"
bad_bytes.write_bytes("café".encode("latin-1"))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what-file", str(bad_bytes)])
case("19 a file that is not UTF-8 is refused with no request made", one_plain_line(code, 2, out, err) and reqs == [],
     (code, out + err))
code, out, err, reqs, _ = run(["touch", "--person", "CC-01", "--channel", "email", "--what-file", "/nonexistent/hub/value.txt"])
case("19 a missing file is refused with no request made", one_plain_line(code, 2, out, err) and reqs == [], (code, out + err))

# ---------------------------------------------------------------- 20. pages from another meeting (issue 40, item 7)
meeting_text = ("Microphone: a made up line of talk.\n" * 60)


def joined(objects, granola_id=None, **flags):
    try:
        hub.join_pages(pages_dir(objects), granola_id, **flags)
        return "joined"
    except hub.Refused as reason:
        return str(reason)
    except TypeError as error:   # an option join_pages does not take
        return "not taken: %s" % error


pages = cut(meeting_text, [700, 1400])
mixed = [dict(pages[0], meeting_id="m-1"), pages[1], dict(pages[2], meeting_id="m-1")]
said = joined(mixed, "m-1")
case("20 a folder where some pages carry a meeting id and others do not is refused, naming a page",
     said != "joined" and "page 2" in said, said)
differ = [dict(pages[0], meeting_id="m-1"), dict(pages[1], meeting_id="m-2"), dict(pages[2], meeting_id="m-1")]
said = joined(differ)
case("20 pages whose meeting ids differ are refused even with no id in the meta file", said != "joined" and "page 2" in said, said)
same = [dict(page, meeting_id="m-1") for page in pages]
case("20 pages that all carry the meta file's id still join", joined(same, "m-1") == "joined", joined(same, "m-1"))
case("20 pages that carry no id at all join when the meta file names no meeting", joined(pages) == "joined", joined(pages))

# ---------------------------------------------------------------- 22. id-less pages need a yes (issue 47, item 3)
said = joined(pages, "m-1")
case("22 pages that carry no id at all are refused when the meta file names a meeting",
     said != "joined", said)
case("22 the refusal names the meeting the meta file names, and the option that confirms",
     "m-1" in said and "--pages-without-id" in said, said)
case("22 with the teammate's confirmation the same pages join",
     joined(pages, "m-1", without_id=True) == "joined", joined(pages, "m-1", without_id=True))
said = joined(mixed, "m-1", without_id=True)
case("22 the confirmation does not let a folder of mixed pages through", said != "joined" and "page 2" in said, said)
said = joined(differ, "m-1", without_id=True)
case("22 nor pages whose ids differ", said != "joined" and "page 2" in said, said)
other = [dict(page, meeting_id="m-2") for page in pages]
said = joined(other, "m-1", without_id=True)
case("22 nor pages that carry another meeting's id", said != "joined" and "another meeting" in said, said)
code, out, err, reqs, _ = run(submit_args(THREE, without_id=False), [fixture("submit_saved")])
case("22 recording submit with id-less pages and no confirmation exits 2, sends nothing, names the meeting",
     one_plain_line(code, 2, out, err) and reqs == [] and "fixture-three-pages-0001" in err, (code, out + err, len(reqs)))
code, out, err, reqs, _ = run(submit_args(THREE), [fixture("submit_saved")])
case("22 with --pages-without-id the same recording is sent",
     code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/submit_recording", (code, out + err, len(reqs)))

# ---------------------------------------------------------------- 21. never SQL, never db/ (issue 40, item 8)
for skill in ("crm-sync", "crm-outreach"):
    text = (ROOT / ".claude" / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
    case("21 %s says plainly: never write SQL, never edit db/" % skill,
         re.search(r"never write sql", text, re.I) and re.search(r"never edit `db/`", text, re.I))
    quoted = re.findall(r"hub\.py[^\n`]*'", text)
    case("21 %s puts no value in single quotes on a hub.py line" % skill, not quoted, quoted)

# ---------------------------------------------------------------- 22. a teammate changes their own password (issue 28)
# No mail sender at go-live: the app's own "change password" sends a mail, so
# a teammate replaces the temporary password the administrator gave them with this.
NEW = "new-" + secrets.token_urlsafe(12)
code, out, err, reqs, _ = run(["password"])
case("22 password with input that is not a terminal exits 2 and sends nothing",
     one_plain_line(code, 2, out, err) and reqs == [] and "run this yourself in a terminal" in out + err, (code, out + err))
code, out, err, reqs, _ = run(["password"], env={"HUB_TEST_NEW_PASSWORD": NEW})
case("22 the test password is ignored when the hub is not on this machine",
     one_plain_line(code, 2, out, err) and reqs == [], (code, out + err))
code, out, err, reqs, _ = run(["password"], [(200, json.dumps({"id": USER_ID}))], home=new_home(url=LOCAL), url=LOCAL,
                              env={"HUB_TEST_NEW_PASSWORD": NEW})
case("22 a new password is sent once, as the signed in teammate, to the hub's own user endpoint",
     code == 0 and len(reqs) == 1 and reqs[0]["method"] == "PUT" and reqs[0]["url"] == LOCAL + "/auth/v1/user"
     and reqs[0]["body"] == {"password": NEW} and reqs[0]["headers"].get("Authorization", "").startswith("Bearer "),
     (code, out + err, reqs))
case("22 it says it is changed, and never prints the password", "changed" in out and NEW not in out + err, out + err)
code, out, err, reqs, _ = run(["password"], home=new_home(url=LOCAL), url=LOCAL, env={"HUB_TEST_NEW_PASSWORD": "short-11ch"})
case("22 a password under 12 characters is refused before anything is sent",
     one_plain_line(code, 2, out, err) and reqs == [] and "12" in out + err, (code, out + err))
code, out, err, reqs, _ = run(["password"], [(422, json.dumps({"msg": "weak"}))], home=new_home(url=LOCAL), url=LOCAL,
                              env={"HUB_TEST_NEW_PASSWORD": NEW})
case("22 a password the hub refuses is exit 2 in one line", one_plain_line(code, 2, out, err) and NEW not in out + err,
     (code, out + err))
code, out, err, reqs, _ = run(["password"], home=new_home(signed_in=False, url=LOCAL), url=LOCAL,
                              env={"HUB_TEST_NEW_PASSWORD": NEW})
case("22 not signed in: told to sign in, nothing sent", code == 3 and reqs == [], (code, out + err))

# ---------------------------------------------------------------- 23. the kind of an interview (issue 83)
# paste_kind_flag: --kind is sent as it is given; without it, transcript.
notes_text = ("Handwritten, typed as written: waited 2 hrs, “nobody said why”, café by the door.\n" * 3)[:150]
notes_file = temp_file(notes_text)
paste_base = ["recording", "paste", "--person", "CC-01", "--date", "2026-11-20", "--title", "Notes: Maria Okafor",
              "--overview", str(overview), "--consent", "yes"]
code, out, err, reqs, _ = run(paste_base + ["--transcript", str(notes_file), "--kind", "notes"], [fixture("save_interview_ok")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("23 paste_kind_flag: recording paste --kind notes with 150 characters posts save_interview with kind notes",
     code == 0 and len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/save_interview" and body.get("kind") == "notes"
     and body.get("transcript") == notes_text and body.get("source") == "paste",
     (code, out + err, {k: v for k, v in body.items() if k != "transcript"}))
code, out, err, reqs, _ = run(paste_base + ["--transcript", str(pasted)], [fixture("save_interview_ok")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("23 paste_kind_flag: without --kind it sends kind transcript",
     code == 0 and len(reqs) == 1 and body.get("kind") == "transcript", (code, out + err, body.get("kind")))
code, out, err, reqs, _ = run(paste_base + ["--transcript", str(notes_file), "--kind", "debrief"], [fixture("save_interview_ok")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("23 recording paste --kind debrief sends kind debrief", code == 0 and body.get("kind") == "debrief", (code, out + err))
code, out, err, reqs, _ = run(paste_base + ["--transcript", str(notes_file)])
case("23 a 150 character file with no --kind is still refused as a transcript, nothing sent",
     one_plain_line(code, 2, out, err) and reqs == [] and "1000" in out + err, (code, out + err))
code, out, err, reqs, _ = run(paste_base + ["--transcript", str(temp_file("n" * 99)), "--kind", "notes"])
case("23 notes of 99 characters are refused with no request made, naming 100",
     one_plain_line(code, 2, out, err) and reqs == [] and "100" in out + err, (code, out + err))
code, out, err, reqs, _ = run(paste_base + ["--transcript", str(notes_file), "--kind", "summary"])
case("23 a kind not in the three is refused with no request made",
     one_plain_line(code, 2, out, err) and reqs == [], (code, out + err))
code, out, err, reqs, _ = run(submit_args(THREE) + ["--kind", "debrief"], [fixture("submit_inbox")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("23 recording submit --kind debrief sends kind debrief",
     len(reqs) == 1 and path_of(reqs[0]) == "/rest/v1/rpc/submit_recording" and body.get("kind") == "debrief", (code, out + err))
code, out, err, reqs, _ = run(submit_args(THREE), [fixture("submit_inbox")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("23 recording submit without --kind sends kind transcript", len(reqs) == 1 and body.get("kind") == "transcript",
     (code, out + err))
code, out, err, reqs, _ = run(["inbox", "confirm", "--id", "5", "--person", "CC-01", "--consent", "yes", "--kind", "debrief"],
                              [fixture("confirm_ok")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("23 inbox confirm --kind debrief sends kind debrief", code == 0 and body.get("kind") == "debrief", (code, out + err))
code, out, err, reqs, _ = run(["inbox", "confirm", "--id", "5", "--person", "CC-01", "--consent", "yes"], [fixture("confirm_ok")])
body = reqs[0]["body"] if len(reqs) == 1 else {}
case("23 inbox confirm without --kind sends no kind, so the item keeps the kind it was sent with",
     code == 0 and "kind" not in body, (code, out + err, body))

# ---------------------------------------------------------------- V. which version is live (issue 89)
# hub.py version reads the live /version.json (through hub.transport) and asks
# git (through hub.git, replaced here by FakeGit) for the newest app commit on
# origin/main. No sign-in, no hub address or key needed.
LIVE_SHA = "a" * 40
NEW_SHA = "b" * 40
VERSION_URL = "https://hub.example.org/version.json"


def version_doc(sha=LIVE_SHA, pr=89):
    return 200, json.dumps({"sha": sha, "short": sha[:7], "built_at": "2026-11-24T15:04:05-08:00", "pr": pr})


class FakeGit:
    """Stands in for hub.git: answers fetch, log and rev-list from what the test set, and keeps each call."""

    def __init__(self, newest=(LIVE_SHA, "Issue 89: version label under the logo (#89)"), behind=0, fetch_ok=True,
                 known=True):
        self.newest, self.behind, self.fetch_ok, self.known = newest, behind, fetch_ok, known
        self.calls = []

    def __call__(self, *args):
        self.calls.append(list(args))
        if args[0] == "fetch":
            return (0, "") if self.fetch_ok else (128, "fatal: unable to access 'https://github.com/': no network")
        if args[0] == "cat-file":
            return (0, "") if self.known else (128, "fatal: Not a valid object name")
        if args[0] == "log":
            return 0, "%s\t%s\n" % self.newest
        if args[0] == "rev-list":
            return 0, "%d\n" % self.behind
        raise AssertionError("hub.py ran a git command the test did not expect: %s" % (args,))


def version_run(answers, fake_git, argv=("version",)):
    keep = hub.git
    hub.git = fake_git
    try:
        return run(list(argv), answers, home=new_home(signed_in=False), url=None)
    finally:
        hub.git = keep


fake_git = FakeGit()
code, out, err, reqs, _ = version_run([version_doc()], fake_git)
case("V2 up to date: exit 0, says live is up to date, signed out and with no hub address set",
     code == 0 and "live is up to date" in out and "Traceback" not in out + err, (code, out + err))
case("V2 it reads the live version.json once, with a GET and nothing else",
     len(reqs) == 1 and reqs[0]["method"] == "GET" and reqs[0]["url"] == VERSION_URL and reqs[0]["body"] is None, reqs)
case("V2 it prints the live label and pull request", "v2026.11.24.aaaaaaa" in out and "#89" in out, out)
case("V2 it fetches origin/main and counts only the commits that deploy",
     ["fetch", "-q", "origin", "main"] in fake_git.calls
     and any(c[0] == "rev-list" and c[2] == LIVE_SHA + "..origin/main" and "app" in c
             and ".github/workflows/deploy.yml" in c for c in fake_git.calls), fake_git.calls)

code, out, err, reqs, _ = version_run([version_doc()], FakeGit(newest=(NEW_SHA, "Issue 91: something (#91)"), behind=2))
case("V2 behind by 2: says how many app commits are not deployed and the newest pull request",
     code == 0 and "live is behind: 2 app commits not deployed yet (newest #91)" in out, (code, out + err))
code, out, err, reqs, _ = version_run([version_doc()], FakeGit(newest=(NEW_SHA, "direct push, no pull request"), behind=1))
case("V2 behind by 1 with no pull request names the commit instead",
     code == 0 and "live is behind: 1 app commit not deployed yet (newest bbbbbbb)" in out, (code, out + err))

code, out, err, reqs, _ = version_run([hub.Unreachable(sent=False)], FakeGit())
case("V2 version.json unreachable: exit 1 in one line that says so",
     one_plain_line(code, 1, out, err) and "version.json" in err and "did not answer" in err, (code, out + err))
code, out, err, reqs, _ = version_run([(404, "Not Found")], FakeGit())
case("V2 version.json missing: exit 1 in one line that says so",
     one_plain_line(code, 1, out, err) and "version.json" in err and "404" in err, (code, out + err))
code, out, err, reqs, _ = version_run([(200, "<html>the app</html>")], FakeGit())
case("V2 an answer that is not a version file: exit 1 in one line",
     one_plain_line(code, 1, out, err) and "version.json" in err, (code, out + err))
code, out, err, reqs, _ = version_run([version_doc()], FakeGit(fetch_ok=False))
case("V2 git cannot fetch origin: exit 1 in one line", one_plain_line(code, 1, out, err) and "git" in err,
     (code, out + err))
code, out, err, reqs, _ = version_run([version_doc(sha="unknown")], FakeGit())
case("V2 live built outside git: exit 1 in one line, it cannot be compared",
     one_plain_line(code, 1, out, err) and "unknown" in err, (code, out + err))
code, out, err, reqs, _ = version_run([version_doc()], FakeGit(known=False))
case("V2 live runs a commit origin/main does not hold: exit 1 in one line",
     one_plain_line(code, 1, out, err) and "aaaaaaa" in err, (code, out + err))
code, out, err, reqs, _ = version_run([version_doc()], FakeGit(), argv=("version", "--json"))
case("V2 --json gives the live version, the newest commit and the count",
     code == 0 and json.loads(out)["up_to_date"] is True and json.loads(out)["live"]["sha"] == LIVE_SHA
     and json.loads(out)["behind"] == 0, out)

for folder in Path(tempfile.gettempdir()).glob("hubtest-*"):
    shutil.rmtree(folder, ignore_errors=True)
for folder in Path(tempfile.gettempdir()).glob("hubpages-*"):
    shutil.rmtree(folder, ignore_errors=True)

failed = results.count(False)
print("\n%d passed, %d failed" % (results.count(True), failed))
sys.exit(1 if failed else 0)
