#!/bin/sh
# Runs when Claude Code opens this folder: get everyone's latest work and
# skills, turn on the commit check, report anything not yet shared, and say
# when the teammate is not signed in to the hub.
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
git config core.hooksPath .githooks
if git pull --rebase --autostash -q 2>/dev/null; then
  echo "crm-kit: up to date with the team."
else
  echo "crm-kit: could not pull the latest from GitHub. Tell the person and fix it before adding anything."
fi
unshared=$(git status --porcelain 2>/dev/null)
unpushed=$(git log --oneline @{u}.. 2>/dev/null)
if [ -n "$unshared" ] || [ -n "$unpushed" ]; then
  echo "crm-kit: work on this machine the team cannot see yet:"
  [ -n "$unshared" ] && echo "$unshared"
  [ -n "$unpushed" ] && echo "$unpushed"
  echo "Offer to check, commit and push it."
fi
python3 scripts/hub.py whoami >/dev/null 2>&1 || echo "crm-kit: not signed in to the hub. Type: ! python3 scripts/hub.py login"
exit 0
