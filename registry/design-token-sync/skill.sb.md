---
name: design-token-sync
description: Pulls design tokens (colors, type scale, spacing) from a Figma file via the Figma MCP and reconciles them against the codebase's token definitions. Use when the user asks to sync design tokens, check if the code matches the design file, or import variables from Figma.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [design, figma, tokens, mcp, frontend]
tools:
  filesystem: read
  mcp:
    - "figma"
mcp:
  figma:
    url: "https://mcp.figma.com/mcp"
    headers:
      Authorization: "Bearer ${FIGMA_TOKEN}"
---

# Design Token Sync

Reconcile a Figma file's design tokens against the tokens defined in code, and report drift.

## Steps
1. Read the design source. Use the `figma` MCP (HTTP) to fetch published variables / styles from the target file: color tokens, type scale, spacing scale, radii, and shadows.
2. Read the code source. Locate the token definitions in the repo — common homes: `tokens.json`, `theme.ts`/`theme.js`, Tailwind `theme.extend`, or CSS custom properties in `:root`.
3. Normalize both sides to a common shape: `name → value` (resolve hex/rgb, px/rem). Map naming conventions across the two (e.g. Figma `Primary/500` vs CSS `--color-primary-500`).
4. Diff: tokens present in Figma but missing in code (need adding), present in code but not Figma (stale), and present in both but with mismatched values (drift — the highest-priority finding).
5. Propose the edits to bring code into line with the design source. Show them; do not write files without approval.

## Output
A drift table — `token | figma | code | status` — and a proposed patch. State which file is the source of truth (Figma) for each conflict.

## Notes
- The `figma` MCP is an **HTTP** server (`url` + bearer `headers`). The converter renames/maps the URL and auth per harness (`type:http` for Claude Code, `serverUrl` for Antigravity, `bearer_token_env_var` for Codex). Provide `FIGMA_TOKEN` in the environment.
