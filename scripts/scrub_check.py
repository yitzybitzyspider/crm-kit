#!/usr/bin/env python3
"""Refuse a tree that carries another team's real people or project.

Fails (exit 1) on:
  - any term from a deny list kept outside the repo. Its path is given by the
    env var CRM_KIT_DENYLIST (one term per line, # starts a comment). Matching
    is case insensitive and on word boundaries. Without the env var the check
    still runs the other rules and says the deny list was skipped.
  - any Supabase project address (<20 character ref>.supabase.co)
  - any email address not at example.org or one of its subdomains (GitHub
    noreply addresses and the reserved .test domain are allowed)
  - any file under interviews/ or people/

Usage: python3 scripts/scrub_check.py [root]
Prints each hit as path:line: rule. Never prints the deny list itself beyond
the matched word.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

PROJECT_REF = re.compile(r"\b[a-z0-9]{20}\.supabase\.co\b", re.I)
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b")
ALLOWED_EMAIL_DOMAINS = {"example.org", "users.noreply.github.com"}
FORBIDDEN_DIRS = ("interviews/", "people/")
SKIP_DIRS = {".git", "node_modules", "dist", "__pycache__"}
SELF = "scripts/scrub_check.py"
# A PostgREST filter key such as "archived_at@not.is" looks like an email; it is not one.
POSTGREST_FILTER = re.compile(r"^not\.(is|in|eq|neq|gt|gte|lt|lte|like|ilike|cs|cd|ov|fts)$")
# Upstream Atomic CRM fixtures whose addresses are the upstream company's own or
# well known public domains, needed as they are for the test to mean anything.
# hub_actions_inbox.sql needs gmail.com itself: it tests that a free mail
# domain never suggests a person by domain.
EMAIL_EXEMPT = {
    "app/src/components/atomic-crm/providers/commons/getContactAvatar.test.ts",
    "app/supabase/tests/hub_actions_inbox.sql",
}


def load_denylist(path: str | None) -> list[str]:
    if not path:
        return []
    terms = []
    for line in Path(path).expanduser().read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            terms.append(line)
    return terms


def deny_pattern(terms: list[str]) -> re.Pattern | None:
    if not terms:
        return None
    parts = sorted((re.escape(t) for t in terms), key=len, reverse=True)
    return re.compile(r"(?<!\w)(?:" + "|".join(parts) + r")(?!\w)", re.I)


def list_files(root: Path) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
            cwd=root, capture_output=True, text=True, check=True,
        ).stdout
        files = [f for f in out.splitlines() if f]
        if files:
            return files
    except (OSError, subprocess.CalledProcessError):
        pass
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            files.append(str(Path(dirpath, name).relative_to(root)))
    return files


def scan(root: Path, terms: list[str]) -> list[str]:
    hits: list[str] = []
    pat = deny_pattern(terms)
    for rel in sorted(list_files(root)):
        rel = rel.replace(os.sep, "/")
        if rel.startswith(FORBIDDEN_DIRS):
            hits.append(f"{rel}: file under a research folder (interviews/ or people/)")
            continue
        if pat and pat.search(rel):
            hits.append(f"{rel}: deny list term in the file name")
        if rel == SELF:
            continue
        path = root / rel
        if not path.is_file():
            continue
        data = path.read_bytes()
        if b"\0" in data[:8192]:
            continue  # binary: images are checked by a person (see the scrub report)
        text = data.decode("utf-8", errors="ignore")
        for no, line in enumerate(text.splitlines(), 1):
            if pat:
                m = pat.search(line)
                if m:
                    hits.append(f"{rel}:{no}: deny list term '{m.group(0)}'")
            if PROJECT_REF.search(line):
                hits.append(f"{rel}:{no}: Supabase project address")
            for m in EMAIL.finditer(line):
                domain = m.group(1).lower()
                if rel in EMAIL_EXEMPT or POSTGREST_FILTER.match(domain):
                    continue
                if domain not in ALLOWED_EMAIL_DOMAINS and not domain.endswith((".example.org", ".test")):
                    hits.append(f"{rel}:{no}: email outside example.org ({m.group(0)})")
    return hits


def main(argv: list[str]) -> int:
    root = Path(argv[1] if len(argv) > 1 else ".").resolve()
    deny_path = os.environ.get("CRM_KIT_DENYLIST")
    terms = load_denylist(deny_path)
    if not deny_path:
        print("scrub_check: CRM_KIT_DENYLIST not set, deny list skipped", file=sys.stderr)
    hits = scan(root, terms)
    for h in hits:
        print(h)
    if hits:
        print(f"scrub_check: {len(hits)} hit(s). Nothing may be pushed until they are gone.", file=sys.stderr)
        return 1
    print(f"scrub_check: clean ({len(terms)} deny list terms checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
