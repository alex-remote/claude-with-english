#!/bin/sh
# D9 (docs/dev-plan.md): carries what the development copy (work-with-english@inline)
# gathered over to the installed one (work-with-english@work-with-english): the
# word book, the statistics, the caches, and the settings. Run it once, after
# installing and before the installed copy's first session.
#
# The data directory is copied as it is. The settings live in the development
# copy's $.store file; they are written as the installed copy's store backup,
# which its first session restores into its own, empty store
# (services/storeBackup.ts).
#
# sh tools/migrate-dev-data.sh [--force]   (--force: copy over a data directory already there)
set -eu
PLUGINS="${CLAUDE_CODE_PLUGIN_CACHE_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins}"
FROM="$PLUGINS/data/work-with-english-inline"
TO="$PLUGINS/data/work-with-english-work-with-english"
FORCE="${1:-}"

if [ ! -d "$FROM" ]; then
  echo "Nothing to carry over: $FROM is not there."
  exit 1
fi
if [ -d "$TO" ] && [ -n "$(ls -A "$TO" 2>/dev/null)" ] && [ "$FORCE" != "--force" ]; then
  echo "$TO has data already. Run again with --force to copy over it."
  exit 1
fi
if ls "$PLUGINS"/store/work-with-english_work-with-english-*.json >/dev/null 2>&1; then
  echo "Note: the installed copy has a store of its own, so it will keep its settings and not restore these."
fi

mkdir -p "$TO"
cp -R "$FROM"/. "$TO"/

# The newest store file of the development copy
STORE=$(ls -t "$PLUGINS"/store/work-with-english_inline-*.json 2>/dev/null | head -n 1 || true)
if [ -n "$STORE" ]; then
  python3 - "$STORE" "$TO/backup/store.json" <<'PY'
import datetime
import json
import os
import sys

with open(sys.argv[1]) as f:
    store = json.load(f)
# reply-cache is an early version's; replies are cached in files now
entries = {key: value for key, value in store.items() if key != 'reply-cache'}
os.makedirs(os.path.dirname(sys.argv[2]), exist_ok=True)
with open(sys.argv[2], 'w') as f:
    json.dump({'v': 1, 'date': datetime.date.today().isoformat(), 'entries': entries}, f, ensure_ascii=False)
print(f'{len(entries)} settings and flags carried over')
PY
else
  echo "No store file of the development copy: the settings stay at their defaults."
fi
echo "Copied $FROM to $TO."
