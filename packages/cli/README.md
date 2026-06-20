# skillbridge

Write an agent skill once, run it on any agent. `skillbridge` converts a portable
[`skill.sb.md`](../../docs/spec.md) into the native files that **Antigravity**,
**Claude Code**, and **Codex** expect — so the same skill runs unchanged across harnesses.

**Zero runtime dependencies.** Pure Node, no install footprint beyond the package itself.

## Install

```bash
npm install -g @avee1234/skillbridge   # then run as `skillbridge`
# or one-shot, no install:  npx @avee1234/skillbridge convert ./my-skill --to all
```

## Usage

```bash
# Convert a skill to all three harnesses, into ./build
skillbridge convert ./examples/commit-helper --to all --out ./build

# Convert to a subset
skillbridge convert ./my-skill --to claude-code,codex

# Validate a skill without converting
skillbridge validate ./my-skill
```

### What it emits

| Target | Skill file | MCP config |
|--------|-----------|------------|
| `claude-code` | `.claude/skills/<name>/SKILL.md` | `.mcp.json` |
| `antigravity` | `.agents/skills/<name>/SKILL.md` | `mcp_config.json` |
| `codex` | `.agents/skills/<name>/SKILL.md` | `config.toml` |

Bundled `scripts/`, `references/`, and `assets/` dirs are copied into each emitted
skill directory. Every lossy mapping (tool gating that can't live in the skill file,
HTTP-MCP field renames, dropped Claude-only fields) is reported as a warning — never
silent. See [`docs/spec.md`](../../docs/spec.md) §4–§7 for the full mapping tables.

## Develop

```bash
npm install     # installs typescript (dev only)
npm run build   # tsc → dist/
npm test        # build + node:test
```

## License

Apache-2.0
