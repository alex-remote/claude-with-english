#!/bin/sh
# Every check a task must pass before it is done (docs/dev-plan.md, 工程地基).
# Run from anywhere: sh tools/check.sh
set -eu
cd "$(dirname "$0")/.."
PLUGIN=plugins/work-with-english
TSC="npx -y -p typescript@5.9 tsc"

echo "1/5 validate --strict"
claude plugin validate --strict "$PLUGIN"

echo "2/5 every gating hook has a .catch"
claude plugin validate --json "$PLUGIN" | python3 -c '
import json, sys
report = json.load(sys.stdin)
parts = [report.get("manifest", {})] + report.get("contents", [])
bare = [g for p in parts for g in p.get("gatingHooks", []) if not g.get("hasCatch")]
if bare:
    sys.exit("gating hooks without .catch: %s" % bare)
'

echo "3/5 tsc against the types this machine last laid"
if [ -d "$PLUGIN/.claude-plugin/types" ]; then
  $TSC -p "$PLUGIN"
else
  echo "    skipped: $PLUGIN/.claude-plugin/types is laid on the first --plugin-dir load"
fi

echo "4/5 tsc against the 2.1.288 snapshot"
$TSC -p tools/tsconfig.288.json

echo "5/5 claude plugin test"
claude plugin test "$PLUGIN"

echo "All checks passed."
