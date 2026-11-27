#!/usr/bin/env python3
"""Tests for check_logs.py. Run: python3 scripts/test_check_logs.py

Each case builds a throwaway git repo in a temp dir with a base commit and a
head commit, then runs check_logs.py over the pair as a separate process.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "check_logs.py"
ZEROS = "0" * 40

DEVLOG = """# Dev log

Append only.

## 2026-01-01 First entry

- **Changed:** something old.
- **Verified:** old proof.
- **Not verified:** old gap.
"""

DECISIONS = """# Decisions

## 2026-01-01 Start

- **First choice.** Why: reasons.
- **Second choice.** Why: more reasons.
"""

FINDINGS = """# Findings

## 2026-01-01 Start

- **A surprise.** Rule: a rule.
"""

CLAUDE = """# Rules

## Skills

- `/crm-sync`: bring interviews in.
"""

ENTRY = """
## 2026-02-02 Issue 9: a change

- **Changed:** the script.
- **Verified:** tests pass.
- **Not verified:** a teammate's machine.
"""

BASE = {
    "CLAUDE.md": CLAUDE,
    ".claude/skills/crm-sync/SKILL.md": "sync\n",
    "scripts/check.py": "print('v1')\n",
    "people/_TEMPLATE.md": "template v1\n",
    "interviews/2026-01-01-jane.md": "an interview\n",
    "docs/DEVLOG.md": DEVLOG,
    "docs/DECISIONS.md": DECISIONS,
    "docs/FINDINGS.md": FINDINGS,
}

ENV = dict(
    os.environ,
    GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example-com.example.org",
    GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example-com.example.org",
    GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull,
)
for _k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
    ENV.pop(_k, None)  # set when run from inside a git hook

TEMPS = []


def git(root, *args):
    out = subprocess.run(["git", "-C", str(root), *args], env=ENV,
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("git %s: %s" % (" ".join(args), out.stderr))
    return out.stdout.strip()


def commit(root, files, message):
    """files: path -> text, or None to delete the path."""
    for rel, text in files.items():
        p = Path(root) / rel
        if text is None:
            p.unlink()
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
    git(root, "add", "-A")
    git(root, "commit", "-q", "--allow-empty", "-m", message)
    return git(root, "rev-parse", "HEAD")


def pair(changes):
    """A fresh repo with BASE committed, then `changes` committed on top."""
    root = Path(tempfile.mkdtemp())
    TEMPS.append(root)
    git(root, "init", "-q")
    base = commit(root, BASE, "base")
    head = commit(root, changes, "head")
    return root, base, head


def run(root, base, head, body=None, body_path=None):
    cmd = [sys.executable, str(SCRIPT), base, head, "--root", str(root)]
    if body is not None:
        body_path = Path(root) / ".git" / "pr_body.txt"
        body_path.write_text(body)
    if body_path is not None:
        cmd += ["--pr-body-file", str(body_path)]
    out = subprocess.run(cmd, env=ENV, capture_output=True, text=True)
    return out.returncode, out.stdout + out.stderr


def check(changes, body=None):
    root, base, head = pair(changes)
    return run(root, base, head, body=body)


SCRIPT_CHANGE = {"scripts/check.py": "print('v2')\n"}
CASES = []


def case(fn):
    CASES.append(fn)
    return fn


def expect(result, code, *needles):
    got, text = result
    assert got == code, "exit %s, wanted %s. Output:\n%s" % (got, code, text)
    for n in needles:
        assert n in text, "missing %r in output:\n%s" % (n, text)
    assert "Traceback" not in text, "traceback in output:\n%s" % text


# ---- the fourteen listed cases ----

@case
def t01_content_only_passes():
    expect(check({"interviews/2026-01-01-jane.md": "edited\n",
                  "people/p1.md": "new person\n"}), 0)


@case
def t02_script_without_devlog_passes_since_the_postmortem():
    expect(check(SCRIPT_CHANGE), 0)


@case
def t03_script_with_full_entry_passes():
    expect(check(dict(SCRIPT_CHANGE, **{"docs/DEVLOG.md": DEVLOG + ENTRY})), 0)


@case
def t04_entry_missing_not_verified_passes():
    entry = ENTRY.replace("- **Not verified:** a teammate's machine.\n", "")
    expect(check(dict(SCRIPT_CHANGE, **{"docs/DEVLOG.md": DEVLOG + entry})), 0)


@case
def t05_entry_without_dated_heading_passes():
    entry = ENTRY.replace("## 2026-02-02 Issue 9", "## Issue 9")
    expect(check(dict(SCRIPT_CHANGE, **{"docs/DEVLOG.md": DEVLOG + entry})), 0)


@case
def t06_old_devlog_line_edited_fails():
    edited = DEVLOG.replace("something old", "something else")
    expect(check({"docs/DEVLOG.md": edited + ENTRY}), 1, "append only",
           "docs/DEVLOG.md")


@case
def t07_old_decisions_line_deleted_fails():
    cut = DECISIONS.replace("- **Second choice.** Why: more reasons.\n", "")
    expect(check({"docs/DECISIONS.md": cut}), 1, "append only",
           "docs/DECISIONS.md")


@case
def t08_new_skill_not_named_fails():
    expect(check({".claude/skills/crm-new/SKILL.md": "new\n",
                  "docs/DEVLOG.md": DEVLOG + ENTRY}), 1, "/crm-new")


@case
def t09_new_skill_named_with_devlog_passes():
    expect(check({".claude/skills/crm-new/SKILL.md": "new\n",
                  "CLAUDE.md": CLAUDE + "- `/crm-new`: a new skill.\n",
                  "docs/DEVLOG.md": DEVLOG + ENTRY}), 0)


@case
def t10_template_without_devlog_passes():
    expect(check({"people/_TEMPLATE.md": "template v2\n"}), 0)


@case
def t11_pr_body_closes_passes():
    expect(check(dict(SCRIPT_CHANGE, **{"docs/DEVLOG.md": DEVLOG + ENTRY}),
                 body="Adds a thing.\n\nCloses #12\n"), 0)


@case
def t12_pr_body_empty_system_change_passes():
    expect(check(dict(SCRIPT_CHANGE, **{"docs/DEVLOG.md": DEVLOG + ENTRY}),
                 body=""), 0)


@case
def t13_pr_body_empty_content_change_passes():
    expect(check({"interviews/2026-01-01-jane.md": "edited\n"}, body=""), 0)


@case
def t14_unknown_base_commit_exits_2():
    root, _base, head = pair(SCRIPT_CHANGE)
    expect(run(root, "deadbeef" * 5, head), 2, "unknown commit")


# ---- the listed edge cases ----

@case
def t15_base_all_zeros_passes():
    root, _base, head = pair(SCRIPT_CHANGE)
    expect(run(root, ZEROS, head), 0)


@case
def t16_entry_in_the_middle_is_allowed():
    middle = DEVLOG.replace("\n## 2026-01-01 First entry",
                            ENTRY + "\n## 2026-01-01 First entry")
    expect(check(dict(SCRIPT_CHANGE, **{"docs/DEVLOG.md": middle})), 0)


@case
def t17_whitespace_fix_on_old_line_refused():
    fixed = FINDINGS.replace("Rule: a rule.", "Rule: a rule. ")
    expect(check({"docs/FINDINGS.md": fixed}), 1, "append only",
           "docs/FINDINGS.md")


@case
def t18_empty_skill_directory_must_be_named():
    root, base, head = pair({"interviews/x.md": "x\n"})
    (root / ".claude/skills/crm-empty").mkdir()
    expect(run(root, base, head), 1, "/crm-empty")


@case
def t19_missing_pr_body_file_is_reported_not_crashed():
    root, base, head = pair(dict(SCRIPT_CHANGE,
                                 **{"docs/DEVLOG.md": DEVLOG + ENTRY}))
    expect(run(root, base, head, body_path=root / "no-such-file.txt"), 0)


@case
def t20_not_a_git_repo_exits_2():
    root = Path(tempfile.mkdtemp())
    TEMPS.append(root)
    expect(run(root, "HEAD~1", "HEAD"), 2, "not a git repository")


# ---- cases that guard choices made while building ----

@case
def t21_skill_name_must_match_whole_name():
    # /crm-sync in CLAUDE.md must not count as naming a skill called kit.
    expect(check({".claude/skills/kit/SKILL.md": "x\n",
                  "docs/DEVLOG.md": DEVLOG + ENTRY}), 1,
           "skill /kit is not named")


@case
def t22_base_branch_moving_ahead_is_not_a_removal():
    # main gains a log entry after the branch point. Comparing the two tips
    # directly would read that entry as removed by the branch.
    root = Path(tempfile.mkdtemp())
    TEMPS.append(root)
    git(root, "init", "-q")
    fork = commit(root, BASE, "base")
    main = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    git(root, "checkout", "-q", "-b", "work")
    head = commit(root, {"interviews/y.md": "y\n"}, "work")
    git(root, "checkout", "-q", main)
    tip = commit(root, dict(SCRIPT_CHANGE,
                            **{"docs/DEVLOG.md": DEVLOG + ENTRY}), "main moves")
    assert tip != fork
    expect(run(root, tip, head), 0)


@case
def t23_docs_other_than_protocol_are_content():
    expect(check({"docs/NOTES.md": "notes\n", "FOCUS.md": "focus\n",
                  "OUTREACH.md": "table\n"}), 0)


@case
def t24_no_system_path_kind_needs_a_devlog_any_more():
    for path in (".github/workflows/check.yml", ".githooks/pre-push",
                 ".mcp.json", ".gitattributes", "CLAUDE.md", "README.md",
                 "docs/PROTOCOL.md", "interviews/_TEMPLATE.md"):
        text = CLAUDE + "more\n" if path == "CLAUDE.md" else "x\n"
        expect(check({path: text}), 0)


@case
def t25_fixes_and_resolves_count():
    changes = dict(SCRIPT_CHANGE, **{"docs/DEVLOG.md": DEVLOG + ENTRY})
    expect(check(changes, body="fixes #3"), 0)
    expect(check(changes, body="Resolves #40."), 0)
    expect(check(changes, body="Closes the loop on #3"), 0)


@case
def t26_deleting_a_system_file_needs_no_devlog():
    expect(check({"scripts/check.py": None}), 0)


# ---- cases added when issue 1 was reopened ----

RULED = DECISIONS + "\n---\n\n-- a note that starts with two hyphens\n"


def with_ruled_log(changes):
    """Like pair(), but the base DECISIONS log holds lines starting with hyphens."""
    root = Path(tempfile.mkdtemp())
    TEMPS.append(root)
    git(root, "init", "-q")
    base = commit(root, dict(BASE, **{"docs/DECISIONS.md": RULED}), "base")
    head = commit(root, changes, "head")
    return run(root, base, head)


@case
def t27_old_rule_line_removed_is_refused():
    cut = RULED.replace("\n---\n", "\n")
    assert cut != RULED
    expect(with_ruled_log({"docs/DECISIONS.md": cut}), 1, "append only",
           "docs/DECISIONS.md")


@case
def t28_old_line_starting_with_two_hyphens_edited_is_refused():
    edited = RULED.replace("-- a note that", "-- a remark that")
    assert edited != RULED
    expect(with_ruled_log({"docs/DECISIONS.md": edited}), 1, "append only",
           "docs/DECISIONS.md")


@case
def t29_added_line_starting_with_plus_signs_counts_as_added():
    # The only added dev log line starts "+++". It must still count as an
    # entry, so the script change is not reported as having no dev log.
    result = check(dict(SCRIPT_CHANGE,
                        **{"docs/DEVLOG.md": DEVLOG + "+++ text\n"}))
    expect(result, 0)


@case
def t30_removed_plus_line_and_header_lookalikes_are_counted():
    # Two hyphen lines removed and one "+++" line added in one change.
    cut = RULED.replace("\n---\n", "\n").replace(
        "-- a note that starts with two hyphens\n", "+++ new\n")
    expect(with_ruled_log({"docs/DECISIONS.md": cut}), 1,
           "2 existing lines removed")


@case
def t31_skill_folder_holding_only_an_empty_file_must_be_named():
    # The nearest thing to an empty folder that git can carry in a commit.
    expect(check({".claude/skills/crm-hollow/.gitkeep": "",
                  "docs/DEVLOG.md": DEVLOG + ENTRY}), 1, "/crm-hollow")


@case
def t32_app_change_without_devlog_passes():
    expect(check({"app/src/App.tsx": "export default 1;\n"}), 0)


@case
def t33_app_change_with_full_entry_passes():
    expect(check({"app/src/App.tsx": "export default 1;\n",
                  "docs/DEVLOG.md": DEVLOG + ENTRY}), 0)


@case
def t34_app_change_on_a_pull_request_needs_no_issue_link():
    change = {"app/supabase/migrations/1_x.sql": "select 1;\n",
              "docs/DEVLOG.md": DEVLOG + ENTRY}
    expect(check(change, body="Adds a migration."), 0)
    expect(check(change, body="Closes #18"), 0)


@case
def t35_a_folder_that_only_starts_with_app_is_content():
    expect(check({"apple/notes.md": "x\n", "application.md": "x\n"}), 0)


# ---- issue 27: db/ is generated by the export job ----

GENERATED = "db/ is generated by the export job: an edit made by hand is overwritten by the next run"
BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"
# The export job sets user.name and user.email with git -c, so author and
# committer are both the bot (.github/workflows/export.yml, commit step).
BOT = {"GIT_AUTHOR_NAME": "github-actions[bot]", "GIT_AUTHOR_EMAIL": BOT_EMAIL,
       "GIT_COMMITTER_NAME": "github-actions[bot]", "GIT_COMMITTER_EMAIL": BOT_EMAIL}
WORKFLOWS = SCRIPT.parent.parent / ".github" / "workflows"


def commit_as(root, files, message, who=None):
    """Like commit(), with another author."""
    for rel, text in files.items():
        q = Path(root) / rel
        q.parent.mkdir(parents=True, exist_ok=True)
        q.write_text(text)
    env = dict(ENV, **(who or {}))
    for args in (("add", "-A"), ("commit", "-q", "-m", message)):
        out = subprocess.run(["git", "-C", str(root), *args], env=env, capture_output=True, text=True)
        if out.returncode != 0:
            raise RuntimeError(out.stderr)
    return git(root, "rev-parse", "HEAD")


def history(*commits):
    """A repo with BASE, then each (files, message, author) on top. Returns root, base, head."""
    root = Path(tempfile.mkdtemp())
    TEMPS.append(root)
    git(root, "init", "-q")
    base = head = commit(root, BASE, "base")
    for files, message, who in commits:
        head = commit_as(root, files, message, who)
    return root, base, head


EXPORT_FILES = {"db/people/x.md": "a person\n", "db/export.json": "{}\n"}


@case
def t36_a_person_editing_db_is_refused_with_the_generated_sentence():
    expect(run(*history(({"db/people/x.md": "edited by hand\n"}, "fix a typo", None))), 1, GENERATED)
    # a person who borrows the message, and the job's author with another message
    expect(run(*history((EXPORT_FILES, "Export: 3 people, 2 interviews", None))), 1, GENERATED)
    expect(run(*history((EXPORT_FILES, "tidy the copy", BOT))), 1, GENERATED)


@case
def t37_the_export_jobs_commit_passes_with_no_dev_log_entry():
    expect(run(*history((EXPORT_FILES, "Export: 3 people, 2 interviews", BOT))), 0)
    # and beside a teammate's research, each in its own commit
    expect(run(*history(({"people/p1.md": "new person\n"}, "add a person", None),
                        (EXPORT_FILES, "Export: 3 people, 2 interviews", BOT),
                        ({"db/people/x.md": "a person, changed\n"}, "Export: 3 people, 3 interviews", BOT))), 0)


@case
def t38_an_export_commit_that_also_touches_scripts_is_refused():
    both = dict(EXPORT_FILES, **{"scripts/check.py": "print('v2')\n", "docs/DEVLOG.md": DEVLOG + ENTRY})
    expect(run(*history((both, "Export: 3 people, 2 interviews", BOT))), 1, GENERATED)
    content = dict(EXPORT_FILES, **{"people/p1.md": "new person\n"})
    expect(run(*history((content, "Export: 3 people, 2 interviews", BOT))), 1, GENERATED)


@case
def t39_a_pull_request_that_adds_a_file_under_db_is_refused():
    root, base, head = history((EXPORT_FILES, "Export: 3 people, 2 interviews", BOT))
    expect(run(root, base, head, body="Closes #27"), 1, GENERATED)
    root, base, head = history(({"db/README.md": "by hand\n", "docs/DEVLOG.md": DEVLOG + ENTRY}, "add", None))
    expect(run(root, base, head, body="Closes #27"), 1, GENERATED)
    # a hand edit undone in a later commit is still a hand edit on a push, and nothing on a pull request
    root, base, head = history(({"db/README.md": "by hand\n"}, "add", None))
    git(root, "rm", "-q", "db/README.md")
    git(root, "commit", "-q", "-m", "take it back")
    head = git(root, "rev-parse", "HEAD")
    expect(run(root, base, head), 1, GENERATED)
    expect(run(root, base, head, body=""), 0)
    # a folder that only starts with db is content
    expect(run(*history(({"dbnotes/x.md": "x\n", "db.md": "x\n"}, "notes", None))), 0)


@case
def t41_issue40_author_name_forged_but_committer_email_not_the_bots_is_refused():
    forged = {"GIT_AUTHOR_NAME": "github-actions[bot]", "GIT_AUTHOR_EMAIL": BOT_EMAIL,
              "GIT_COMMITTER_NAME": "github-actions[bot]", "GIT_COMMITTER_EMAIL": "teammate@example.org"}
    expect(run(*history((EXPORT_FILES, "Export: 3 people, 2 interviews", forged))), 1, GENERATED)
    name_only = {"GIT_AUTHOR_NAME": "github-actions[bot]", "GIT_COMMITTER_NAME": "github-actions[bot]"}
    expect(run(*history((EXPORT_FILES, "Export: 3 people, 2 interviews", name_only))), 1, GENERATED)


@case
def t42_issue40_bot_author_and_email_with_a_file_outside_db_is_refused():
    outside = dict(EXPORT_FILES, **{"notes.md": "a teammate's file\n"})
    expect(run(*history((outside, "Export: 3 people, 2 interviews", BOT))), 1, GENERATED)


@case
def t43_issue40_the_real_export_commit_shape_passes():
    expect(run(*history((EXPORT_FILES, "Export: 3 people, 2 interviews", BOT))), 0)


LIVE = '{"url": "https://x.supabase.co", "publishable_key": "", "address": "https://hub.example.org", "live": true}\n'
NOT_LIVE = LIVE.replace("true", "false")
MIGRATION = {"app/supabase/migrations/29990101000000_hub_x.sql": "select 1;\n", "docs/DEVLOG.md": DEVLOG + ENTRY}
LIVE_SENTENCE = ("the hub is live: a migration is merged by a person, after a dump. "
                 "Add the label needs-human-merge")


def check_live(base_hub, changes, labels=None, body="Closes #28"):
    root = Path(tempfile.mkdtemp())
    TEMPS.append(root)
    git(root, "init", "-q")
    files = dict(BASE)
    if base_hub is not None:
        files["hub.json"] = base_hub
    base = commit(root, files, "base")
    head = commit(root, changes, "head")
    cmd = [sys.executable, str(SCRIPT), base, head, "--root", str(root)]
    if body is not None:
        (root / ".git" / "pr_body.txt").write_text(body)
        cmd += ["--pr-body-file", str(root / ".git" / "pr_body.txt")]
    if labels is not None:
        (root / ".git" / "labels.txt").write_text("\n".join(labels))
        cmd += ["--pr-labels-file", str(root / ".git" / "labels.txt")]
    out = subprocess.run(cmd, env=ENV, capture_output=True, text=True)
    return out.returncode, out.stdout + out.stderr


@case
def t44_issue28_live_migration_without_the_label_is_refused():
    expect(check_live(LIVE, MIGRATION, labels=[]), 1, LIVE_SENTENCE)
    expect(check_live(LIVE, MIGRATION, labels=["area:app"]), 1, LIVE_SENTENCE)


@case
def t45_issue28_live_migration_with_the_label_passes():
    expect(check_live(LIVE, MIGRATION, labels=["area:app", "needs-human-merge"]), 0)


@case
def t46_issue28_live_revert_file_without_the_label_is_refused():
    changes = {"app/supabase/reverts/29990101000000_hub_x.sql": "select 1;\n", "docs/DEVLOG.md": DEVLOG + ENTRY}
    expect(check_live(LIVE, changes, labels=[]), 1, LIVE_SENTENCE)


@case
def t47_issue28_not_live_migration_without_the_label_passes():
    expect(check_live(NOT_LIVE, MIGRATION, labels=[]), 0)
    expect(check_live(None, MIGRATION, labels=[]), 0)


@case
def t48_issue28_live_turned_back_off_is_refused():
    expect(check_live(LIVE, {"hub.json": NOT_LIVE}, labels=["needs-human-merge"]), 1, "live")
    expect(check_live(LIVE, {"hub.json": NOT_LIVE}, body=None), 1, "live")
    expect(check_live(LIVE, {"hub.json": None}, labels=["needs-human-merge"]), 1, "live")


@case
def t49_issue28_live_turned_on_passes():
    expect(check_live(NOT_LIVE, {"hub.json": LIVE}, labels=["needs-human-merge"]), 0)


@case
def t50_issue28_live_app_src_change_needs_no_label():
    changes = {"app/src/x.ts": "export {}\n", "docs/DEVLOG.md": DEVLOG + ENTRY}
    expect(check_live(LIVE, changes, labels=[]), 0)


@case
def t51_issue28_live_migration_with_no_labels_file_is_refused_on_a_pull_request():
    expect(check_live(LIVE, MIGRATION, labels=None), 1, LIVE_SENTENCE)


@case
def t52_issue28_check_yml_passes_the_labels_through_a_file():
    import re
    text = (WORKFLOWS / "check.yml").read_text()
    assert "--pr-labels-file" in text, "check.yml does not pass the labels"
    assert re.search(r"types:\s*\[[^\]]*labeled[^\]]*unlabeled", text), "a label change does not run the check again"
    assert "labels.*.name" in text and "github.event.pull_request.labels" not in "\n".join(
        l for l in text.splitlines() if "run:" in l or l.strip().startswith(("python3", "printf", "echo"))), \
        "labels are put inside a run line"


def main():
    failed = 0
    for fn in CASES:
        try:
            fn()
            print("ok    " + fn.__name__)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL  " + fn.__name__ + ": " + str(e))
    for t in TEMPS:
        shutil.rmtree(t, ignore_errors=True)
    print("%d cases, %d failed" % (len(CASES), failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
