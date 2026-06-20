# SkillBridge Lossiness Matrix

Per-target fidelity of each portable capability, derived automatically from real converter warnings. This file is GENERATED — run `npm run conformance` to regenerate; `npm run conformance:check` fails CI if it drifts.

Legend: ✅ native (maps cleanly) · 🟡 approx (coarser form / manual setup) · ❌ dropped (not representable, lost).

**Coverage:** 25/40 capability×target cells map natively across 16 sampled skills.

| Capability | claude-code | antigravity | codex | cursor |
| --- | --- | --- | --- | --- |
| tools.filesystem | ✅ native | 🟡 approx [^1] | ✅ native | ❌ dropped [^2] |
| tools.shell (prefix gating) | ✅ native | ✅ native | 🟡 approx [^3] | ✅ native |
| tools.network (host allowlist) | ❌ dropped [^4] | ✅ native | 🟡 approx [^5] | ✅ native |
| tools.mcp (enable flag) | ✅ native | ✅ native | ✅ native | ✅ native |
| tools.approval / sandbox | ✅ native | 🟡 approx [^6] | ✅ native | ✅ native |
| tools.sandbox | ✅ native | ✅ native | ✅ native | ✅ native |
| mcp servers | ✅ native | 🟡 approx [^7][^8] | 🟡 approx [^9] | ✅ native |
| agents (sub-agents) | ✅ native | ❌ dropped [^10] | 🟡 approx [^11] | ✅ native |
| args (slash/arg-hint) | ✅ native | ❌ dropped [^12] | ❌ dropped [^13] | ❌ dropped [^14] |
| hooks | ✅ native | ✅ native | ❌ dropped [^15] | ❌ dropped [^16] |

## Notes

[^1]: tools: Antigravity gates via its permission engine (action(target)), not the skill file — emitted to SETUP.md.
[^2]: tools: Cursor gates at the agent/mode level, not the skill file; the tools block was not emitted.
[^3]: tools.shell prefix list maps only coarsely to Codex (approval/sandbox, no per-prefix gating).
[^4]: tools.network has no per-skill equivalent in Claude Code; dropped.
[^5]: tools.network host list isn't expressible in Codex; enabled network access broadly instead.
[^6]: tools.approval/sandbox are Codex concepts; not represented in Antigravity's permission engine.
[^7]: mcp.github: Antigravity's env-var substitution has been unreliable in preview — verify the value of any ${VAR} after conversion.
[^8]: mcp.postgres: Antigravity's env-var substitution has been unreliable in preview — verify the value of any ${VAR} after conversion.
[^9]: mcp: Codex needs `experimental_use_rmcp_client = true` for HTTP servers (emitted into config.toml).
[^10]: agent "reviewer": Antigravity sub-agents are runtime-only — no file emitted; see SETUP.md for the define_subagent pattern.
[^11]: agent "reviewer": Codex carries the system prompt as developer_instructions; sandbox granularity is coarse.
[^12]: args: Antigravity uses workflows for slash/args, not skills; document in the body. Not emitted.
[^13]: args: Codex deprecated argument substitution into skills; document the invocation in the body instead. Not emitted.
[^14]: args.hint/spec: Cursor skills have no argument-hint/arguments; not emitted (model_invocable is honored).
[^15]: hooks: Codex has no skill-level hooks; see SETUP.md note. Not emitted into the skill.
[^16]: hooks: Cursor has no skill-level hooks; not emitted.

## Sampled skills

- `examples/commit-helper`
- `registry/api-endpoint-scaffolder`
- `registry/changelog-generator`
- `registry/conventional-commit-writer`
- `registry/db-schema-explorer`
- `registry/dependency-bump-checker`
- `registry/design-token-sync`
- `registry/env-var-auditor`
- `registry/error-log-summarizer`
- `registry/markdown-table-formatter`
- `registry/pr-description-drafter`
- `registry/regex-builder`
- `registry/release-notes-drafter`
- `registry/sql-explainer`
- `registry/test-failure-triager`
- `synthetic/rich-skill`
