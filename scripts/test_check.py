#!/usr/bin/env python3
"""Edge case tests for check.py. Run: python3 scripts/test_check.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check import check  # noqa: E402
from team import normalize_name  # noqa: E402

PERSON = """---
id: {id}
name: {name}
owner: {owner}
status: {status}
quote_by_name: no
contact: {contact}
---
# {name}
## Interviews
- {link}
"""

INTERVIEW = """---
date: {date}
person: {person}
interviewer: delta
source: {source}
granola_id: {gid}
hypotheses: [H1]
consent_to_record: yes
transcript: {state}
transcript_chars: {chars}
---
## Overview
x
{transcript}
"""


TOUCH = """---
date: {date}
person: {person}
by: {by}
channel: {channel}
next_step: {next_step}
next_due: {next_due}
---
{body}
"""


def build(people=None, interviews=None, touches=None):
    """touches=None means the touches/ folder does not exist at all."""
    root = Path(tempfile.mkdtemp())
    (root / "people").mkdir()
    (root / "interviews").mkdir()
    if touches is not None:
        (root / "touches").mkdir()
        for name, body in touches.items():
            (root / "touches" / name).write_text(body)
    for name, body in (people or {}).items():
        (root / "people" / name).write_text(body)
    for name, body in (interviews or {}).items():
        (root / "interviews" / name).write_text(body)
    return root


def person(**kw):
    base = dict(id="DD-01", name="Jane Doe", owner="delta", status="interviewed", contact="", link="2026-11-24-jane-doe.md")
    base.update(kw)
    return PERSON.format(**base)


def touch(**kw):
    base = dict(date="2026-11-20", person="jane-doe", by="delta", channel="email", next_step="", next_due="", body="Sent a first email asking for twenty minutes.")
    base.update(kw)
    return TOUCH.format(**base)


def interview(**kw):
    base = dict(date="2026-11-24", person="jane-doe", source="granola", gid="abc", transcript="## Transcript\nhi there", state="complete", chars="8")
    base.update(kw)
    return INTERVIEW.format(**base)


GOOD_P = {"jane-doe.md": person()}
GOOD_I = {"2026-11-24-jane-doe.md": interview()}
T_NAME = "2026-11-20-jane-doe-delta.md"
GOOD_T = {T_NAME: touch()}


def lone(**kw):
    """One person with no interview, for outreach cases."""
    return {"jane-doe.md": person(link="none yet", **kw)}


def bad_touch(expect, **kw):
    """A contacted person whose only touch is wrong in one way."""
    return (lone(status="contacted"), {}, expect, {T_NAME: touch(**kw)})


RENEE = {"renee-a.md": person(id="DD-01", name="Dr. Renée Álvarez, MD", link="none yet", status="to-contact"),
        "renee-b.md": person(id="DD-02", name="Renée Alvarez", link="none yet", status="to-contact")}

CASES = [
    ("clean repo passes", GOOD_P, GOOD_I, None),
    ("empty repo passes", {}, {}, None),
    ("templates are ignored", {"_TEMPLATE.md": "junk", **GOOD_P}, {"_TEMPLATE.md": "junk", **GOOD_I}, None),
    ("interview with no person file", {}, GOOD_I, "no people/jane-doe.md"),
    ("duplicate granola meeting", GOOD_P | {"jane-doe.md": person(link="2026-11-24-jane-doe.md 2026-11-25-jane-doe.md")},
     GOOD_I | {"2026-11-25-jane-doe.md": interview(date="2026-11-25")}, "same Granola meeting"),
    ("duplicate person id", GOOD_P | {"john-roe.md": person()}, GOOD_I, "already used"),
    ("bad id shape", {"jane-doe.md": person(id="7")}, GOOD_I, "should look like"),
    ("unknown owner", {"jane-doe.md": person(owner="bob")}, GOOD_I, "not a team handle"),
    ("bad status", {"jane-doe.md": person(status="maybe")}, GOOD_I, "not allowed"),
    ("bad date", GOOD_P, {"2026-11-24-jane-doe.md": interview(date="Nov 24")}, "YYYY-MM-DD"),
    ("granola source without id", GOOD_P, {"2026-11-24-jane-doe.md": interview(gid="")}, "granola_id is empty"),
    ("manual source without id passes", GOOD_P, {"2026-11-24-jane-doe.md": interview(gid="", source="manual")}, None),
    ("missing transcript section", GOOD_P, {"2026-11-24-jane-doe.md": interview(transcript="")}, "no '## Transcript'"),
    ("person does not link back", {"jane-doe.md": person(link="nothing")}, GOOD_I, "does not link back"),
    ("transcript shorter than Granola reported", GOOD_P, {"2026-11-24-jane-doe.md": interview(chars="5000")}, "cut short"),
    ("granola transcript with no size", GOOD_P, {"2026-11-24-jane-doe.md": interview(chars="")}, "transcript_chars must be"),
    ("summary only marked complete", GOOD_P, {"2026-11-24-jane-doe.md": interview(transcript="## Transcript\n", chars="", source="manual", gid="")}, "transcript is empty"),
    ("placeholder marked complete", GOOD_P, {"2026-11-24-jane-doe.md": interview(transcript="## Transcript\n(transcript not yet added)", chars="", source="manual", gid="")}, "transcript is empty"),
    ("pending transcript is allowed but listed", GOOD_P, {"2026-11-24-jane-doe.md": interview(transcript="## Transcript\n(transcript not yet added)", state="pending", chars="")}, "PENDING"),
    ("bad transcript state", GOOD_P, {"2026-11-24-jane-doe.md": interview(state="sort of")}, "complete or pending"),
    ("no frontmatter", GOOD_P, {"2026-11-24-jane-doe.md": "just text"}, "missing frontmatter"),
    # Outreach: one file per touch in touches/. A fourth item is the touches folder; leaving it out means no folder.
    ("person plus one valid touch passes", lone(status="contacted"), {}, None, GOOD_T),
    ("contacted with no touch", lone(status="contacted"), {}, "has no touch file", {}),
    ("to-contact with no touch passes", lone(status="to-contact"), {}, None, {}),
    ("status replied accepted", lone(status="replied"), {}, None, GOOD_T),
    ("status do-not-contact accepted", lone(status="do-not-contact"), {}, None, {}),
    ("status maybe refused", lone(status="maybe"), {}, "not allowed", {}),
    ("touch with unknown person", lone(status="to-contact"), {}, (f"touches/{T_NAME}", "no people/john-roe.md"), {T_NAME: touch(person="john-roe")}),
    ("touch with bad date",) + bad_touch((f"touches/{T_NAME}", "date 'Nov 20' should be YYYY-MM-DD"), date="Nov 20"),
    ("touch with bad channel",) + bad_touch((f"touches/{T_NAME}", "channel 'fax' is not allowed"), channel="fax"),
    ("touch by a non-team handle",) + bad_touch((f"touches/{T_NAME}", "by 'bob' is not a team handle"), by="bob"),
    ("touch with bad next_due",) + bad_touch((f"touches/{T_NAME}", "next_due 'soon' should be empty or YYYY-MM-DD"), next_due="soon"),
    ("touch with empty body",) + bad_touch((f"touches/{T_NAME}", "body is empty"), body=""),
    ("touch with no frontmatter",) + bad_touch((f"touches/{T_NAME}", "missing frontmatter"))[:3] + ({T_NAME: "just text"},),
    ("duplicate name with titles and accents", RENEE, {}, ("people/renee-a.md", "people/renee-b.md", "same name"), {}),
    ("same name but different contacts still flagged", {"renee-a.md": person(id="DD-01", name="Renée Alvarez", contact="a@x-org.example.org", link="none yet", status="to-contact"),
                                                        "renee-b.md": person(id="DD-02", name="Renée Alvarez", contact="b@x-org.example.org", link="none yet", status="to-contact")},
     {}, ("people/renee-a.md", "people/renee-b.md", "same name"), {}),
    ("duplicate contact differing in case and spaces", {"ann-a.md": person(id="DD-01", name="Ann Avery", contact="Ann@Example.org", link="none yet", status="to-contact"),
                                                        "bea-b.md": person(id="DD-02", name="Bea Brown", contact="  ann@example.ORG ", link="none yet", status="to-contact")},
     {}, ("people/ann-a.md", "people/bea-b.md", "same contact"), {}),
    ("both contacts empty and different names passes", {"ann-a.md": person(id="DD-01", name="Ann Avery", link="none yet", status="to-contact"),
                                                        "bea-b.md": person(id="DD-02", name="Bea Brown", link="none yet", status="to-contact")}, {}, None, {}),
    ("no touches folder passes", lone(status="to-contact"), {}, None),
    ("template in touches is ignored", lone(status="contacted"), {}, None, {"_TEMPLATE.md": "junk", **GOOD_T}),
]

NAMES = [
    ("Dr. Renée Álvarez, MD", "renee alvarez"),
    ("Renée Alvarez", "renee alvarez"),
    ("  Ms.  Anne-Marie O'Neil, Ph.D. ", "anne marie oneil"),
    ("Mr John SMITH RN", "john smith"),
    ("Dorothy Mdoe", "dorothy mdoe"),
    # An apostrophe, straight or curly, is dropped, not turned into a space.
    ("Anne O'Neil", "anne oneil"),
    ("Anne ONeil", "anne oneil"),
    ("anne o’neil", "anne oneil"),
    ("D‘Angelo Russo", "dangelo russo"),
]

failed = 0
for label, people, interviews, expect, *rest in CASES:
    problems, pending = check(build(people, interviews, rest[0] if rest else None))
    if expect == "PENDING":
        ok = not problems and len(pending) == 1
    elif expect is None:
        ok = not problems and not pending
    else:
        # A tuple means one single problem line must contain every part.
        parts = (expect,) if isinstance(expect, str) else expect
        ok = any(all(part in p for part in parts) for p in problems)
    if not ok:
        failed += 1
    print(("PASS  " if ok else "FAIL  ") + label + ("" if ok else f"  -> {problems}"))
for raw, want in NAMES:
    got = normalize_name(raw)
    ok = got == want
    if not ok:
        failed += 1
    print(("PASS  " if ok else "FAIL  ") + f"normalize_name({raw!r})" + ("" if ok else f"  -> {got!r}, wanted {want!r}"))


repo_problems, _ = check(Path(__file__).resolve().parent.parent)
REPO_OK = not repo_problems
if not REPO_OK:
    failed += 1
print(("PASS  " if REPO_OK else "FAIL  ") + "scripts/check.py on the repo as it is passes" + ("" if REPO_OK else f"  -> {repo_problems}"))

total = len(CASES) + len(NAMES) + 1
print(f"{total - failed}/{total} passed")
sys.exit(1 if failed else 0)
