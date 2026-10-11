#!/bin/sh
# Copies the plugin into a desktop Code session's mods folder, where the
# session hot-reloads it once the person has enabled hot reloading for that
# session (docs/dev-plan.md, 加载方式 › 桌面端后备). Run again after each change:
# the session reloads the mod when the turn that copied it ends.
#
# sh tools/sync-desktop.sh <session id>
set -eu
cd "$(dirname "$0")/.."
SESSION="${1:?usage: sh tools/sync-desktop.sh <session id>}"
TO="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/dev-mods/$SESSION/work-with-english"
mkdir -p "$TO"
# Not the tests, nor what Claude Code writes beside the copy (its types, the editor's tsconfig)
rsync -a --delete \
  --exclude tests/ --exclude .claude-plugin/types/ --exclude tsconfig.json --exclude .DS_Store \
  plugins/work-with-english/ "$TO/"
echo "Copied to $TO"
