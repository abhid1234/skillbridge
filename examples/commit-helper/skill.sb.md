---
name: commit-helper
description: Writes a clear, conventional-commits message for the current staged git diff. Use when the user asks to commit, write a commit message, or save my work.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [git, commits, productivity]
mcp:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
targets:
  claude-code:
    frontmatter:
      allowed-tools: "Bash(git diff*), Bash(git status*), Bash(git log*)"
---

# Commit Helper

Generate a Conventional Commits message for what is currently staged.

## Steps
1. Run `git diff --staged` to see the staged changes. If nothing is staged, say so and stop.
2. Run `git log -5 --oneline` to match the repo's existing message style.
3. Draft a message: `<type>(<scope>): <summary>` where type ∈ feat|fix|docs|refactor|test|chore.
   - Summary ≤ 72 chars, imperative mood.
   - Add a body only if the change needs explanation.
4. Show the message to the user. Do **not** commit until they approve.

## References
- See `references/conventional-commits.md` for the full type list and examples.
