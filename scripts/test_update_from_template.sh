#!/bin/sh
# Tests for scripts/update_from_template.sh, against throwaway repos in a temp folder.
#   sh scripts/test_update_from_template.sh
SCRIPT="$(cd "$(dirname "$0")" && pwd)/update_from_template.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
g() { git -c user.name=t -c user.email=t@example.org "$@"; }

# The template: one skill, one script.
T="$WORK/template"; mkdir -p "$T/.claude/skills/crm-sync" "$T/scripts"
( cd "$T" && git init -q -b main \
  && echo "sync v1" > .claude/skills/crm-sync/SKILL.md \
  && echo "tool v1" > scripts/tool.sh \
  && g add -A && g commit -qm v1 )

V1=$(cd "$T" && git rev-parse HEAD)
# A team repo made from the template at v1, with v1 recorded as last taken.
fresh_team() {
  rm -rf "$WORK/team"; mkdir -p "$WORK/team"
  ( cd "$T" && git archive "$V1" ) | ( cd "$WORK/team" && tar -xf - )
  ( cd "$WORK/team" && echo "$V1" > .template-version && git init -q -b main \
    && g add -A && g commit -qm start )
}
run() { ( cd "$WORK/team" && CRM_KIT_TEMPLATE="$T" sh "$SCRIPT" "$@" ) ; }

# The template moves on.
( cd "$T" && echo "sync v2" > .claude/skills/crm-sync/SKILL.md && echo "tool v2" > scripts/tool.sh \
  && g commit -qam v2 )

# 1. A dirty tree is refused, and nothing changes.
fresh_team
echo "local edit" >> "$WORK/team/scripts/tool.sh"
out=$(run </dev/null 2>&1); code=$?
[ $code -eq 2 ] && echo "$out" | grep -q "uncommitted" && grep -q "tool v1" "$WORK/team/scripts/tool.sh" \
  && ok "dirty tree refused" || bad "dirty tree refused ($code: $out)"

# 2. No answer applies nothing.
fresh_team
out=$(run </dev/null 2>&1); code=$?
[ $code -eq 1 ] && grep -q "sync v1" "$WORK/team/.claude/skills/crm-sync/SKILL.md" \
  && [ -z "$(cd "$WORK/team" && git status --porcelain)" ] \
  && ok "no answer applies nothing" || bad "no answer applies nothing ($code)"

# 3. Any answer but yes applies nothing.
out=$(echo "no" | run 2>&1); code=$?
[ $code -eq 1 ] && grep -q "tool v1" "$WORK/team/scripts/tool.sh" \
  && ok "no applies nothing" || bad "no applies nothing ($code)"

# 4. Yes applies the diff and records the template commit.
out=$(echo "yes" | run 2>&1); code=$?
tsha=$(cd "$T" && git rev-parse HEAD)
[ $code -eq 0 ] && grep -q "sync v2" "$WORK/team/.claude/skills/crm-sync/SKILL.md" \
  && grep -q "tool v2" "$WORK/team/scripts/tool.sh" \
  && [ "$(cat "$WORK/team/.template-version")" = "$tsha" ] \
  && ok "yes applies the diff" || bad "yes applies the diff ($code: $out)"

# 5. A file the team edited keeps the team's version and is listed.
fresh_team
( cd "$WORK/team" && echo "ours" > scripts/tool.sh && g commit -qam edit )
out=$(echo "yes" | run 2>&1); code=$?
[ $code -eq 0 ] && grep -q "^ours$" "$WORK/team/scripts/tool.sh" && echo "$out" | grep -q "scripts/tool.sh" \
  && grep -q "sync v2" "$WORK/team/.claude/skills/crm-sync/SKILL.md" \
  && ok "edited file kept, listed as a conflict" || bad "edited file kept ($code: $out)"

# 6. A renamed skill is not brought back.
fresh_team
( cd "$WORK/team" && git mv .claude/skills/crm-sync .claude/skills/our-sync && g commit -qm rename )
out=$(echo "yes" | run 2>&1)
[ ! -e "$WORK/team/.claude/skills/crm-sync/SKILL.md" ] && echo "$out" | grep -q "crm-sync" \
  && ok "renamed skill kept as theirs" || bad "renamed skill kept ($out)"

# 7. --take takes the template's version of a conflicted file.
fresh_team
( cd "$WORK/team" && echo "ours" > scripts/tool.sh && g commit -qam edit )
out=$(echo "yes" | run --take scripts/tool.sh 2>&1)
grep -q "tool v2" "$WORK/team/scripts/tool.sh" && ok "--take takes the template" || bad "--take ($out)"

[ $fail -eq 0 ] && echo "ALL PASSED" || echo "FAILED"
exit $fail
