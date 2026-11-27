#!/bin/sh
# Take later improvements from the template this repo was made from, on purpose.
#
#   sh scripts/update_from_template.sh [--take PATH ...]
#
# Fetches the template's main branch, shows what changed under .claude/skills/,
# scripts/ and docs/, and applies it only after you answer yes. Never automatic.
#
# A file your team changed (or removed or renamed) that the template also
# changed is a conflict: your version is kept and the file is listed. Run again
# with --take PATH to take the template's version of that file instead.
#
# .template-version records the template commit last taken, so the next run
# only offers what changed since. Commit it with the rest.
#
# The template is the repo GitHub says this one was made from ("Use this
# template"), found with the gh command. CRM_KIT_TEMPLATE names it instead (a
# URL, owner/name, or a local folder; the tests use this).
# CRM_KIT_TEMPLATE_REF names another branch.
set -u
TEMPLATE="${CRM_KIT_TEMPLATE:-}"
REF="${CRM_KIT_TEMPLATE_REF:-main}"
PATHS=".claude/skills scripts docs"
RECORD=".template-version"
TREF="refs/crm-kit/template"

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "update: not inside a git repo"; exit 2; }

TAKE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --take) [ $# -ge 2 ] || { echo "update: --take needs a path"; exit 2; }
            TAKE="$TAKE
$2"; shift 2 ;;
    *) echo "update: unknown option $1"; exit 2 ;;
  esac
done

if [ -z "$TEMPLATE" ]; then
  TEMPLATE=$(gh repo view --json templateRepository \
    --jq '.templateRepository | select(.) | .owner.login + "/" + .name' 2>/dev/null)
fi
if [ -z "$TEMPLATE" ]; then
  echo "update: could not tell which template this repo came from. Run it as: CRM_KIT_TEMPLATE=<owner>/<name> sh scripts/update_from_template.sh"
  exit 2
fi
case "$TEMPLATE" in
  */*) [ -d "$TEMPLATE" ] || case "$TEMPLATE" in *://*|git@*) ;; *) TEMPLATE="https://github.com/$TEMPLATE.git" ;; esac ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "update: there are uncommitted changes. Commit or put them aside first, then run this again. Nothing was changed."
  exit 2
fi

if ! git fetch -q --no-tags "$TEMPLATE" "+$REF:$TREF" 2>/dev/null; then
  echo "update: could not fetch the template from $TEMPLATE ($REF). Nothing was changed."
  exit 1
fi
T=$(git rev-parse "$TREF^{commit}")

BASE=""
if [ -f "$RECORD" ]; then
  BASE=$(tr -d ' \n' < "$RECORD")
  git cat-file -e "$BASE^{commit}" 2>/dev/null || BASE=""
fi
[ "$BASE" = "$T" ] && { echo "update: already up to date with the template."; exit 0; }

blob() { git rev-parse -q --verify "$1:$2" 2>/dev/null || echo none; }
taken() { printf '%s\n' "$TAKE" | grep -qxF "$1"; }

# Files the template changed: since BASE, or (first run) where it differs from ours.
FROM="${BASE:-HEAD}"
CHANGED=$(git diff --name-only --no-renames "$FROM" "$T" -- $PATHS)
[ -z "$CHANGED" ] && { echo "update: nothing to take under .claude/skills/, scripts/ or docs/."; printf '%s\n' "$T" > "$RECORD"; exit 0; }

APPLY=""
CONFLICT=""
for f in $CHANGED; do
  ours=$(blob HEAD "$f"); theirs=$(blob "$T" "$f")
  [ "$ours" = "$theirs" ] && continue
  if [ -n "$BASE" ]; then base=$(blob "$BASE" "$f"); else base=none; fi
  if taken "$f"; then APPLY="$APPLY $f"
  elif [ "$ours" = "$base" ] || { [ -z "$BASE" ] && [ "$ours" = none ]; }; then APPLY="$APPLY $f"
  else CONFLICT="$CONFLICT $f"
  fi
done

if [ -z "$APPLY" ] && [ -z "$CONFLICT" ]; then
  echo "update: you already have everything the template changed."
  printf '%s\n' "$T" > "$RECORD"; exit 0
fi

if [ -n "$APPLY" ]; then
  echo "== The template changed these, and your team has not:"
  git --no-pager diff --stat HEAD "$T" -- $APPLY
  git --no-pager diff HEAD "$T" -- $APPLY
fi
if [ -n "$CONFLICT" ]; then
  echo "== Your team changed, removed or renamed these, and so did the template. Yours are kept:"
  for f in $CONFLICT; do echo "  $f"; done
  echo "   To see the template's version: git diff HEAD $T -- <path>"
  echo "   To take it instead: sh scripts/update_from_template.sh --take <path>"
fi
[ -z "$APPLY" ] && { echo "update: nothing to apply without a --take. Nothing was changed."; exit 0; }

printf 'Apply the changes above? Type yes to apply: '
answer=""
read -r answer || answer=""
case "$answer" in
  y|Y|yes|Yes|YES) ;;
  *) echo; echo "update: not applied. Nothing was changed."; exit 1 ;;
esac

for f in $APPLY; do
  if [ "$(blob "$T" "$f")" = none ]; then
    git rm -q -- "$f"
  else
    mkdir -p "$(dirname "$f")"
    git show "$T:$f" > "$f"
    case "$f" in *.sh) chmod +x "$f" ;; esac
    git add -- "$f"
  fi
done
printf '%s\n' "$T" > "$RECORD"
git add -- "$RECORD"
echo "update: applied. Look it over with git diff --cached, run python3 scripts/check.py, then commit and push."
exit 0
