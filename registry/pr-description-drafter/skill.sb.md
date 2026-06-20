---
name: pr-description-drafter
description: Drafts a structured pull-request description from the branch diff and commit history, and can open the PR via the GitHub MCP. Use when the user asks to write a PR description, open a pull request, or summarize a branch for review.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [github, pull-request, git, review]
mcp:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
---

# PR Description Drafter

Produce a reviewer-friendly PR description grounded in the actual diff, then optionally open the PR.

## Steps
1. Determine the base and head branches. Run `git log <base>..HEAD --oneline` and `git diff <base>...HEAD --stat` to scope the change.
2. Synthesize the summary from the commits and the file-level diff — what changed and *why*, in the author's intent, not a file listing.
3. Fill this template:
   - **What** — 1–3 sentences.
   - **Why** — the motivating problem or ticket.
   - **Changes** — bulleted, grouped by area.
   - **Testing** — how it was verified (tests added/run, manual steps).
   - **Risk / rollback** — blast radius and how to revert.
   - **Screenshots** — placeholder if UI-facing.
4. Generate a Conventional-Commits-style PR title.
5. Show the draft for approval. On approval, open the PR with the GitHub MCP (`github` server) against the correct base, attaching the title and body.

## Notes
- The `github` MCP server is declared in frontmatter and emitted per harness (`.mcp.json` / `mcp_config.json` / `config.toml`). It needs `GITHUB_TOKEN` in the environment — the converter passes the `${GITHUB_TOKEN}` placeholder through; the user supplies the value.
