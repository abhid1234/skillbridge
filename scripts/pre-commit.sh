#!/bin/sh
# SkillBridge pre-commit hook.
#
# Fails the commit when the generated native skill files have drifted from
# their SkillBridge sources, so you never commit a source change without the
# regenerated outputs alongside it.
#
# Install (from the repo root):
#   chmod +x scripts/pre-commit.sh
#   git config core.hooksPath scripts
# See docs/ci-and-hooks.md for details and alternatives.
#
# Portable POSIX sh: no bashisms, works under the minimal shell Git invokes.

set -eu

# Resolve the CLI. Prefer a project-local binary (node_modules/.bin/skillbridge)
# so the hook uses the pinned version; otherwise fall back to npx, which fetches
# it on demand. Either way the command itself is static.
if [ -x "node_modules/.bin/skillbridge" ]; then
  SKILLBRIDGE="node_modules/.bin/skillbridge"
  run_check() { "$SKILLBRIDGE" check; }
else
  run_check() { npx --yes skillbridge check; }
fi

if run_check; then
  exit 0
fi

# Non-zero from the check means drift (or a config/validation error). Tell the
# committer exactly how to recover, then abort the commit.
echo >&2
echo "skillbridge: generated files are out of sync with your skill sources." >&2
echo "run skillbridge sync and stage the result" >&2
exit 1
