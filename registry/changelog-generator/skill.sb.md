---
name: changelog-generator
description: Generates or updates a Keep a Changelog-style CHANGELOG.md from Conventional Commits since the last release. Use when the user asks to update the changelog, regenerate it, or prepare the Unreleased section before a release.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [changelog, git, conventional-commits, release]
tools:
  filesystem: write
  shell:
    - "git "
---

# Changelog Generator

Maintain a `CHANGELOG.md` in the [Keep a Changelog](https://keepachangelog.com) format, driven by Conventional Commits.

## Steps
1. Find the cutoff: the most recent version heading in `CHANGELOG.md`, or the last git tag if the file is new.
2. Collect commits since the cutoff: `git log <cutoff>..HEAD --pretty=format:'%s'`.
3. Map Conventional Commit types to Keep-a-Changelog sections:
   - `feat` → **Added**
   - `fix` → **Fixed**
   - `perf`/`refactor` (user-visible) → **Changed**
   - `BREAKING CHANGE` / `!` → **Changed** + a bold breaking note
   - `deprecate` → **Deprecated**; removals → **Removed**; security fixes → **Security**
   - Drop `chore`/`ci`/`test`/`docs`(internal) unless user-facing.
4. Write entries under an `## [Unreleased]` heading (or a dated `## [x.y.z] - YYYY-MM-DD` if the user is finalizing a release). Strip the type prefix and scope from each line; phrase as a user-facing change.
5. Keep existing released sections untouched. Only edit `[Unreleased]` / add the new version section. Preserve link-reference definitions at the bottom.

## Output
The updated `CHANGELOG.md` (this skill may write the file — `filesystem: write`). Show a diff of what changed before saving when the file already exists.
