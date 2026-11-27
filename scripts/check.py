#!/usr/bin/env python3
"""Check that interviews, people and outreach touches in this repo are well formed and linked.

Usage: python3 scripts/check.py [repo_root]
Exits 0 when clean, 1 with one line per problem otherwise.
"""
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from team import CHANNELS, HANDLES, STATUSES, STATUSES_NEEDING_TOUCH, normalize_name  # noqa: E402

INTERVIEW_KEYS = ["date", "person", "interviewer", "source", "granola_id", "hypotheses", "consent_to_record", "transcript", "transcript_chars"]
PERSON_KEYS = ["id", "name", "owner", "status", "quote_by_name"]


def frontmatter(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    out = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        if ":" in line:
            key, value = line.split(":", 1)
            out[key.strip()] = value.strip()
    return None


def body_after_frontmatter(path):
    """The text below the closing --- of the frontmatter block."""
    lines = path.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "\n".join(lines[i + 1:]).strip()
    return ""


def is_date(value):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def real_files(folder):
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.glob("*.md") if not p.name.startswith("_") and p.name != "README.md")


def check(root):
    root = Path(root)
    problems = []
    people = {}
    ids = {}
    names = {}
    contacts = {}
    pending = []

    for path in real_files(root / "people"):
        fm = frontmatter(path)
        if fm is None:
            problems.append(f"{path.name}: missing frontmatter block")
            continue
        people[path.stem] = fm
        for key in PERSON_KEYS:
            if not fm.get(key):
                problems.append(f"people/{path.name}: '{key}' is empty")
        pid = fm.get("id", "")
        if pid and not re.fullmatch(r"[A-Z]{2}-\d{2,}", pid):
            problems.append(f"people/{path.name}: id '{pid}' should look like AA-03")
        if pid in ids:
            problems.append(f"people/{path.name}: id '{pid}' is already used by {ids[pid]}")
        elif pid:
            ids[pid] = path.name
        if fm.get("owner") and fm["owner"] not in HANDLES:
            problems.append(f"people/{path.name}: owner '{fm['owner']}' is not a team handle")
        if fm.get("status") and fm["status"] not in STATUSES:
            problems.append(f"people/{path.name}: status '{fm['status']}' is not allowed")
        if fm.get("quote_by_name") and fm["quote_by_name"] not in {"yes", "no"}:
            problems.append(f"people/{path.name}: quote_by_name must be yes or no")
        # Duplicates: the same person added twice, possibly by two teammates.
        same = normalize_name(fm.get("name", ""))
        if same and same in names:
            problems.append(f"people/{names[same]} and people/{path.name}: same name ('{same}'), likely one person added twice")
        elif same:
            names[same] = path.name
        contact = fm.get("contact", "").strip().lower()
        if contact and contact in contacts:
            problems.append(f"people/{contacts[contact]} and people/{path.name}: same contact ('{contact}'), likely one person added twice")
        elif contact:
            contacts[contact] = path.name

    touched = set()
    for path in real_files(root / "touches"):
        name = f"touches/{path.name}"
        fm = frontmatter(path)
        if fm is None:
            problems.append(f"{name}: missing frontmatter block")
            continue
        for key in ["date", "person", "by", "channel"]:
            if not fm.get(key):
                problems.append(f"{name}: '{key}' is empty")
        if fm.get("date") and not is_date(fm["date"]):
            problems.append(f"{name}: date '{fm['date']}' should be YYYY-MM-DD")
        if fm.get("person"):
            if fm["person"] in people:
                touched.add(fm["person"])
            else:
                problems.append(f"{name}: no people/{fm['person']}.md for this person")
        if fm.get("by") and fm["by"] not in HANDLES:
            problems.append(f"{name}: by '{fm['by']}' is not a team handle")
        if fm.get("channel") and fm["channel"] not in CHANNELS:
            problems.append(f"{name}: channel '{fm['channel']}' is not allowed")
        if fm.get("next_due") and not is_date(fm["next_due"]):
            problems.append(f"{name}: next_due '{fm['next_due']}' should be empty or YYYY-MM-DD")
        if not body_after_frontmatter(path):
            problems.append(f"{name}: body is empty, say what was said or sent")

    for slug, fm in people.items():
        if fm.get("status") in STATUSES_NEEDING_TOUCH and slug not in touched:
            problems.append(f"people/{slug}.md: status '{fm['status']}' but has no touch file in touches/")

    granola_ids = {}
    for path in real_files(root / "interviews"):
        name = f"interviews/{path.name}"
        fm = frontmatter(path)
        if fm is None:
            problems.append(f"{name}: missing frontmatter block")
            continue
        for key in INTERVIEW_KEYS:
            if key not in fm:
                problems.append(f"{name}: '{key}' line is missing")
        for key in ["date", "person", "interviewer", "source"]:
            if key in fm and not fm[key]:
                problems.append(f"{name}: '{key}' is empty")
        if fm.get("date") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fm["date"]):
            problems.append(f"{name}: date '{fm['date']}' should be YYYY-MM-DD")
        if fm.get("person") and fm["person"] not in people:
            problems.append(f"{name}: no people/{fm['person']}.md for this person")
        if fm.get("interviewer") and fm["interviewer"] not in HANDLES:
            problems.append(f"{name}: interviewer '{fm['interviewer']}' is not a team handle")
        if fm.get("source") and fm["source"] not in {"granola", "manual"}:
            problems.append(f"{name}: source must be granola or manual")
        gid = fm.get("granola_id", "")
        if fm.get("source") == "granola" and not gid:
            problems.append(f"{name}: source is granola but granola_id is empty")
        if gid in granola_ids:
            problems.append(f"{name}: same Granola meeting as {granola_ids[gid]}")
        elif gid:
            granola_ids[gid] = name
        text = path.read_text(encoding="utf-8")
        if "## Transcript" not in text:
            problems.append(f"{name}: no '## Transcript' section")
        else:
            body = text.split("## Transcript", 1)[1].strip()
            state = fm.get("transcript", "")
            if state not in {"complete", "pending"}:
                problems.append(f"{name}: transcript must be complete or pending")
            elif state == "pending":
                pending.append(name)
            else:
                expected = fm.get("transcript_chars", "")
                if fm.get("source") == "granola" and not (expected.isdigit() and int(expected) > 0):
                    problems.append(f"{name}: transcript_chars must be the size Granola reported")
                elif expected.isdigit() and len(body) < int(expected):
                    problems.append(f"{name}: transcript is cut short ({len(body)} of {expected} characters)")
                elif not body or body.startswith("("):
                    problems.append(f"{name}: marked complete but the transcript is empty")
        if "## Overview" not in text:
            problems.append(f"{name}: no '## Overview' section")
        if fm.get("person") in people and path.name not in (root / "people" / f"{fm['person']}.md").read_text(encoding="utf-8"):
            problems.append(f"{name}: people/{fm['person']}.md does not link back to it")

    return problems, pending


if __name__ == "__main__":
    found, waiting = check(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
    for line in found:
        print(line)
    for line in waiting:
        print(f"STILL NEEDS ITS FULL TRANSCRIPT: {line}")
    print("OK" if not found else f"{len(found)} problem(s)")
    sys.exit(1 if found else 0)
