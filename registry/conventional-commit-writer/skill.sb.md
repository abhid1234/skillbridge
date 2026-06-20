---
name: conventional-commit-writer
description: Writes a Conventional Commits message for the currently staged git diff. Use when the user asks to commit, write a commit message, or "save my work". Does not commit until approved.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [git, commits, conventional-commits, productivity]
tools:
  filesystem: read
  shell:
    - "git "
---

# Conventional Commit Writer

Generate a Conventional Commits message describing exactly what is staged.

## Steps
1. Run `git diff --staged --stat` then `git diff --staged` to see the staged changes. If nothing is staged, say so and stop — do not stage anything yourself.
2. Run `git log -10 --oneline` to match the repo's existing scope names and style.
3. Pick the type: `feat` | `fix` | `docs` | `style` | `refactor` | `perf` | `test` | `build` | `ci` | `chore`. If the diff spans unrelated concerns, recommend splitting into separate commits.
4. Draft `<type>(<scope>): <summary>`:
   - Summary in imperative mood, ≤ 72 chars, no trailing period.
   - Add a body (wrapped at 72 cols) only when the change needs the "why".
   - Add `BREAKING CHANGE:` footer when an API/contract changes.
5. Show the full message. **Do not run `git commit` until the user approves.** When approved, commit with `git commit -m` (multi-line via repeated `-m`).

## Notes
- `tools` gates this skill to read-only filesystem plus `git` shell commands. The user's host still applies its own approvals.
