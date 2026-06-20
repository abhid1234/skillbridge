import * as fs from "fs";
import * as path from "path";
import { parseSkill, Skill, TargetId, TARGET_IDS } from "./format.js";
import { CONVERTERS } from "./convert-core.js";
import { importToSkillBridge, ImportResult, SourceHarness } from "./import-core.js";
import { OutputFile } from "./targets/types.js";

export const RESOURCE_DIRS = ["scripts", "references", "assets"];

/**
 * Write a set of in-memory output files under `outRoot`, creating dirs as needed.
 * Tracks seen paths to warn on cross-source overwrites (shared namespaces).
 * Shared by convertTo and the project-level sync command (one write path).
 */
export function writeOutputFiles(
  files: OutputFile[],
  outRoot: string,
  seen: Map<string, { source: string; content: string }> = new Map(),
  source = "",
): { written: string[]; warnings: string[] } {
  const written: string[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    const prev = seen.get(f.path);
    if (prev && prev.content !== f.content) {
      warnings.push(`${f.path}: this output overwrites the file already written by "${prev.source}" (shared namespace). Use separate --out dirs if you need both.`);
    }
    seen.set(f.path, { source, content: f.content });
    const dest = path.join(outRoot, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Atomic write: write to a temp sibling then rename, so a crash/permission
    // failure mid-write never leaves a half-written native file.
    const tmp = `${dest}.sb-tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmp, f.content);
      fs.renameSync(tmp, dest);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw e;
    }
    written.push(f.path);
  }
  return { written, warnings };
}

export interface ConvertResult {
  target: TargetId;
  skipped: boolean;
  skillDir: string | null;
  written: string[];
  copiedDirs: string[];
  warnings: string[];
}

/** Resolve a skill argument to the `skill.sb.md` file path and its source dir. */
export function resolveSkillPath(input: string): { file: string; sourceDir: string } {
  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    return { file: path.join(input, "skill.sb.md"), sourceDir: input };
  }
  return { file: input, sourceDir: path.dirname(input) };
}

/** Parse a skill from disk. Throws with all validation errors if invalid. */
export function loadSkill(input: string): { skill: Skill; sourceDir: string; agents: Skill[]; warnings: string[] } {
  const { file, sourceDir } = resolveSkillPath(input);
  const raw = fs.readFileSync(file, "utf8");
  const res = parseSkill(raw);
  if (!res.skill) {
    throw new Error(`Invalid skill (${file}):\n  - ${res.errors.join("\n  - ")}`);
  }
  const warnings = [...res.warnings];
  const agents: Skill[] = [];
  for (const name of res.skill.frontmatter.agents ?? []) {
    const agentFile = path.join(sourceDir, "agents", `${name}.sb.md`);
    if (!fs.existsSync(agentFile)) {
      warnings.push(`agent "${name}" listed but agents/${name}.sb.md not found; skipped.`);
      continue;
    }
    const pa = parseSkill(fs.readFileSync(agentFile, "utf8"));
    if (pa.skill) agents.push(pa.skill);
    else warnings.push(`agent "${name}" is invalid: ${pa.errors[0] ?? "parse error"}`);
  }
  return { skill: res.skill, sourceDir, agents, warnings };
}

/** Convert one loaded skill for one target, writing files under `outRoot`.
 *  `seen` tracks paths written by earlier targets so we can warn on clobbering
 *  (Antigravity and Codex share `.agents/skills/`). */
export function convertTo(
  skill: Skill,
  sourceDir: string,
  target: TargetId,
  outRoot: string,
  seen: Map<string, { source: string; content: string }> = new Map(),
  agents: Skill[] = [],
): ConvertResult {
  const result = CONVERTERS[target](skill, agents);
  const written: string[] = [];
  const copiedDirs: string[] = [];
  const warnings = [...result.warnings];

  if (result.skipped) {
    return { target, skipped: true, skillDir: null, written, copiedDirs, warnings };
  }

  const w = writeOutputFiles(result.files, outRoot, seen, target);
  written.push(...w.written);
  warnings.push(...w.warnings);

  // Copy bundled resource dirs into the emitted skill directory.
  if (result.skillDir) {
    for (const dir of RESOURCE_DIRS) {
      const src = path.join(sourceDir, dir);
      if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
        const dest = path.join(outRoot, result.skillDir, dir);
        fs.cpSync(src, dest, { recursive: true });
        copiedDirs.push(dir);
      }
    }
  }

  return { target, skipped: false, skillDir: result.skillDir, written, copiedDirs, warnings };
}

/** Convert a skill on disk to one or more targets. */
export function convert(
  input: string,
  targets: TargetId[],
  outRoot: string,
): { warnings: string[]; results: ConvertResult[] } {
  const { skill, sourceDir, agents, warnings } = loadSkill(input);
  const seen = new Map<string, { source: string; content: string }>();
  const results = targets.map((t) => convertTo(skill, sourceDir, t, outRoot, seen, agents));
  return { warnings, results };
}

/** Import a native SKILL.md (and optional MCP config) from disk into SkillBridge format. */
export function importFile(input: string, from: SourceHarness | "auto", mcpPath?: string): ImportResult {
  const raw = fs.readFileSync(input, "utf8");
  let mcp;
  if (mcpPath) {
    const text = fs.readFileSync(mcpPath, "utf8");
    mcp = { text, kind: (mcpPath.endsWith(".toml") ? "toml" : "json") as "toml" | "json" };
  }
  return importToSkillBridge(raw, from, mcp);
}

export function parseTargets(arg: string): TargetId[] {
  if (arg === "all") return [...TARGET_IDS];
  const ids = arg.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    if (!(TARGET_IDS as readonly string[]).includes(id)) {
      throw new Error(`Unknown target "${id}". Valid: ${TARGET_IDS.join(", ")}, all.`);
    }
  }
  return ids as TargetId[];
}
