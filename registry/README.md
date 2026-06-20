# SkillBridge Skill Registry

These are **portable agent skills**. Each one is authored once as a single `skill.sb.md` (the SkillBridge format defined in [`../docs/spec.md`](../docs/spec.md)) and converts — unchanged — into the native skill files for **Claude Code**, **Antigravity**, and **Codex**. Write the skill once; run it on every harness. Skills that use only the portable core (`name` + `description` + a Markdown body) convert losslessly; skills that opt into capability gating, MCP servers, or a per-target override convert best-effort, and the converter *warns* on anything a given harness can't represent (gating lives in different homes per harness, model pinning is Claude-only, etc.) — honesty about that loss is the point.

## How to use

```sh
# Validate a skill
skillbridge validate registry/<name>

# Convert a skill to one harness (claude-code | antigravity | codex)…
skillbridge convert registry/<name> --to <harness>

# …or all three at once, into an output directory
skillbridge convert registry/<name> --to all --out ./out/<name>
```

Claude Code skills land in `.claude/skills/<name>/`; Antigravity and Codex share `.agents/skills/<name>/`. Declared MCP servers are written to each harness's native config (`.mcp.json` / `mcp_config.json` / `config.toml`).

## Search & tags

Every skill carries a `keywords:` list in its frontmatter (e.g. `git`, `mcp`, `security`) and is automatically tagged with the **format surface it exercises** — one or more of `core`, `tools`, `mcp-stdio`, `mcp-http`, `agents`, `target-override`. Those tags are derived from the frontmatter by the playground bundle generator (`packages/cli/scripts/gen-registry.mjs`), which emits `web/registry.gen.js` as `{ name, description, keywords, exercises, content }` per skill. The web playground renders both `keywords` and `exercises` as filter chips so you can narrow the gallery to, say, only the MCP examples or only the lossless core skills. The `Exercises` column in the catalog below mirrors those tags.

## Catalog

| Skill | Description | Exercises | Converts to |
|---|---|---|---|
| `regex-builder` | Build, explain, and test a regex from plain language. | core | ✓ cc · ✓ ag · ✓ cx |
| `sql-explainer` | Explain a SQL query and flag perf/safety issues. | core | ✓ cc · ✓ ag · ✓ cx |
| `markdown-table-formatter` | Clean up / align Markdown tables; CSV→MD. | core | ✓ cc · ✓ ag · ✓ cx |
| `error-log-summarizer` | Condense a noisy log/trace to root cause + next step. | core | ✓ cc · ✓ ag · ✓ cx |
| `conventional-commit-writer` | Write a Conventional Commits message for the staged diff. | tools (fs read, shell list) | ✓ cc · ✓ ag · ✓ cx |
| `dependency-bump-checker` | Audit deps for outdated/vulnerable packages + upgrade plan. | tools (fs read, shell + network lists) | ✓ cc · ✓ ag · ✓ cx |
| `env-var-auditor` | Reconcile referenced env vars vs `.env.example`; find leaked secrets. | tools (fs read, shell list) | ✓ cc · ✓ ag · ✓ cx |
| `test-failure-triager` | Run tests, cluster failures, separate regressions from flakes. | tools (fs read, shell list) | ✓ cc · ✓ ag · ✓ cx |
| `pr-description-drafter` | Draft a PR description from the diff; open it via GitHub MCP. | mcp-stdio | ✓ cc · ✓ ag · ✓ cx |
| `db-schema-explorer` | Explore a Postgres schema via a read-only Postgres MCP. | tools (mcp gate) + mcp-stdio | ✓ cc · ✓ ag · ✓ cx |
| `design-token-sync` | Pull Figma tokens via HTTP MCP and reconcile against code. | tools (mcp gate) + mcp-http | ✓ cc · ✓ ag · ✓ cx |
| `release-notes-drafter` | Draft user-facing release notes from commits since last tag. | target-override (claude-code: `model` + `allowed-tools`) | ✓ cc · ✓ ag · ✓ cx |
| `changelog-generator` | Generate/update a Keep-a-Changelog `CHANGELOG.md` from commits. | tools (fs write, shell list) | ✓ cc · ✓ ag · ✓ cx |
| `api-endpoint-scaffolder` | Scaffold a new API endpoint matching project conventions. | core | ✓ cc · ✓ ag · ✓ cx |

**Legend** — Exercises: `core` (lossless `name`+`description`+body) · `tools` (capability/permission gating) · `mcp-stdio` / `mcp-http` (declared MCP server transport) · `target-override` (per-harness frontmatter passthrough). Converts to: `cc` = Claude Code, `ag` = Antigravity, `cx` = Codex.

All skills above ship across the format's surface: 5 core-only skills (`regex-builder`, `sql-explainer`, `markdown-table-formatter`, `error-log-summarizer`, `api-endpoint-scaffolder`), 5 with a `tools` block, 3 declaring an MCP server (2 stdio + 1 HTTP), and 1 using a `targets.claude-code.frontmatter` override. Every skill validates with **zero errors** and converts to all three harnesses (the only output is expected lossy *warnings* — e.g. tool-gating becomes a setup note for Antigravity/Codex, `network` is dropped for Claude Code, and the Claude-only override is dropped for the other two).

## Contributing a skill

Skills usually start life inside a real project. The fastest path is to **adopt** them out of an existing repo (`skillbridge adopt <repo> --out /tmp/adopted` — see [`../docs/adopt.md`](../docs/adopt.md)), then upstream the unified source here. The full flow:

1. Place the source at `registry/<name>/skill.sb.md` — the directory name must equal the frontmatter `name` (lowercase kebab-case). Include any referenced `scripts/`, `agents/`, or resource files.
2. Add metadata that powers search and the chips: `spec_version: "0.1"`, `version`, `license`, and a `keywords:` list. (You do **not** hand-write the `exercises` tags — they're derived from your frontmatter.)
3. Replace any real secrets with `${ENV_VAR}` placeholders.
4. `skillbridge validate registry/<name>` → **zero errors**.
5. `skillbridge convert registry/<name> --to all` → succeeds; lossy *warnings* are expected and fine.
6. Regenerate the playground bundle: `node packages/cli/scripts/gen-registry.mjs` (updates `web/registry.gen.js`).
7. Add a catalog row above (Skill · Description · Exercises · Converts to) and open a PR with the [registry-skill template](../.github/PULL_REQUEST_TEMPLATE/registry-skill.md).

CI ([`.github/workflows/validate-registry.yml`](../.github/workflows/validate-registry.yml)) runs validate + convert on every `registry/*/` and **fails only on conversion errors, not on lossy warnings** — and checks that `web/registry.gen.js` was regenerated.
