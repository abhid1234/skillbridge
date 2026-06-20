# Harness Formats — Phase 0 Ground Truth

> **Status:** Phase 0 research output. Field-by-field comparison of the *actual* skill / sub-agent / instruction / MCP formats of the three v1 target harnesses — **Antigravity, Claude Code, Codex** — reverse-engineered from primary sources (official docs + real example repos). This is the empirical ground truth the SkillBridge spec (Phase 1) must be justified against.
>
> **Date:** 2026-06-15. **Caveat:** Antigravity is preview-era and its format is actively shifting (the `.gemini/` → `.agents/` migration landed within the last ~30 days; Gemini CLI for individuals sunsets 2026-06-18). Expect drift — version the spec and re-verify Antigravity before each release.
>
> **Confidence markers:** ✅ confirmed in official docs · 🟡 corroborated by 2+ credible secondary sources · 🔴 single-source / community convention / inferred (do **not** treat as canonical).

---

## TL;DR for the spec

1. **The convergence point is real.** All three harnesses natively support a `SKILL.md` file with **YAML frontmatter (`name` + `description`) + a markdown body**, discovered under a skills directory, with the same progressive-disclosure loading model. This is the [Agent Skills / agentskills.io](https://agentskills.io) open standard. **SkillBridge's portable core should be a strict superset of that minimal `SKILL.md`.** ✅ (all three)
2. **Two things do NOT port cleanly and must be handled per-target:**
   - **Sub-agents** — three incompatible models: Claude Code = markdown file w/ rich YAML frontmatter; Codex = **TOML** file; Antigravity = **runtime-only** (no file at all). There is no common sub-agent file to standardize on.
   - **Tool / permission gating** — Claude Code puts it *in* the skill frontmatter (`allowed-tools`); Antigravity uses a *separate* `action(target)` permission engine and skills carry no tool field; Codex governs it via `config.toml` (`approval_policy` + `sandbox_mode`) + per-MCP allow/deny.
3. **Instruction files split 2-vs-1:** Codex + Antigravity read **`AGENTS.md`** (freeform markdown, no frontmatter); Claude Code reads **`CLAUDE.md`** (also no frontmatter) and does **not** natively read `AGENTS.md`. Interop today = symlink / `@import`.
4. **MCP is conceptually shared but syntactically forked:** all three use a name-keyed server map with stdio (`command`/`args`/`env`) and HTTP transports — but the *file*, *format* (JSON vs TOML), and *field names* (`url` vs `serverUrl`; bearer-token handling) all differ.

---

## Master comparison table (the 8 research dimensions)

| # | Dimension | **Antigravity** | **Claude Code** | **Codex** |
|---|---|---|---|---|
| 1 | **Where skills live** | Project: `.agents/skills/<name>/SKILL.md` ✅ (legacy `.agent/skills` still read). Global: `~/.gemini/config/skills/<name>/` ✅ | Project: `.claude/skills/<name>/SKILL.md` ✅. User: `~/.claude/skills/<name>/` ✅. Loads from start dir up to repo root + nested on demand | Repo: `.agents/skills/<name>/SKILL.md` ✅ (cascading cur/parent/root). User: `~/.agents/skills/`. Admin: `/etc/codex/skills/` ✅ |
| 1 | **Where instructions live** | `AGENTS.md` (+ legacy `GEMINI.md`) at root 🟡; global `~/.gemini/GEMINI.md` ✅; rules `.agents/rules/` ✅ | `CLAUDE.md` (project `./CLAUDE.md` or `./.claude/CLAUDE.md`, user `~/.claude/CLAUDE.md`, enterprise managed) ✅; rules `.claude/rules/` | `AGENTS.md` (root→cwd, per-dir) ✅; global `~/.codex/AGENTS.md` ✅; `.override.md` variants ✅ |
| 1 | **Canonical config file** | **None** — filesystem-native multi-file (`.agents/` + `~/.gemini/`) ✅ | **None** — `.claude/settings.json` (+ `.local`, user, managed) for settings; no single monolith ✅ | **`config.toml`** — strongly typed; `~/.codex/`, repo `.codex/`, `/etc/codex/`; precedence CLI→project→profile→user→system ✅ |
| 2 | **Skill frontmatter schema** | **Only `name` (opt) + `description` (req)** ✅. No `tools`/`model`/`version` in official docs. 🔴 community `tools` field (MCP scoping) exists, unofficial | **Rich, all optional** (only `description` recommended): `name`, `description`, `when_to_use`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`(fork), `agent`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `paths`, `hooks`, `shell` ✅ | **`name` + `description` required** ✅ (same shape as Agent Skills). Optional sibling `agents/openai.yaml` UI config |
| 3 | **Skill body** | Markdown body, progressive disclosure (name/desc → full body on activate); optional `scripts/`/`references/`/`assets/` ✅. No mandated sections | Markdown, progressive disclosure; **≤500 lines guidance** ✅; bundled `references/` loaded on demand, `scripts/` executed not loaded; `${CLAUDE_SKILL_DIR}`, `$ARGUMENTS`, `` !`cmd` `` injection | Markdown + YAML frontmatter; progressive disclosure; optional `scripts/`/`references/`/`assets/` ✅. Skills are workflows Codex follows itself (don't spawn agents) |
| 4 | **Tool declaration / gating** | **Separate permission engine**, NOT in skill file. Resources `action(target)`: `read_file`/`write_file`/`read_url`/`command`/`mcp(server/tool)`/`unsandboxed`; Deny>Ask>Allow ✅ | **In frontmatter:** `allowed-tools` (pre-approve) / `disallowed-tools` (remove). Tool names `Read`,`Bash(git add *)`,`mcp__<server>__<tool>`. Settings `permissions.allow/ask/deny` ✅ | **In `config.toml`:** `approval_policy` (`untrusted`/`on-request`/`never`) + `sandbox_mode` (`read-only`/`workspace-write`/`danger-full-access`); per-MCP `enabled_tools`/`disabled_tools` ✅ |
| 5 | **MCP declaration** | `~/.gemini/config/mcp_config.json`, key `mcpServers` ✅. Per server: `command`+`args`+`env` (stdio) **or** `serverUrl` (HTTP; renamed from `httpUrl`) 🟡; `headers`, `oauth`, `disabled`, `disabledTools` | `.mcp.json` (project, VCS) or `~/.claude.json` (user/local), key `mcpServers` ✅. `type: stdio\|http\|sse(dep)\|ws`; `command`/`args`/`env` or `url`/`headers`; `${VAR}` expansion; scopes local>project>user | `[mcp_servers.<id>]` in `config.toml` (TOML) ✅. stdio: `command`/`args`/`env`. HTTP: `url`+`bearer_token_env_var` (needs `experimental_use_rmcp_client=true`); `enabled_tools`/`disabled_tools`/timeouts |
| 6 | **Sub-agent definition** | **Runtime-only** — tools `define_subagent`/`invoke_subagent`; 3 built-ins (`research`/`browser`/`self`). **No file, no frontmatter schema** ✅. 🔴 community `agents/<name>.md` patterns are unofficial | **Markdown file** `.claude/agents/<name>.md` ✅. Frontmatter: `name`+`description` required; optional `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `isolation`, `color`. Body = system prompt | **TOML file** `.codex/agents/<name>.toml` (or `~/.codex/agents/`) ✅. Required `name`+`description`+`developer_instructions`; optional `model`, `sandbox_mode`, `mcp_servers`, etc. Limits via `[agents]` |
| 6 | **Sub-agent invocation** | NL request + `/browser`; runtime spawn, async/background, reusable ✅ | Auto-delegation (by `description`), NL ("use the X subagent"), `@agent-<name>`, `claude --agent`, programmatic Agent tool ✅ | NL request + `/agent` slash command to manage/switch ✅ |
| 7 | **Required vs optional** | Skill: `SKILL.md` + `description` only. MCP: one of `command`/`serverUrl`. Everything else optional ✅ | Skill: nothing mandatory (`description` recommended). Sub-agent: `name`+`description`. CLAUDE.md: plain md, no required fields. MCP: name + (`command`\|`url`) ✅ | AGENTS.md: nothing. config.toml: nothing (all defaults). Sub-agent: `name`+`description`+`developer_instructions`. Skill: `name`+`description`. MCP: a transport ✅ |
| 8 | **Versioning / stability** | 🔴 **Unstable** — preview-era; `.agent`→`.agents` rename in flight; MCP `httpUrl`→`serverUrl`; SDK still preview (MCP "not yet supported" there); docs list paths reported broken | 🟡 **Stable-ish, evolving** — commands merged into skills; `Task`→`Agent` rename (alias kept); follows agentskills.io; Anthropic ships open spec at `anthropics/skills` | 🟡 **Convention-stable** — AGENTS.md stewarded by Agentic AI Foundation (Linux Foundation); config.toml typed & documented; profiles moved to sibling files; custom prompts deprecated → skills |

---

## The common denominator (what SkillBridge can standardize on)

These map **cleanly across all three** harnesses and form the portable core:

| Portable concept | Antigravity | Claude Code | Codex | Notes |
|---|---|---|---|---|
| **`SKILL.md` file** | ✅ `.agents/skills/` | ✅ `.claude/skills/` | ✅ `.agents/skills/` | Same filename, same idea. Only the *parent dir* differs (Claude uses `.claude/skills`; the other two use `.agents/skills`). |
| **`name` (frontmatter)** | ✅ optional | ✅ optional | ✅ required | Lowercase-hyphenated convention everywhere. Make it **required** in SkillBridge (lossless down-conversion). |
| **`description` (frontmatter)** | ✅ required | ✅ recommended (primary trigger) | ✅ required | The universal activation/trigger signal. Make it **required**. |
| **Markdown instruction body** | ✅ | ✅ | ✅ | Free markdown after frontmatter. |
| **Progressive disclosure** | ✅ | ✅ | ✅ | name/description always in context; body on activation. SkillBridge authors should write to this model. |
| **Bundled resource dirs** | ✅ `scripts/`/`references/`/`assets/` | ✅ `scripts/`/`references/` (+ any) | ✅ `scripts/`/`references/`/`assets/` | Same convention. Keep relative refs from `SKILL.md`. |
| **Instruction/rules file** | ✅ `AGENTS.md`/`GEMINI.md` | ✅ `CLAUDE.md` | ✅ `AGENTS.md` | Plain markdown, no frontmatter anywhere. Portable as a body; the *filename* is the only variable (see lossy notes). |
| **MCP: name-keyed server map** | ✅ `mcpServers{}` | ✅ `mcpServers{}` | ✅ `[mcp_servers.<id>]` | Same shape: server name → {transport, args/env or url}. Conceptually portable; serialization differs (see lossy). |
| **MCP stdio transport** | ✅ `command`+`args`+`env` | ✅ `command`+`args`+`env` | ✅ `command`+`args`+`env` | The stdio triple is identical across all three. |

**Recommendation:** SkillBridge's authoring unit = a `SKILL.md` (required `name` + `description` + markdown body) plus optional `scripts/`/`references/`/`assets/`, optionally pairing an `AGENTS.md`-style instruction body and a name-keyed MCP server map. Everything beyond this is target-specific enrichment that the converter emits per-harness.

---

## Irreconcilable / lossy differences (must document per-target)

### A. Sub-agents — no common file format (highest-severity gap)
| | Antigravity | Claude Code | Codex |
|---|---|---|---|
| Mechanism | **Runtime-only** (`define_subagent`/`invoke_subagent`) | **Markdown file** `.claude/agents/*.md` | **TOML file** `.codex/agents/*.toml` |
| System prompt | runtime arg | markdown body | `developer_instructions` key |
| Lossy direction | A SkillBridge sub-agent **cannot be emitted as a static file** for Antigravity (no file model) — at best documented as a runtime invocation pattern. Claude(md) ↔ Codex(toml) is mechanically convertible but field sets differ. |

**Implication:** v1 should treat sub-agents as **out of the portable core**, or support them only for Claude Code + Codex with an explicit "Antigravity: runtime-only, not emitted" lossy note. (Matches the kickoff's "honesty about lossy conversion is the moat.")

> **Implemented in v0.2:** SkillBridge now ships the `agents:` field (sibling `agents/<name>.sb.md` files) — emitted as `.claude/agents/*.md`, `.codex/agents/*.toml`, `.cursor/agents/*.md`, and an Antigravity `define_subagent` setup note. See `spec.md` §7-bis A.

### B. Tool / permission gating — three different homes
- **Claude Code:** lives *in* the skill (`allowed-tools` / `disallowed-tools`).
- **Antigravity:** lives in a *separate* permission engine (`action(target)`, Deny>Ask>Allow); the skill file has no tool field.
- **Codex:** lives in `config.toml` (`approval_policy` + `sandbox_mode`) and per-MCP allow/deny.

A SkillBridge `tools`/`permissions` block can be **emitted as Claude Code frontmatter**, but for Antigravity it must become permission-engine entries (or a comment, since skills can't carry it), and for Codex it maps onto approval/sandbox + per-MCP lists. **Lossy and asymmetric in all directions.**

### C. Skill frontmatter richness
Claude Code supports ~18 frontmatter fields (`model`, `effort`, `context: fork`, `argument-hint`, `arguments`, `paths`, `hooks`, `disable-model-invocation`, …). Antigravity and Codex officially support **only `name` + `description`**. Any SkillBridge field beyond name/description is **dropped (with a warning)** when targeting Antigravity/Codex. Document the drop list per target.

### D. Instruction-file name + scoping
- Filename: `CLAUDE.md` (Claude) vs `AGENTS.md` (Codex/Antigravity) vs legacy `GEMINI.md`. Claude does **not** read `AGENTS.md` natively → interop via symlink / `@import`.
- Path-scoping: Claude needs a separate `.claude/rules/` with `paths:` glob; Antigravity has rule activation types (Always/Glob/Model-decision/Manual); Codex relies on **positional** nested `AGENTS.md` (the path *is* the scope). Not 1:1.
- Merge semantics differ: Claude concatenates root→cwd (all ancestors); Codex accumulates root→cwd with closest-overrides and a 32 KiB cap; Antigravity rule precedence is list-order Deny>Ask>Allow.

### E. MCP serialization & field names
- Format: JSON (`.mcp.json` Claude / `mcp_config.json` Antigravity) vs **TOML** (`config.toml` Codex).
- HTTP field: Claude `url` + `headers`; Antigravity `serverUrl` (was `httpUrl`); Codex `url` + `bearer_token_env_var` + requires `experimental_use_rmcp_client=true`.
- Transport enum: Claude has `stdio/http/sse(dep)/ws`; others effectively stdio + HTTP.
- Env-var substitution: Claude `${VAR}`/`${VAR:-default}`; Antigravity substitution reportedly broken (hardcode workaround) 🔴.
- **Portable subset = stdio (`command`/`args`/`env`) + a generic HTTP URL.** Everything else is per-target.

### F. Slash commands / argument substitution
Claude Code merged commands into skills (`$ARGUMENTS`/`$N`/`$name`, `disable-model-invocation`). Codex has deprecated custom prompts (`$1`–`$9`/`$ARGUMENTS`) → skills, and Antigravity uses `.agents/workflows/*.md` with `$VARIABLE` + `// turbo`. Convergent direction (everything → skills) but **arg-substitution syntax and the user-vs-model invocation toggles differ** → lossy.

> **Implemented in v0.2:** SkillBridge now ships the `args:` field (`hint`/`spec`/`model_invocable`) — emitted as Claude Code `argument-hint`/`arguments`/`disable-model-invocation`, Cursor `disable-model-invocation`, and warned-and-dropped for Antigravity/Codex. See `spec.md` §7-bis B.

### G. Model / effort selection
Claude Code skills can pin `model` + `effort` in frontmatter. Antigravity/Codex skills cannot (model is chosen at config/runtime). A SkillBridge `model` hint is **Claude-only**, dropped elsewhere.

---

## Per-harness source notes & confidence

### Antigravity (lowest confidence — preview, fast-moving)
- **Official:** `antigravity.google/docs/{skills,rules-workflows,mcp,subagents,permissions}`; `ai.google.dev/gemini-api/docs/antigravity-agent`; Google I/O 2026 posts; `codelabs.developers.google.com/*antigravity*`; official SDK `github.com/google-antigravity/antigravity-sdk-python` (confirms 2-field `SKILL.md` frontmatter verbatim).
- **Key resolved conflict:** global skills dir is `~/.gemini/config/skills/` per official docs ✅ (secondary sources disagreed).
- **Do NOT assert without re-check:** skill `tools` frontmatter (community-only 🔴), any file-based sub-agent schema (official model is runtime-only 🔴), `.antigravity/` dir (community convention 🔴), project-level `.agents/mcp_config.json` (single source 🔴).

### Claude Code (highest confidence)
- **Official:** `code.claude.com/docs/en/{skills,sub-agents,memory,mcp,commands}`; `platform.claude.com/docs/.../agent-skills/overview`; open spec + template at `github.com/anthropics/skills`; `agentskills.io`.
- Fields/paths/constraints are quoted from official docs. Doc-asserted (not spec-file-verified): the 1,536-char description cap and 500-line guidance.
- Note the **commands→skills merge** and **`Task`→`Agent`** rename (alias retained) as recent changes.

### Codex (high confidence, most structured)
- **Official:** `developers.openai.com/codex/{config-reference,config-basic,guides/agents-md,mcp,subagents,skills,custom-prompts}`; `agents.md` + `github.com/agentsmd/agents.md` (AGENTS.md spec, stewarded by Agentic AI Foundation / Linux Foundation); `github.com/openai/codex`.
- In-repo docs are now stub redirects to `developers.openai.com/codex/`.
- **Do NOT rely on without re-check:** literal tool ids `apply_patch`/`update_plan`; `codex mcp list/get/remove`; speculative `[analytics]`/`[feedback]`/`[hooks]` TOML tables; granular-approval sub-keys.

---

## Cursor (4th target — added 2026-06-16) ✅

Cursor **v2.4** (GA 2026-01-22) shipped native **Agent Skills**, making it a clean portable target.

| Concern | Cursor |
|---|---|
| Skills | `.cursor/skills/<name>/SKILL.md` (project) · `~/.cursor/skills/<name>/SKILL.md` (user). Also natively discovers `.agents/skills/` and `.claude/skills/`. ✅ |
| Skill frontmatter | `name` (req, lowercase-hyphen) + `description` (req); optional `paths`, `disable-model-invocation`, `metadata` — same family as agentskills.io. ✅ |
| Body | plain markdown; supports `@file` references. ✅ |
| MCP | `.cursor/mcp.json` (project) / `~/.cursor/mcp.json` (global), root key `mcpServers`. stdio: `command`/`args`/`env`(+`envFile`); remote: `url`/`headers`. **No `type` needed** (inferred). Same root key as Claude's `.mcp.json`. ✅ |
| Legacy rules | `.cursor/rules/*.mdc` (frontmatter `description`/`globs`/`alwaysApply`) — pre-Skills fallback; `name` not representable. |
| Sub-agents | `.cursor/agents/<name>.md` (name/description/model/readonly) — separate file, not part of a portable skill. |
| Instruction file | reads `AGENTS.md` and `CLAUDE.md` natively. |

**Mapping (lossless for the core):** emit `.cursor/skills/<name>/SKILL.md` with `name` + `description` + body verbatim; MCP → `.cursor/mcp.json` (`mcpServers`, omit `type`). Lossy: tool-gating (agent-level, not in the skill file), and Cursor's own `${...}` interpolation vocabulary differs from `${VAR}`. **Sources:** cursor.com/docs/{skills,rules,mcp,subagents}, cursor.com/changelog/2-4.

## Open questions to resolve before/while writing the spec (Phase 1)
1. **Skill dir name:** standardize SkillBridge authoring under `.agents/skills/` (matches 2 of 3, the tool-agnostic namespace) and emit `.claude/skills/` for Claude Code? (Leaning yes.)
2. **Sub-agents in v1 scope?** Recommend deferring to "Claude Code + Codex only, lossy for Antigravity," or excluding from the portable core entirely for v1.
3. **Permissions block:** define a neutral `tools`/`permissions` schema in SkillBridge, or omit and let each target's native mechanism own it? (Leaning: optional neutral block, emit best-effort per target with documented loss.)
4. **Instruction file:** does SkillBridge also own an `AGENTS.md`/`CLAUDE.md` body, or is it skills-only for v1? (Kickoff scope is skills-first.)
5. **MCP:** standardize on the stdio + generic-HTTP subset only, or attempt full per-field mapping? (Leaning: subset for v1.)
