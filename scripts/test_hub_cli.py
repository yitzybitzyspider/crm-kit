#!/usr/bin/env python3
"""Tests for hub.py's stakeholder category (issue #97) and linked interview
sessions (issue #98), with no network.

Run: python3 scripts/test_hub_cli.py

As in scripts/test_hub.py, hub.transport is replaced by a queue of made up
answers and every request hub.py makes is kept. The session and its token
are made up fresh on every run.
"""
import base64
import contextlib
import io
import json
import os
import secrets
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import hub  # noqa: E402

URL = "https://hub.fixture.example"
KEY = "public-" + secrets.token_urlsafe(12)
CATEGORIES = ["customer", "user", "buyer", "partner", "expert", "other"]  # team.json defaults
results = []


def case(label, ok, detail=""):
    results.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + label + ("" if ok else "  -> " + str(detail)[:900]))


def token():
    part = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return ".".join([part({"alg": "none"}), part({"sub": "00000000-0000-4000-8000-0000000000f1",
                                                  "role": "authenticated"}), secrets.token_urlsafe(24)])


def run(argv, answers):
    """hub.main in this process: (exit code, stdout, stderr, requests made)."""
    home = Path(tempfile.mkdtemp(prefix="hubcli-")) / "crm-kit"
    home.mkdir(mode=0o700)
    path = home / "session.json"
    path.write_text(json.dumps({"url": URL, "access_token": token(), "refresh_token": "r-" + secrets.token_urlsafe(8),
                                "expires_at": int(time.time()) + 3600}), encoding="utf-8")
    path.chmod(0o600)
    queue, requests = list(answers), []

    def transport(method, url, headers, body, timeout):
        requests.append({"method": method, "url": url, "body": None if body is None else json.loads(body)})
        if not queue:
            raise AssertionError("unexpected request %s %s" % (method, url))
        status, doc = queue.pop(0)
        return status, json.dumps(doc)

    keep_env, keep_transport = dict(os.environ), hub.transport
    os.environ.update({"CRM_KIT_HOME": str(home), "CRM_KIT_URL": URL, "CRM_KIT_KEY": KEY})
    hub.transport = transport
    out, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = hub.main(list(argv))
            except SystemExit as stop:
                code = stop.code
    finally:
        hub.transport = keep_transport
        os.environ.clear()
        os.environ.update(keep_env)
    return code, out.getvalue(), err.getvalue(), requests


def row(i, category, interviewed, scheduled, contacted):
    return {"id": i, "category": category, "interviewed": interviewed, "scheduled": scheduled,
            "contacted_or_later": contacted}


# ------------------------------------------------------------ list --tally
view = [row(1, "customer", 1, 0, 4), row(2, "user", 0, 1, 2)]   # the rest left out: shown as 0
view += [row(i, c, 0, 0, 0) for i, c in enumerate(CATEGORIES[2:], 3) if c != "partner"]
view += [row(9, "uncategorized", 0, 0, 3), row(10, "total", 1, 1, 9)]
code, out, err, reqs = run(["list", "--tally"], [(200, view)])
lines = [line for line in out.splitlines() if line.strip()]
firsts = [line.split()[0] for line in lines]
case("list --tally exits 0 and reads the view category_tally only",
     code == 0 and len(reqs) == 1 and "/rest/v1/category_tally?" in reqs[0]["url"], (code, out, err, reqs))
case("list --tally prints a header, every category in order, uncategorized and total",
     firsts == ["category"] + CATEGORIES + ["uncategorized", "total"], lines)
case("list --tally prints the counts of a row", (lines[1:2] or [""])[0].split() == ["customer", "1", "0", "4"], lines[1:2])
partner = [line for line in lines if line.startswith("partner")]
case("list --tally shows a category the view left out as 0, not hidden",
     partner and partner[0].split() == ["partner", "0", "0", "0"], partner)
case("list --tally prints the total row last", (lines[-1:] or [""])[0].split() == ["total", "1", "1", "9"], lines[-1:])
code, out, err, reqs = run(["list", "--tally", "--json"], [(200, view)])
doc = json.loads(out) if code == 0 else None
case("list --tally --json gives one object per row, total included",
     isinstance(doc, list) and len(doc) == 8 and doc[-1:] and doc[-1]["category"] == "total", out + err)
code, out, err, reqs = run(["list", "--tally", "--owner", "bravo"], [])
case("list --tally with --owner is refused in one line, nothing sent",
     code != 0 and not reqs and len([ln for ln in (out + err).splitlines() if ln.strip()]) == 1, out + err)

# ---------------------------------------------------------- --category flags
code, out, err, reqs = run(["add", "--name", "Ada Test", "--category", "user"],
                           [(200, {"person_code": "DD-99", "name": "Ada Test", "owner": "delta",
                                   "status": "to-contact", "category": "user"})])
case("add --category sends category to add_person",
     code == 0 and reqs and reqs[0]["body"].get("category") == "user", (out, err, reqs))
code, out, err, reqs = run(["update", "--person", "DD-99", "--category", "strategy"],
                           [(200, {"person_code": "DD-99", "changed": ["category"]})])
case("update --category alone is enough and sends it to update_person",
     code == 0 and reqs and reqs[0]["body"].get("category") == "strategy" and "category" in out, (out, err, reqs))
code, out, err, reqs = run(["update", "--person", "DD-99", "--category", ""],
                           [(200, {"person_code": "DD-99", "changed": ["category"]})])
case("update --category '' sends the empty category, which clears it",
     code == 0 and reqs and reqs[0]["body"].get("category") == "", (out, err, reqs))
code, out, err, reqs = run(["update", "--person", "DD-99", "--category", "surgeon"],
                           [(400, {"message": "category must be one of: customer, user, buyer, partner, "
                                              "expert, other (not 'surgeon')"})])
case("update with an unknown category shows the hub's refusal",
     code != 0 and "category must be one of:" in out + err, out + err)
log_file = Path(tempfile.mkdtemp(prefix="hubcli-")) / "log.json"
log_file.write_text(json.dumps({"person": {"name": "Bo Test"}, "touches": [{"channel": "email", "what": "hi"}]}))
code, out, err, reqs = run(["log", "--json-file", str(log_file), "--category", "buyer"],
                           [(200, {"person_code": "DD-98", "name": "Bo Test", "owner": "delta", "status": "contacted",
                                   "touches": 1})])
case("log --category puts category in the person it sends",
     code == 0 and reqs and reqs[0]["body"]["person"].get("category") == "buyer", (out, err, reqs))
code, out, err, reqs = run(["list"], [(200, [{"id": 1, "handle": "delta"}]),
                                      (200, [{"person_code": "DD-01", "first_name": "Ada", "last_name": "Test",
                                              "title": None, "status": "interviewed", "sales_id": 1,
                                              "company_id": None, "category": "customer"}])])
case("list shows each person's category", code == 0 and "category: customer" in out, (out, err))
code, out, err, reqs = run(["list", "--category", "user"], [(200, [{"id": 1, "handle": "delta"}]), (200, [])])
case("list --category filters people by category",
     code == 0 and len(reqs) == 2 and "category=eq.user" in reqs[1]["url"], reqs)

# ------------------------------------------------- issue 98: one session, two captures
THREE = HERE / "fixtures" / "granola" / "three-pages"
text_dir = Path(tempfile.mkdtemp(prefix="hubcli-"))
(text_dir / "notes.md").write_text("n" * 150, encoding="utf-8")
(text_dir / "overview.md").write_text("An overview.", encoding="utf-8")
paste = ["recording", "paste", "--person", "DD-99", "--date", "2026-11-25", "--title", "Notes: Casey",
         "--transcript", str(text_dir / "notes.md"), "--overview", str(text_dir / "overview.md"), "--consent", "yes",
         "--kind", "notes"]
submit = ["recording", "submit", "--meta", str(THREE / "meta.json"), "--pages", str(THREE), "--overview",
          str(THREE / "overview.md"), "--consent", "yes", "--hypotheses", str(THREE / "hypotheses.json"),
          "--pages-without-id"]
warning = "possible same conversation as interview 2 (same person, same day)"
saved = {"interview_id": 3, "person_code": "DD-99", "kind": "notes", "chars": 150}
code, out, err, reqs = run(paste, [(200, dict(saved, same_conversation_as=2))])
case("paste prints the same-day warning when the hub names one", code == 0 and warning in out, (code, out, err))
code, out, err, reqs = run(paste, [(200, dict(saved, same_conversation_as=None))])
case("paste prints no same-day warning otherwise", code == 0 and "same conversation" not in out and len(reqs) == 1,
     (code, out, err))
done = {"result": "saved", "interview_id": 3, "person_code": "DD-99", "kind": "transcript"}
code, out, err, reqs = run(submit, [(200, dict(done, same_conversation_as=2))])
case("submit prints the same-day warning when the hub names one", code == 0 and warning in out, (code, out, err))
code, out, err, reqs = run(submit, [(200, done)])
case("submit prints no same-day warning otherwise", code == 0 and "same conversation" not in out, (code, out, err))
code, out, err, reqs = run(["recording", "link", "--primary", "2", "--other", "3"],
                           [(200, {"result": "linked", "primary_id": 2, "interview_id": 3})])
case("recording link sends link_interviews with the two ids and via claude",
     code == 0 and len(reqs) == 1 and reqs[0]["url"].endswith("/rest/v1/rpc/link_interviews")
     and reqs[0]["body"] == {"primary_id": 2, "other_id": 3, "via": "claude"} and "interview 3" in out, (out, err, reqs))
code, out, err, reqs = run(["recording", "link", "--primary", "2", "--other", "3"],
                           [(200, {"result": "already linked", "primary_id": 2, "interview_id": 3})])
case("recording link a second time says already linked", code == 0 and "already linked" in out, (out, err))
code, out, err, reqs = run(["recording", "link", "--primary", "2", "--other", "9"],
                           [(400, {"message": "these are interviews of different people"})])
case("recording link across people shows the hub's refusal",
     code != 0 and "these are interviews of different people" in out + err, out + err)

failed = results.count(False)
print("\n%d passed, %d failed" % (len(results) - failed, failed))
sys.exit(1 if failed else 0)
