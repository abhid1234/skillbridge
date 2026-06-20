// Build step: embed the registry/ skills into web/registry.gen.js so the static
// playground can load them client-side. Plain Node, zero dependencies.
//
// Each emitted entry is { name, description, keywords, exercises, content }:
//   - keywords:  parsed from the `keywords:` frontmatter list (for search + filter chips).
//   - exercises: tags describing which slice of the format the skill exercises, derived by
//                scanning the frontmatter. Drives the gallery filter chips and the catalog.
//                Possible tags: core | tools | mcp-stdio | mcp-http | agents | target-override.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", ".."); // packages/cli/scripts -> repo root
const regDir = join(repoRoot, "registry");
const outFile = join(repoRoot, "web", "registry.gen.js");

/** Pull the raw YAML frontmatter block out of a skill.sb.md (between the first two `---`). */
function frontmatterOf(content) {
  const fm = content.match(/^\s*---\s*\n([\s\S]*?)\n---/);
  return fm ? fm[1] : "";
}

/** description: scalar (handles optional surrounding quotes). */
function parseDescription(fm) {
  const d = fm.match(/^description:\s*(.+)$/m);
  return d ? d[1].replace(/^["']|["']$/g, "").trim() : "";
}

/**
 * keywords: a flow list `[a, b, c]` or a block list (`- a` on following lines).
 * Returns a de-duped array of trimmed, unquoted strings.
 */
function parseKeywords(fm) {
  const out = [];
  const flow = fm.match(/^keywords:\s*\[([^\]]*)\]\s*$/m);
  if (flow) {
    for (const k of flow[1].split(",")) {
      const v = k.replace(/^["']|["']$/g, "").trim();
      if (v) out.push(v);
    }
  } else {
    // block form: `keywords:` on its own line, then `  - item` lines.
    const m = fm.match(/^keywords:\s*\n((?:[ \t]+-[ \t].*\n?)+)/m);
    if (m) {
      for (const line of m[1].split("\n")) {
        const item = line.match(/^[ \t]+-[ \t]+(.*)$/);
        if (item) {
          const v = item[1].replace(/^["']|["']$/g, "").trim();
          if (v) out.push(v);
        }
      }
    }
  }
  return [...new Set(out)];
}

/** True if a top-level frontmatter key (`key:`) is present. */
function hasTopKey(fm, key) {
  return new RegExp(`^${key}:\\s*(\\S|$)`, "m").test(fm);
}

/**
 * Extract the indented block belonging to a top-level key, i.e. the lines after
 * `key:` that are more-indented than column 0. Used to scan inside `mcp:`.
 */
function blockOf(fm, key) {
  const lines = fm.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^${key}:\\s*$`).test(l));
  if (start === -1) return "";
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") { body.push(l); continue; }
    if (/^\S/.test(l)) break; // back to a top-level key
    body.push(l);
  }
  return body.join("\n");
}

/**
 * Derive the exercise tags from the frontmatter:
 *   - tools           : a `tools:` block is present.
 *   - mcp-stdio       : a declared mcp server uses `command:` (stdio transport).
 *   - mcp-http        : a declared mcp server uses `url:` (http transport).
 *   - agents          : an `agents:` list is present.
 *   - target-override : a `targets:` block is present.
 *   - core            : none of the above (pure name+description+body).
 */
function deriveExercises(fm) {
  const tags = [];
  if (hasTopKey(fm, "tools")) tags.push("tools");
  if (hasTopKey(fm, "mcp")) {
    const mcpBlock = blockOf(fm, "mcp");
    if (/^\s+command:\s*\S/m.test(mcpBlock)) tags.push("mcp-stdio");
    if (/^\s+url:\s*\S/m.test(mcpBlock)) tags.push("mcp-http");
  }
  if (hasTopKey(fm, "agents")) tags.push("agents");
  if (hasTopKey(fm, "targets")) tags.push("target-override");
  if (tags.length === 0) tags.push("core");
  return tags;
}

const skills = [];
if (existsSync(regDir)) {
  for (const name of readdirSync(regDir).sort()) {
    const skillFile = join(regDir, name, "skill.sb.md");
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, "utf8");
    const fm = frontmatterOf(content);
    const description = parseDescription(fm);
    const keywords = parseKeywords(fm);
    const exercises = deriveExercises(fm);
    skills.push({ name, description, keywords, exercises, content });
  }
}

// Also embed examples/ skills that carry sibling sub-agents, so the playground can
// demo sub-agent conversion (skill text + each agents/<name>.sb.md text).
const examplesDir = join(repoRoot, "examples");
const examples = [];
if (existsSync(examplesDir)) {
  for (const name of readdirSync(examplesDir).sort()) {
    const skillFile = join(examplesDir, name, "skill.sb.md");
    if (!existsSync(skillFile)) continue;
    const skill = readFileSync(skillFile, "utf8");
    const agents = [];
    const agentsDir = join(examplesDir, name, "agents");
    if (existsSync(agentsDir)) {
      for (const af of readdirSync(agentsDir).sort()) {
        if (af.endsWith(".sb.md")) agents.push(readFileSync(join(agentsDir, af), "utf8"));
      }
    }
    if (agents.length) examples.push({ name, skill, agents });
  }
}

writeFileSync(
  outFile,
  "export const REGISTRY = " + JSON.stringify(skills, null, 2) + ";\n" +
  "export const EXAMPLES = " + JSON.stringify(examples, null, 2) + ";\n",
);
console.log(`gen-registry: wrote ${skills.length} skills + ${examples.length} example(s) -> ${outFile}`);
