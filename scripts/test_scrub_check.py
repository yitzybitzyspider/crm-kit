#!/usr/bin/env python3
"""Tests for scripts/scrub_check.py. Each case builds a throwaway tree.

A planted team name fails; a planted project address fails; an email outside
example.org fails; a file under people/ or interviews/ fails; a clean tree
passes. Standard library only.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "scrub_check.py"
results = []


def case(label, ok, detail=""):
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + label + ("" if ok else f"  -> {detail}"))


def tree(files, deny=("Team Member Zed", "Zedcorp General")):
    root = Path(tempfile.mkdtemp(prefix="scrub-"))
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    deny_file = Path(tempfile.mkdtemp(prefix="deny-")) / "deny.txt"
    deny_file.write_text("# a comment\n" + "\n".join(deny) + "\n", encoding="utf-8")
    return root, deny_file


def run(root, deny_file):
    env = dict(os.environ, CRM_KIT_DENYLIST=str(deny_file))
    p = subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True, env=env)
    return p.returncode, p.stdout + p.stderr


# Planted values are built in pieces so this file does not trip the check itself.
REF = "abcdefghijklmnopqrst" + ".supa" + "base.co"
OUTSIDE = "someone" + "@" + "gmail.com"

CLEAN = {"README.md": "Write to team@example.org, a.b@lab.example.org or alpha@hub.test.\n",
         "app/src/x.ts": "export const handle = 'alpha';\n"}

root, deny = tree(CLEAN)
code, out = run(root, deny)
case("a clean tree passes", code == 0 and "clean" in out, out)

root, deny = tree({**CLEAN, "notes.md": "Met with team member zed today.\n"})
code, out = run(root, deny)
case("a planted team name fails, case insensitive", code == 1 and "notes.md:1" in out, out)

root, deny = tree({**CLEAN, "notes.md": "Met with Team Member Zedd today.\n"})
code, out = run(root, deny)
case("a longer word that only starts with a deny term passes", code == 0, out)

root, deny = tree({**CLEAN, "docs/zedcorp-general.md": "x\n"}, deny=("zedcorp-general",))
code, out = run(root, deny)
case("a deny term in a file name fails", code == 1 and "file name" in out, out)

root, deny = tree({**CLEAN, "hub.json": '{"url": "https://%s"}\n' % REF})
code, out = run(root, deny)
case("a planted project address fails", code == 1 and "Supabase project address" in out, out)

root, deny = tree({**CLEAN, "a.py": "OWNER = '%s'\n" % OUTSIDE})
code, out = run(root, deny)
case("an email outside example.org fails", code == 1 and OUTSIDE in out, out)

root, deny = tree({**CLEAN, "app/src/d.tsx": 'filter: { "archived_at@not.is": null }\n'})
code, out = run(root, deny)
case("a PostgREST filter key such as x@not.is passes", code == 0, out)

root, deny = tree({**CLEAN, "people/x.md": "placeholder\n"})
code, out = run(root, deny)
case("a file under people/ fails", code == 1 and "people/x.md" in out, out)

root, deny = tree({**CLEAN, "interviews/y.md": "placeholder\n"})
code, out = run(root, deny)
case("a file under interviews/ fails", code == 1 and "interviews/y.md" in out, out)

root, deny = tree({**CLEAN, "app/src/people/List.tsx": "export {};\n"})
code, out = run(root, deny)
case("a nested folder named people/ inside the app passes", code == 0, out)

root, _ = tree(CLEAN)
env = {k: v for k, v in os.environ.items() if k != "CRM_KIT_DENYLIST"}
p = subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True, env=env)
case("without CRM_KIT_DENYLIST the other rules still run and it says the list was skipped",
     p.returncode == 0 and "deny list skipped" in p.stderr, p.stdout + p.stderr)

print(f"{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
