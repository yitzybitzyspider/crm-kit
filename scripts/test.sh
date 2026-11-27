#!/bin/sh
# The one test command for this repo. Runs every scripts/test_*.py, then the checker.
cd "$(dirname "$0")/.." || exit 1
status=0
for t in scripts/test_*.py; do
  echo "== $t"
  python3 "$t" || status=1
done
echo "== scripts/check.py"
python3 scripts/check.py || status=1
[ "$status" -eq 0 ] && echo "ALL PASSED" || echo "FAILED"
exit $status
