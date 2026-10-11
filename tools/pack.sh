#!/bin/sh
# Packs the plugin for a release (docs/dev-plan.md, 发布): writes
# dist/work-with-english-<version>.zip, the plugin under one top folder,
# without its tests or the types Claude Code lays on each load, and prints
# its sha256. Entries are sorted and dated alike, so a pack of the same files
# gives the same zip. Run from anywhere: sh tools/pack.sh
set -eu
cd "$(dirname "$0")/.."
PLUGIN=plugins/work-with-english
VERSION=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$PLUGIN/.claude-plugin/plugin.json")
NAME="work-with-english-$VERSION"
ZIP="dist/$NAME.zip"
mkdir -p dist
rm -f "$ZIP"

python3 - "$PLUGIN" "$ZIP" <<'PY'
import os
import sys
import zipfile

root, out = sys.argv[1], sys.argv[2]
# Only for developing it: its tests, the engine's types and the editor's tsconfig
LEFT_OUT = {'tests', '.claude-plugin/types', 'tsconfig.json'}
entries = []
for here, dirs, files in os.walk(root):
    rel = os.path.relpath(here, root)
    prefix = '' if rel == '.' else rel + '/'
    dirs[:] = [d for d in dirs if prefix + d not in LEFT_OUT]
    entries += [prefix + f for f in files if prefix + f not in LEFT_OUT and f != '.DS_Store']
with zipfile.ZipFile(out, 'w') as z:
    for entry in sorted(entries):
        info = zipfile.ZipInfo('work-with-english/' + entry, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(os.path.join(root, entry), 'rb') as f:
            z.writestr(info, f.read())
print(f'{len(entries)} files')
PY

# What users install must pass the same check as the source
CHECK="dist/check-$VERSION"
rm -rf "$CHECK"
mkdir -p "$CHECK"
(cd "$CHECK" && unzip -q "../$NAME.zip")
if command -v claude >/dev/null 2>&1; then
  claude plugin validate --strict "$CHECK/work-with-english"
else
  echo "claude is not installed: the zip was not validated"
fi
rm -rf "$CHECK"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ZIP"
else
  shasum -a 256 "$ZIP"
fi
