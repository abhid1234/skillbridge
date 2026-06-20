# SkillBridge Format Specification

**Spec version:** `0.1` (draft) · **Status:** RFC · **Date:** 2026-06-16

SkillBridge is a portable agent-skill format. You write a skill **once** — a single `skill.sb.md` file plus optional bundled resources — and a converter emits the native files each agent harness expects, so the same skill runs unchanged across **Antigravity, Claude Code, Codex, and Cursor**.

This document is the authoritative format reference. After reading it, you should be able to author a valid `skill.sb.md` **by hand**. Every field below traces to real harness behavior documented in [`harness-formats.md`](./harness-formats.md) (Phase 0 ground truth) — nothing here is invented.

> **v0.2 scope note.** The `0.1` spec deferred sub-agents and slash-command arguments to "v2". As of **v0.2** the converter **implements both** — plus skill-level `hooks`, declared `scripts`, and extended `tools` permissions (`approval`/`sandbox`/`paths`) — each emitted best-effort per target with an explicit fate table (§§4.1, 7-bis A-E). The wire `spec_version` string stays `"0.1"` (the *file contract* is unchanged — these are additive, optional fields); the **converter** is the thing that grew. Sections §10 reflects what is now shipped vs still deferred.

---

## 1. Design principles

1. **The portable core is the proven common denominator.** All three harnesses natively support `SKILL.md` = YAML frontmatter (`name` + `description`) + markdown body, under a skills directory, with progressive-disclosure loading ([agentskills.io](https://agentskills.io)). SkillBridge is a **strict superset** of that minimal file. A skill that uses *only* the core converts losslessly to all three.
2. **Enrichment is opt-in and per-target.** Anything beyond the core (tool gating, model pinning, MCP servers, harness-specific frontmatter) is optional and emitted best-effort. Where a target can't represent a field, the converter **drops it and warns** — never silently.
3. **Honesty about loss is the moat.** Every field documents its fate per target (✅ native · ⚠️ approximated · ❌ dropped). The converter must surface every drop.
4. **Vendor-neutral.** No target is privileged. Field names are harness-agnostic; per-target quirks live only in the mapping tables.
5. **One-way for v1.** SkillBridge → harness. Importing native skills *into* SkillBridge is v2.

---

## 2. File layout

A SkillBridge skill is a **directory** named after the skill. The only required file is `skill.sb.md`.

```
my-skill/
├── skill.sb.md          # REQUIRED — frontmatter + body (the skill)
├── scripts/             # optional — executable helpers (copied verbatim, not loaded into context)
├── references/          # optional — markdown loaded on demand by the agent
└── assets/              # optional — images, templates, data files
```

- The directory name SHOULD equal the `name` frontmatter field (lowercase-kebab).
- `.sb.md` distinguishes SkillBridge **source** from the emitted native `SKILL.md`. The converter reads `skill.sb.md` and writes `SKILL.md` (+ copies the resource dirs) into each target's skills directory.
- Resource dirs (`scripts/`, `references/`, `assets/`) are a shared convention across all three harnesses and are copied through unchanged. Reference them from the body with relative paths (e.g. `scripts/lint.py`).

---

## 3. The `skill.sb.md` file

A `skill.sb.md` is **YAML frontmatter** delimited by `---`, followed by a **markdown body**.

```markdown
---
name: example-skill
description: One-line trigger describing what this does and when to use it.
---

# Example Skill

Markdown instructions go here…
```

### 3.1 Frontmatter — field reference

Fields are grouped: **Core** (the portable contract), **Metadata** (registry/discovery, informational), **Capabilities** (optional, lossy), and **Targets** (per-harness overrides). Only the two Core fields are required.

#### Core (required)

| Field | Required | Type | Constraints |
|---|---|---|---|
| `name` | **Yes** | string | Lowercase kebab-case, `^[a-z0-9][a-z0-9-]*$`, ≤ 64 chars. Unique within a skills dir. Becomes the skill folder/identifier in every target. |
| `description` | **Yes** | string | The activation/trigger signal — say *what it does and when to use it*, third person, keyword-rich. Recommended ≤ 1024 chars (Claude Code truncates the combined description at 1,536 chars; staying well under is safest). Single line preferred. |

#### Metadata (optional, informational)

These describe the skill for humans and the registry. **None map to native harness frontmatter** — the converter preserves them in the SkillBridge source and the registry catalog, but does **not** emit them into the native `SKILL.md` (those harnesses define no such fields). They never affect runtime behavior.

| Field | Type | Notes |
|---|---|---|
| `spec_version` | string | SkillBridge spec the skill was authored against (e.g. `"0.1"`). Defaults to the converter's spec version if omitted. Recommended. |
| `version` | string | The skill's own semver (e.g. `"1.2.0"`). |
| `license` | string | SPDX identifier (e.g. `"Apache-2.0"`, `"MIT"`). |
| `author` | string | Name or handle. |
| `homepage` | string (URL) | Project/repo link. |
| `keywords` | string[] | Discovery tags for the registry catalog. |

#### Capabilities (optional, lossy — best-effort per target)

| Field | Type | Summary |
|---|---|---|
| `tools` | object | Neutral capability/permission hints, incl. extended `approval`/`sandbox`/`paths`. Lossy. See §4 and §4.1. |
| `mcp` | object | MCP server declarations (stdio + HTTP subset). See §5. |
| `agents` | string[] | Names of sibling sub-agents loaded from `agents/<name>.sb.md`. Lossy. See §7-bis A. |
| `args` | object | Slash-command / argument semantics (`hint`, `spec`, `model_invocable`). Lossy. See §7-bis B. |
| `hooks` | object | Skill-level lifecycle hooks (`event → command`). Lossy. See §7-bis C. |
| `scripts` | string[] | Declared executable entrypoints under `scripts/`. Informational. See §7-bis D. |

#### Targets (optional — per-harness escape hatch)

| Field | Type | Summary |
|---|---|---|
| `targets` | object | Per-target overrides and raw native frontmatter passthrough. See §6. The way a power user pins Claude Code's rich fields (`model`, `effort`, `allowed-tools`, `context: fork`, …) without polluting the portable core. |

> **Validation rule:** Unknown top-level frontmatter keys are a **warning, not an error** (forward-compat). Unknown keys *inside* `targets.<harness>` are passed through verbatim (the author is explicitly opting into native semantics).

### 3.2 Body

- Free-form **Markdown** after the frontmatter. This is the skill's instructions, injected into the agent's context when the skill activates.
- Written to the **progressive-disclosure** model shared by all three harnesses: only `name` + `description` sit in context at startup; the body loads on activation; bundled `references/` load only when the body points the agent to them.
- **Length guidance:** keep the body focused (Claude Code recommends ≤ 500 lines for `SKILL.md`); move long reference material into `references/` and link to it.
- Reference bundled files by relative path so every target resolves them the same way (e.g. "Run `scripts/check.py`" / "See `references/api.md`"). Avoid absolute paths and harness-specific path variables in the portable body; if you need one (e.g. Claude's `${CLAUDE_SKILL_DIR}`), gate it behind a `targets` override.

---

## 4. The `tools` block (optional, lossy)

A **neutral** capability declaration. Tool gating has a different home in every harness (Claude Code: skill frontmatter; Antigravity: a separate permission engine; Codex: `config.toml` + per-MCP lists), so this block is **best-effort and explicitly lossy**. Omit it entirely if you don't need gating — the agent then uses its default permissions.

```yaml
tools:
  filesystem: read          # read | write | none
  shell:                    # true (any) | false (none) | list of allowed command prefixes
    - "git "
    - "npm "
  network:                  # true | false | list of allowed hosts
    - "api.github.com"
  mcp: true                 # true | false | list of "server" or "server/tool" patterns
```

| Neutral field | Values | Claude Code | Antigravity | Codex |
|---|---|---|---|---|
| `filesystem` | `read`/`write`/`none` | ⚠️ `allowed-tools: Read, Grep, Glob` (+ `Edit, Write` if `write`) | ⚠️ permission entries `read_file(*)` / `write_file(*)` (emitted as setup note — not in skill file) | ⚠️ `sandbox_mode: read-only` vs `workspace-write` |
| `shell` | bool / prefix list | ⚠️ `allowed-tools: Bash(<prefix> *)` per prefix | ⚠️ `command(<prefix>)` permission entries | ⚠️ `approval_policy` + sandbox (prefix granularity ❌) |
| `network` | bool / host list | ❌ no per-skill equivalent (warn) | ⚠️ `read_url(<host>)` entries | ⚠️ `sandbox_workspace_write.network_access` (host granularity ❌) |
| `mcp` | bool / pattern list | ⚠️ `mcp__<server>__<tool>` in `allowed-tools` | ⚠️ `mcp(<server>/<tool>)` entries | ⚠️ per-MCP `enabled_tools` |

**Conversion behavior:** the converter maps what it can, emits Antigravity/Codex gating as a clearly-labeled setup note (since those targets can't carry it inside the skill file), and **warns on every field it can't represent** (e.g. `network` for Claude Code). For maximum portability of the wow-demo skill, prefer to omit `tools` and rely on the host's defaults.

### 4.1 Extended permissions (v0.2) — `approval` / `sandbox` / `paths`

Three additional `tools` sub-keys carry the richer-but-honest permission vocabulary that Codex (approval/sandbox) and Claude Code/Cursor (paths) expose natively:

```yaml
tools:
  approval: on-request        # untrusted | on-request | never   (Codex approval_policy)
  sandbox: read-only          # read-only | workspace-write | danger-full-access  (Codex sandbox_mode)
  paths: ["src/**", "packages/**"]   # path-scoping glob for skill activation
```

| Field | Values | Claude Code | Antigravity | Codex | Cursor |
|---|---|---|---|---|---|
| `approval` | `untrusted`/`on-request`/`never` | ❌ no skill-level field (warn) | ❌ Codex concept (warn) | ✅ `approval_policy` in `config.toml` | ❌ agent-level (warn) |
| `sandbox` | `read-only`/`workspace-write`/`danger-full-access` | ❌ no skill-level field (warn) | ❌ Codex concept (warn) | ✅ `sandbox_mode` in `config.toml`; also inferred from `filesystem` | ❌ agent-level (warn) |
| `paths` | glob list | ✅ `paths:` frontmatter | ❌ not represented | ❌ not represented | ✅ `paths:` frontmatter |

`approval`/`sandbox` are emitted into Codex's `config.toml` (top-level), so the file is written even when a skill declares no MCP. `paths` is a native Claude Code / Cursor frontmatter field and rides through into both `SKILL.md` files.

---

## 5. The `mcp` block (optional)

Declares MCP servers the skill depends on. SkillBridge standardizes on the **portable subset that all three support**: **stdio** (`command` + `args` + `env`) and a **generic HTTP** server (`url` + `headers`). Map is keyed by server name.

```yaml
mcp:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
  figma:
    url: "https://mcp.figma.com/mcp"
    headers:
      Authorization: "Bearer ${FIGMA_TOKEN}"
```

| SkillBridge | Claude Code (`.mcp.json`) | Antigravity (`mcp_config.json`) | Codex (`config.toml`) |
|---|---|---|---|
| `command`/`args`/`env` | `{type:"stdio", command, args, env}` ✅ | `{command, args, env}` ✅ | `[mcp_servers.<id>]` `command`/`args`/`[…env]` ✅ |
| `url` | `{type:"http", url}` ✅ | `serverUrl` ⚠️ (renamed from `httpUrl`) | `url` + `bearer_token_env_var` ⚠️ (also needs `experimental_use_rmcp_client=true`) |
| `headers` | `headers` ✅ | `headers` ✅ | `http_headers` / `bearer_token_env_var` ⚠️ |
| `${VAR}` substitution | ✅ `${VAR}` / `${VAR:-default}` | ⚠️ substitution reportedly unreliable — converter emits a warning to verify | ⚠️ via `env_key`/`bearer_token_env_var` |

**Notes:**
- Use `${VAR}` for secrets — never inline tokens. The converter passes the placeholder through; the user provides the env var.
- The converter writes each target's MCP into the **correct native file/format** (JSON for Claude/Antigravity, TOML for Codex) and renames fields per the table.
- Anything outside the stdio/HTTP subset (SSE, WebSocket, OAuth blocks, per-tool timeouts) is **not** part of the v1 portable format; declare it via a `targets` override if you need it.

---

## 6. The `targets` block (per-harness overrides)

An escape hatch for harness-specific enrichment without polluting the portable core. Keys are target ids: `claude-code`, `antigravity`, `codex`, `cursor`.

```yaml
targets:
  claude-code:
    frontmatter:            # merged verbatim into the emitted Claude Code SKILL.md frontmatter
      model: inherit
      effort: high
      allowed-tools: "Read, Grep, Bash(git *)"
    skip: false             # true → do not emit this target at all
  antigravity:
    frontmatter: {}
  codex:
    frontmatter: {}
```

| Sub-key | Type | Meaning |
|---|---|---|
| `frontmatter` | object | Key/values merged into that target's native skill frontmatter, verbatim. Author opts into native semantics; SkillBridge does not validate these. Overrides anything the core/capabilities blocks would emit for that target. |
| `skip` | boolean | `true` excludes this skill from that target's output (with a logged reason). |

This is where Claude Code's rich fields live (`model`, `effort`, `context: fork`, `argument-hint`, `arguments`, `paths`, `hooks`, `disable-model-invocation`, …) — none of which are portable, all of which are valid Claude Code frontmatter. Antigravity/Codex officially accept only `name`+`description`, so their `frontmatter` overrides should stay minimal.

---

## 7. Conversion targets — directory & file mapping

For a skill named `my-skill`, the converter emits:

| Target | Output path | File written | Notes |
|---|---|---|---|
| `claude-code` | `.claude/skills/my-skill/` | `SKILL.md` + resource dirs | Frontmatter = `name`, `description`, plus `targets.claude-code.frontmatter` + mapped `tools`. MCP → `.mcp.json` (project) entry. |
| `antigravity` | `.agents/skills/my-skill/` | `SKILL.md` + resource dirs | Frontmatter = `name` + `description` only. MCP → `mcp_config.json` entry. Tool gating → setup note (permission engine). |
| `codex` | `.agents/skills/my-skill/` | `SKILL.md` + resource dirs | Frontmatter = `name` + `description`. MCP → `config.toml` `[mcp_servers.*]`. Gating → approval/sandbox note. |
| `cursor` | `.cursor/skills/my-skill/` | `SKILL.md` + resource dirs | Frontmatter = `name` + `description` (Cursor v2.4+ native Agent Skills). MCP → `.cursor/mcp.json` (`mcpServers`, no `type` field). Gating → agent-level note. |

(Output root is configurable; defaults shown are the conventional per-harness skills dirs. Codex and Antigravity share the tool-agnostic `.agents/skills/` namespace; Cursor also reads `.agents/skills/` and `.claude/skills/` but SkillBridge emits its native `.cursor/skills/` for clarity.)

---

## 7-bis. v0.2 capabilities — sub-agents, args, hooks, scripts

The `0.1` spec deferred these to v2. The v0.2 converter implements them as **optional, lossy, per-target** fields — same honesty contract as `tools`: map what each harness supports, emit a setup note where it can't carry the capability in-file, and warn on every drop.

### A. `agents` — sub-agents (sibling-file model)

A sub-agent is itself a **skill-shaped doc** — `name` + `description` + a markdown body that becomes the system prompt — stored as a sibling file:

```
code-reviewer/
├── skill.sb.md          # lists  agents: [security]
└── agents/
    └── security.sb.md   # name + description + body (the sub-agent's system prompt)
```

```yaml
# in skill.sb.md
agents: [security]        # each name resolves to agents/<name>.sb.md
```

The sub-agent file may carry its own `tools` block (e.g. `tools.filesystem: read`), which maps the same way the skill's does.

| Concept | Claude Code | Antigravity | Codex | Cursor |
|---|---|---|---|---|
| Sub-agent file | ✅ `.claude/agents/<name>.md` (body = system prompt, `tools:` from permissions) | ❌ **runtime-only** — no file; emitted as a `define_subagent` note in `SETUP.antigravity.md` (warn) | ✅ `.codex/agents/<name>.toml` (`developer_instructions`, `sandbox_mode`) ⚠️ coarse sandbox (warn) | ✅ `.cursor/agents/<name>.md` (name/description/body) |

Antigravity has no static sub-agent file format (confirmed Phase 0 §A), so SkillBridge writes a runtime-invocation note instead of inventing one.

### B. `args` — slash-command / argument semantics

```yaml
args:
  hint: "[path]"          # argument-hint shown in the slash-command picker
  spec: [issue, branch]   # named positional arguments
  model_invocable: false  # false => disable model auto-invocation (user-invoked only)
```

| Field | Claude Code | Antigravity | Codex | Cursor |
|---|---|---|---|---|
| `hint` | ✅ `argument-hint` | ❌ workflows, not skills (warn) | ❌ arg-substitution deprecated (warn) | ❌ no argument-hint (warn) |
| `spec` | ✅ `arguments` | ❌ (warn) | ❌ (warn) | ❌ (warn) |
| `model_invocable: false` | ✅ `disable-model-invocation: true` | ❌ (warn) | ❌ (warn) | ✅ `disable-model-invocation: true` |

### C. `hooks` — skill-level lifecycle hooks

```yaml
hooks:
  PostToolUse: "scripts/lint.sh"   # event → command (string or string[])
```

| Concept | Claude Code | Antigravity | Codex | Cursor |
|---|---|---|---|---|
| Skill-level hooks | ✅ native `hooks:` frontmatter (verbatim) | ⚠️ no skill-level support → listed in `SETUP.antigravity.md` (wire manually) | ⚠️ no skill-level hooks → listed in `SETUP.codex.md` (warn) | ❌ no skill-level hooks (warn) |

### D. `scripts` — declared executable entrypoints

```yaml
scripts: ["scripts/lint.sh"]
```

`scripts` is **informational**: the actual files in `scripts/` are copied verbatim into every target's skill dir by the resource-dir mechanism (§2) regardless of this list. The field documents the intended entrypoints for humans and the registry; it is **not** emitted into any native frontmatter on any target. Keep the listed paths in sync with the files in `scripts/`.

### E. Sidecar files the converter may emit

| File | When | Targets |
|---|---|---|
| `SETUP.antigravity.md` | permissions / sub-agents / hooks present | Antigravity |
| `SETUP.codex.md` | hooks present | Codex |
| `config.toml` | MCP **or** `approval`/`sandbox` present | Codex |

---

## 8. Validation rules (normative)

A `skill.sb.md` is **valid** iff:

1. It begins with a YAML frontmatter block delimited by `---` … `---`, followed by a non-empty markdown body.
2. `name` is present, a string matching `^[a-z0-9][a-z0-9-]*$`, ≤ 64 chars.
3. `description` is present, a non-empty string. (Warn if > 1024 chars.)
4. `spec_version`, if present, is a string the converter recognizes (warn on unknown).
5. `tools.filesystem` ∈ {`read`,`write`,`none`} if present; `tools.shell`/`tools.network` is a boolean or array of strings; `tools.mcp` is a boolean or array of strings.
6. Each `mcp.<server>` has **either** `command` (string; `args` string[], `env` object) **or** `url` (string; `headers` object) — not both, not neither.
7. `targets.<id>` uses only known target ids (`claude-code`/`antigravity`/`codex`); `frontmatter` is an object; `skip` is a boolean.
8. Unknown **top-level** keys → warning (forward-compat), not failure. Unknown keys under `targets.<id>.frontmatter` → passed through.

The Phase 2 converter SHOULD implement this as a Zod schema so authors get precise errors.

---

## 9. Worked example — a complete, valid `skill.sb.md`

This is the kind of skill the wow demo converts to all three harnesses. Uses only the portable core + an optional MCP server.

```markdown
---
name: commit-helper
description: Writes a clear, conventional-commits message for the current staged git diff. Use when the user asks to commit, write a commit message, or "save my work".
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
```

Directory:
```
commit-helper/
├── skill.sb.md
└── references/
    └── conventional-commits.md
```

What the converter does with it:
- **Claude Code** → `.claude/skills/commit-helper/SKILL.md` with frontmatter `name`, `description`, `allowed-tools` (from the override); `github` MCP added to `.mcp.json`; `references/` copied.
- **Antigravity** → `.agents/skills/commit-helper/SKILL.md` with `name` + `description`; `github` MCP written to `mcp_config.json`; the `allowed-tools` override is Claude-only, so it's ignored for this target (logged); `references/` copied.
- **Codex** → `.agents/skills/commit-helper/SKILL.md` with `name` + `description`; `github` MCP written to `config.toml` `[mcp_servers.github]`; `references/` copied.

All three run the same instructions with the same trigger — the wow demo.

---

## 10. Scope: shipped in v0.2 vs still deferred

**Now implemented (v0.2)** — see §4.1 and §7-bis for the per-target fate tables:

- **Sub-agents** (`agents`) — emitted natively for Claude Code / Codex / Cursor; runtime-only setup note for Antigravity.
- **Slash-command args** (`args.hint`/`spec`/`model_invocable`) — Claude Code native; `model_invocable` also honored by Cursor.
- **Skill-level hooks** (`hooks`) — Claude Code native; setup note elsewhere.
- **Declared scripts** (`scripts`) + **extended permissions** (`tools.approval`/`sandbox`/`paths`).
- **Bidirectional / round-trip import** (native → SkillBridge), including native agent files and MCP configs.
- **Cursor** as a first-class fourth target.

**Still intentionally NOT in scope** (Phase 0 lossy analysis + anti-sprawl rule):

- **Instruction files** (`AGENTS.md` / `CLAUDE.md` bodies). SkillBridge is **skills-only**.
- **Rich MCP transports** (SSE, WebSocket, OAuth blocks, per-tool timeouts) — beyond the portable stdio+HTTP subset; use a `targets` override if needed.
- **The remaining harnesses** (Gemini CLI, OpenClaw) — later.

---

## 11. Spec versioning

- This spec is **`0.1`** (draft). The format will change as harnesses drift — Antigravity especially (preview-era; see `harness-formats.md` §8).
- Skills declare `spec_version`; the converter refuses (or warns on) a `spec_version` newer than it understands.
- Breaking frontmatter changes bump the minor version pre-`1.0`; after `1.0`, semver applies to the format contract.

---

## 12. Design decisions (resolved Phase-1 open questions)

| Question | Decision | Rationale |
|---|---|---|
| Authoring file & dir | `skill.sb.md` in a skill-named dir | Distinct from emitted `SKILL.md`; one source, many outputs. |
| Skills dir per target | `.claude/skills/` for Claude Code; `.agents/skills/` for Antigravity + Codex | Matches each harness's native convention (Phase 0 §1). |
| Sub-agents in v1? | Deferred in `0.1`; **shipped in v0.2** (Claude/Codex/Cursor file + Antigravity runtime note) | No common file format, so emitted per-target with an honest Antigravity loss note (§7-bis A). |
| Permissions modeling | Optional neutral `tools` block, explicitly lossy + warns | Honest best-effort; demo skills can omit it. |
| Instruction-file ownership | Skills-only for v1 | Kickoff scope; keeps the core small. |
| MCP scope | stdio + generic HTTP subset only | The proven common denominator across all three. |
