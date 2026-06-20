# CI and Git hooks

SkillBridge generates native skill files (Claude Code, Codex, Antigravity, ...)
from your portable `skill.sb.md` sources. The generated files are committed to
your repo so consumers can use them without running the tool. That only works
if the committed outputs stay in sync with their sources.

`skillbridge check` enforces that: it recomputes the expected outputs for every
skill and compares them, byte for byte, against what's on disk. It exits `0`
when everything matches and non-zero when anything is missing or stale.
`skillbridge sync` regenerates the outputs to fix the drift.

This doc wires `check` into two places: a local pre-commit hook (fast feedback,
before you commit) and a GitHub Action (the backstop, on every push and PR).

## Prerequisites

- A `skillbridge.json` at your repo root. Create one with `npx @avee1234/skillbridge init`
  and commit it.
- Node.js 22+ available locally and in CI.

## Local pre-commit hook

The hook lives at `scripts/pre-commit.sh`. It runs `skillbridge check` and, on
drift, prints `run skillbridge sync and stage the result` and aborts the commit.

Install it with `core.hooksPath` — this points Git at a tracked directory of
hooks instead of the untracked `.git/hooks/`, so the hook ships with the repo
and every clone gets it after one `git config` line:

```sh
chmod +x scripts/pre-commit.sh
git config core.hooksPath scripts
```

Git looks for a hook named exactly `pre-commit` in that directory. If you keep
other scripts under `scripts/`, point `core.hooksPath` at a dedicated folder
instead so unrelated scripts aren't treated as hooks:

```sh
mkdir -p .githooks
cp scripts/pre-commit.sh .githooks/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

To run the same check by hand at any time:

```sh
sh scripts/pre-commit.sh
```

To bypass the hook for a single commit (e.g. a work-in-progress commit you'll
fix up later), use `git commit --no-verify`. Don't make a habit of it — CI will
still catch the drift.

### How the hook resolves the CLI

The hook prefers a project-local `node_modules/.bin/skillbridge` (so it uses the
version you pinned in `package.json`) and falls back to `npx --yes skillbridge`
when there's no local install. Both invocations are static; the hook never
interpolates filenames or other input into the command.

## GitHub Action

Copy `.github/workflows/skillbridge-check.yml` into your repo's
`.github/workflows/` directory. It checks out the repo, sets up Node 22, and
runs `npx --yes skillbridge@latest check` at the repo root. The job fails when
`check` exits non-zero, i.e. when committed outputs have drifted.

```yaml
name: skillbridge-check

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npx --yes skillbridge@latest check
```

Notes:

- Pin the version (e.g. `skillbridge@0.1.0`) once you've adopted it, so CI
  results stay reproducible across releases.
- The workflow requests only `contents: read` and uses no untrusted
  interpolation, so it's safe to run on pull requests from forks.
- This is intentionally separate from the repo's own `test.yml` /
  `validate-registry.yml`; consumers copy only the file they need.

## Fixing a failure

When either the hook or the Action reports drift:

```sh
skillbridge sync     # regenerate native files from sources
git add -A           # stage the regenerated files
git commit           # re-run; the check now passes
```
