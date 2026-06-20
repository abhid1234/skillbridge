#!/usr/bin/env bash
# Mechanical pre-review lint: surface obvious smells so the review can focus on logic.
# Read-only — never modifies files. Exits 0 even on findings (advisory, not a gate).
set -euo pipefail

target="${1:-.}"

echo "lint: scanning ${target}"

# Lines that almost always warrant a second look in a review.
patterns='TODO|FIXME|XXX|console\.log|debugger|\.only\(|print\(\s*$'

# Only inspect text files that git is tracking under the target path.
files=$(git ls-files -- "${target}" 2>/dev/null || true)
if [ -z "${files}" ]; then
  echo "lint: no tracked files under ${target}"
  exit 0
fi

found=0
while IFS= read -r f; do
  [ -f "${f}" ] || continue
  if grep -nED "${patterns}" "${f}" >/dev/null 2>&1; then
    echo "--- ${f}"
    grep -nED "${patterns}" "${f}" || true
    found=1
  fi
done <<< "${files}"

if [ "${found}" -eq 0 ]; then
  echo "lint: clean"
fi
exit 0
