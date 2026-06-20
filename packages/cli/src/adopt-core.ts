/**
 * Browser-safe ADOPT (Tier 4): discover native skills across harnesses in a
 * repo and import them into unified portable sources. Pure functions, NO fs.
 *
 * Given a flat list of {path, content} files (gathered by the fs wrapper in
 * adopt.ts), this groups native SKILL.md files by skill name across the three
 * known native skill roots (.claude/skills, .agents/skills, .cursor/skills),
 * imports each native file to a SkillBridge core, diffs the resulting cores,
 * and reports per-skill the unified text, the contributing sources, and any
 * conflicts. Sibling MCP configs (.mcp.json / mcp_config.json / config.toml)
 * and native sub-agent files are picked up alongside.
 */
import { SourceHarness, McpKind, importToSkillBridge, importAgentFile, parseNativeMcp } from "./import-core.js";
import { splitFrontmatter, McpServer } from "./format.js";

/** A single native file discovered in the repo. */
export interface RepoFile {
  path: string; // forward-slash relative path
  content: string;
}

/** One adopted skill: a unified portable source plus provenance + conflicts. */
export interface AdoptedSkill {
  name: string;
  sbText: string; // the unified skill.sb.md (browser-safe text)
  sources: string[]; // native file paths that contributed (sorted)
  conflicts: string[]; // human-readable divergences across harnesses
  warnings: string[];
}

export interface AdoptResult {
  skills: AdoptedSkill[];
  /** Native agent files adopted (keyed by agent name); portable agents/<name>.sb.md text. */
  agents: { name: string; sbText: string; source: string; warnings: string[] }[];
  warnings: string[];
}

// The native skill roots and the harness each maps to.
const SKILL_ROOTS: { prefix: string; harness: SourceHarness }[] = [
  { prefix: ".claude/skills/", harness: "claude-code" },
  { prefix: ".agents/skills/", harness: "generic" }, // Antigravity + Codex share this root
  { prefix: ".cursor/skills/", harness: "cursor" },
];

// Sibling MCP config filenames and how to parse them, by harness.
const MCP_FILES: { name: string; kind: McpKind; harness: SourceHarness }[] = [
  { name: ".mcp.json", kind: "json", harness: "claude-code" },
  { name: "mcp_config.json", kind: "json", harness: "generic" },
  { name: "config.toml", kind: "toml", harness: "generic" },
  { name: ".cursor/mcp.json", kind: "json", harness: "cursor" },
];

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Is `path` a native SKILL.md under one of the known roots? Returns its root info. */
function classifySkillFile(p: string): { prefix: string; harness: SourceHarness; skill: string } | null {
  const np = norm(p);
  for (const root of SKILL_ROOTS) {
    if (np.startsWith(root.prefix) && /\/SKILL\.md$/i.test(np)) {
      const rest = np.slice(root.prefix.length);
      const skill = rest.slice(0, rest.indexOf("/"));
      if (skill) return { prefix: root.prefix, harness: root.harness, skill };
    }
  }
  return null;
}

/** Find a native agent file path → its kind ('md' Claude/Cursor, 'toml' Codex). */
function classifyAgentFile(p: string): "md" | "toml" | null {
  const np = norm(p);
  if (/(?:^|\/)\.claude\/agents\/[^/]+\.md$/i.test(np)) return "md";
  if (/(?:^|\/)\.cursor\/agents\/[^/]+\.md$/i.test(np)) return "md";
  if (/(?:^|\/)\.codex\/agents\/[^/]+\.toml$/i.test(np)) return "toml";
  return null;
}

/** Collect MCP servers visible to a harness from any matching sibling config in the repo. */
function gatherMcp(files: RepoFile[]): Record<SourceHarness, Record<string, McpServer>> {
  const out: Record<string, Record<string, McpServer>> = {};
  for (const f of files) {
    const np = norm(f.path);
    for (const m of MCP_FILES) {
      // Match either a top-level config or one anywhere (basename match for nested repos).
      const base = np.split("/").slice(-1)[0];
      const matchesNested = m.name.includes("/") ? np.endsWith(m.name) : base === m.name;
      if (!matchesNested) continue;
      const servers = parseNativeMcp(f.content, m.kind);
      if (!Object.keys(servers).length) continue;
      out[m.harness] = { ...(out[m.harness] || {}), ...servers };
    }
  }
  return out as Record<SourceHarness, Record<string, McpServer>>;
}

/** Stable serialization of a parsed core for diffing (frontmatter sans spec_version churn + body). */
function coreSignature(sbText: string): { fmText: string; body: string } | null {
  const split = splitFrontmatter(sbText);
  if (!split) return null;
  return { fmText: split.fm.trim(), body: split.body.trim() };
}

/**
 * Group native SKILL.md files by skill name across harnesses, import each to a
 * SkillBridge core, diff the cores, and report a unified source per skill.
 */
export function detectSkillFiles(fileList: RepoFile[]): AdoptResult {
  const warnings: string[] = [];

  // Pre-index MCP configs so each imported skill can carry its harness's servers.
  const mcpByHarness = gatherMcp(fileList);
  const mcpKindByHarness: Partial<Record<SourceHarness, McpKind>> = {
    "claude-code": "json", generic: "json", cursor: "json",
  };

  // Group skill files by skill name.
  interface Native { path: string; harness: SourceHarness; content: string }
  const groups = new Map<string, Native[]>();
  for (const f of fileList) {
    const c = classifySkillFile(f.path);
    if (!c) continue;
    const arr = groups.get(c.skill) ?? [];
    arr.push({ path: norm(f.path), harness: c.harness, content: f.content });
    groups.set(c.skill, arr);
  }

  const skills: AdoptedSkill[] = [];
  for (const [name, natives] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    natives.sort((a, b) => a.path.localeCompare(b.path));
    const skWarnings: string[] = [];
    const conflicts: string[] = [];
    const sources: string[] = [];

    interface Imported { path: string; harness: SourceHarness; sbText: string; sig: { fmText: string; body: string } | null }
    const imported: Imported[] = [];

    for (const nat of natives) {
      const servers = mcpByHarness[nat.harness];
      const mcp = servers && Object.keys(servers).length
        ? { text: buildMcpJson(servers), kind: mcpKindByHarness[nat.harness] ?? "json" }
        : undefined;
      const imp = importToSkillBridge(nat.content, nat.harness, mcp);
      if (!imp.ok || !imp.sbText) {
        skWarnings.push(`${nat.path}: import failed (${imp.errors.join("; ")}); skipped.`);
        continue;
      }
      // Only surface the genuinely useful import warnings (drop the boilerplate "no MCP supplied").
      for (const w of imp.warnings) {
        if (!w.startsWith("No MCP config supplied")) skWarnings.push(`${nat.path}: ${w}`);
      }
      sources.push(nat.path);
      imported.push({ path: nat.path, harness: nat.harness, sbText: imp.sbText, sig: coreSignature(imp.sbText) });
    }

    if (!imported.length) {
      warnings.push(`skill "${name}": no importable SKILL.md found across harnesses; skipped.`);
      continue;
    }

    // Diff the imported cores. The base is the first; report divergences.
    const base = imported[0];
    for (let i = 1; i < imported.length; i++) {
      const other = imported[i];
      if (!base.sig || !other.sig) continue;
      if (base.sig.body !== other.sig.body) {
        conflicts.push(`body differs between ${base.path} and ${other.path}`);
      }
      if (base.sig.fmText !== other.sig.fmText) {
        conflicts.push(`frontmatter differs between ${base.path} and ${other.path}`);
      }
    }

    skills.push({
      name,
      sbText: base.sbText, // the unified portable source (first harness wins as the base)
      sources: sources.sort(),
      conflicts,
      warnings: skWarnings,
    });
  }

  // Native sub-agent files → portable agents.
  const agents: AdoptResult["agents"] = [];
  for (const f of fileList) {
    const kind = classifyAgentFile(f.path);
    if (!kind) continue;
    const res = importAgentFile(f.content, kind);
    if (!res.sbText) {
      warnings.push(`agent ${norm(f.path)}: import failed (${res.errors.join("; ")}); skipped.`);
      continue;
    }
    agents.push({ name: res.name, sbText: res.sbText, source: norm(f.path), warnings: res.warnings });
  }

  return { skills, agents, warnings };
}

/** Re-serialize a parsed MCP server map as a minimal .mcp.json so importToSkillBridge can re-parse it. */
function buildMcpJson(servers: Record<string, McpServer>): string {
  return JSON.stringify({ mcpServers: servers });
}
