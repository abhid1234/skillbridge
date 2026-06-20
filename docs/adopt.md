# `adopt` — bring an existing repo's skills into SkillBridge

`adopt` is the on-ramp for a project that already has native agent skills. Instead of
authoring portable sources by hand, point SkillBridge at a repository and it discovers
every native `SKILL.md` across the supported harnesses, imports each one to a portable
`skill.sb.md`, and reconciles duplicates of the same skill into a single unified source.

Where `import` takes **one** native file, `adopt` walks a **whole repo** and groups by
skill name across harnesses — so a project that maintains parallel
`.claude/skills/deploy/SKILL.md` and `.agents/skills/deploy/SKILL.md` collapses into one
`deploy/skill.sb.md`, with any divergence between the two reported as a conflict.

## Usage

```sh
# Discover and import every native skill in a repo, writing portable sources to ./adopted/
skillbridge adopt <repo-dir> --out ./adopted

# Inspect what would be adopted without writing (prints a manifest)
skillbridge adopt <repo-dir>
```

`<repo-dir>` is the root of the project to scan. The walk skips `node_modules/`, `.git/`,
and `dist/`.

## What it finds

`adopt` recursively scans for:

| Source | Native location(s) | Becomes |
|---|---|---|
| Claude Code skill | `.claude/skills/<name>/SKILL.md` | `<name>/skill.sb.md` |
| Antigravity / Codex skill | `.agents/skills/<name>/SKILL.md` | merged into `<name>/skill.sb.md` |
| Cursor skill | `.cursor/skills/<name>/SKILL.md` | merged into `<name>/skill.sb.md` |
| MCP config | `.mcp.json`, `mcp_config.json`, `config.toml`, `.cursor/mcp.json` | folded into the owning skill's `mcp:` block |
| Sub-agent | `.claude/agents/*.md`, `.cursor/agents/*.md`, `.codex/agents/*.toml` | `agents/<name>.sb.md` |

Sibling MCP configs are matched to the harness they belong to and attached to the skills
imported from that harness, so a declared server survives the round-trip into portable form.

## Output layout

`adopt --out ./adopted` writes one directory per skill plus a shared `agents/` dir:

```
adopted/
  deploy/
    skill.sb.md
  changelog/
    skill.sb.md
  agents/
    reviewer.sb.md
```

Each `skill.sb.md` is a valid SkillBridge source you can immediately re-`convert` to any
target — adopt → edit once → convert everywhere.

## Reconciliation & conflicts

When the same skill name exists for more than one harness, `adopt` imports each native
file to a portable core, then diffs them:

- The **first** source (sorted by path) becomes the unified base that is written out.
- If the **body** differs across harnesses, it reports `body differs between <a> and <b>`.
- If the **frontmatter** differs (after dropping `spec_version` churn), it reports
  `frontmatter differs between <a> and <b>`.

Conflicts are *reported, not auto-merged* — review them, fold the intended differences into
the unified source (or into `targets.<harness>` overrides), and re-run `convert` to confirm.

Import-level `warnings` (e.g. a native field that has no portable home) are surfaced per
skill so nothing is silently dropped.

## After adopting: contribute back to the registry

Adopted sources are how most registry skills should start. To upstream one:

1. **Adopt** the skill out of your repo: `skillbridge adopt <repo> --out /tmp/adopted`.
2. **Move** the source into the registry at `registry/<name>/skill.sb.md` (the directory
   name must equal the frontmatter `name`). Bring along any `scripts/`, `agents/`, or
   resource files the skill references.
3. **Fill in metadata** the native format didn't carry: `spec_version: "0.1"`, a
   `version`, a `license`, and a `keywords:` list (these power registry search and the
   filter chips — see [`../registry/README.md`](../registry/README.md)).
4. **Scrub secrets.** Replace any real tokens with `${ENV_VAR}` placeholders.
5. **Validate** with zero errors: `skillbridge validate registry/<name>`.
6. **Convert** to every harness: `skillbridge convert registry/<name> --to all`. Lossy
   *warnings* are expected and fine; *errors* are not. (CI enforces exactly this in
   [`.github/workflows/validate-registry.yml`](../.github/workflows/validate-registry.yml).)
7. **Regenerate the playground bundle** so the web gallery picks up your skill:
   `node packages/cli/scripts/gen-registry.mjs` (writes `web/registry.gen.js`).
8. **Add a catalog row** to `registry/README.md` (Skill · Description · Exercises ·
   Converts to) and open a PR using the
   [registry-skill PR template](../.github/PULL_REQUEST_TEMPLATE/registry-skill.md).

The `exercises` tags (`core` · `tools` · `mcp-stdio` · `mcp-http` · `agents` ·
`target-override`) are derived automatically from your frontmatter by the bundle
generator; you don't hand-author them, but the PR template asks you to confirm which
apply so reviewers can sanity-check coverage.
