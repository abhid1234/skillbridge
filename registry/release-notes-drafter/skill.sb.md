---
name: release-notes-drafter
description: Drafts user-facing release notes for a version from the merged PRs and commits since the last tag, grouped by theme and written for end users (not engineers). Use when cutting a release, tagging a version, or asked to write the "what's new" notes.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [release, changelog, communication, git]
targets:
  claude-code:
    frontmatter:
      model: inherit
      allowed-tools: "Read, Grep, Glob, Bash(git log*), Bash(git tag*), Bash(git diff*)"
---

# Release Notes Drafter

Write release notes a *user* wants to read — outcomes and benefits, not commit hashes.

## Steps
1. Find the range. `git describe --tags --abbrev=0` for the last tag, then `git log <lastTag>..HEAD --oneline` for what's new.
2. Bucket each change into user-facing themes: **New**, **Improved**, **Fixed**, **Deprecated/Breaking**. Drop pure-internal commits (chore, ci, refactor with no user effect) from the public notes.
3. Rewrite each line from the user's POV: lead with the benefit ("Search is now 3× faster"), not the mechanism. One line per change; merge duplicates.
4. Determine the version bump from the changes (semver): breaking → major, new feature → minor, fixes only → patch. Recommend it.
5. Lead with a one-paragraph headline of the release's theme. Put **Breaking changes** with migration steps at the top if any exist.

## Output
Markdown release notes ready to paste into a GitHub Release or `CHANGELOG.md`, plus the recommended version number.

## Notes
- This skill uses a `targets.claude-code.frontmatter` override to pin `model: inherit` and a tight `allowed-tools` allowlist (read-only + git history) on Claude Code. Antigravity and Codex carry only `name` + `description` (those fields aren't representable there) — the override is logged as dropped for them, which is expected.
