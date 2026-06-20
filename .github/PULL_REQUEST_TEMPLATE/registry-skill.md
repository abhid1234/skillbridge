<!--
  Contributing a skill to the SkillBridge registry.
  Use this template via: ?template=registry-skill.md when opening the PR
  (e.g. https://github.com/<org>/SkillBridge/compare/main...your-branch?template=registry-skill.md).
  See docs/adopt.md and registry/README.md for the full contribution flow.
-->

## New / updated registry skill

**Skill name:** `<name>`  <!-- the directory under registry/, lowercase kebab-case -->

**One-line description:** <!-- mirror the frontmatter `description` -->

### What it does
<!-- 2-3 sentences: the job it does and when an agent should reach for it. -->

### Format surface it exercises
<!-- Check every tag that applies. These match the `exercises` chips in the registry. -->
- [ ] `core` — only `name` + `description` + Markdown body (lossless everywhere)
- [ ] `tools` — declares a `tools:` capability/permission block
- [ ] `mcp-stdio` — declares an MCP server with a `command:` (stdio transport)
- [ ] `mcp-http` — declares an MCP server with a `url:` (http transport)
- [ ] `agents` — declares sub-agents under `agents/`
- [ ] `target-override` — uses `targets.<harness>.frontmatter` passthrough

**Keywords:** <!-- comma-separated; mirror the frontmatter `keywords:` list -->

### Author checklist
- [ ] Lives at `registry/<name>/skill.sb.md` (directory name == frontmatter `name`).
- [ ] `name` is lowercase kebab-case; `description` is present and explains *when* to use the skill.
- [ ] Frontmatter includes `spec_version: "0.1"`, `version`, `license`, and `keywords`.
- [ ] Any referenced `scripts/`, `agents/`, or resource files are included in the PR.
- [ ] Secrets are passed as `${ENV_VAR}` placeholders — no real tokens committed.
- [ ] `skillbridge validate registry/<name>` passes with **zero errors**.
- [ ] `skillbridge convert registry/<name> --to all` succeeds (lossy *warnings* are fine and expected).
- [ ] Regenerated the playground bundle: `node packages/cli/scripts/gen-registry.mjs` and committed `web/registry.gen.js`.
- [ ] Added a row to the catalog table in `registry/README.md` (Skill · Description · Exercises · Converts to).

### Conversion output
<!--
  Paste the tail of `skillbridge convert registry/<name> --to all`.
  If it printed lossy warnings, that's expected — briefly note what is lost per harness
  (e.g. "network allowlist dropped for Claude Code", "Claude-only model override dropped for Codex/Antigravity").
-->

```
$ skillbridge convert registry/<name> --to all
...
```
