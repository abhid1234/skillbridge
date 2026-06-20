/**
 * Filesystem wrapper for ADOPT (Tier 4). Walks a repo, gathers native skill,
 * MCP, and sub-agent files, hands them to the browser-safe adopt-core, and
 * writes the unified portable sources to disk.
 */
import * as fs from "fs";
import * as path from "path";
import { detectSkillFiles, AdoptResult, RepoFile } from "./adopt-core.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

// Files worth reading during the walk: native SKILL.md, MCP configs, agent files.
const MCP_BASENAMES = new Set([".mcp.json", "mcp_config.json", "config.toml", "mcp.json"]);

function isInteresting(rel: string): boolean {
  const r = rel.replace(/\\/g, "/");
  const base = r.split("/").slice(-1)[0];
  if (/\/SKILL\.md$/i.test(r) || /^SKILL\.md$/i.test(base)) return true;
  if (MCP_BASENAMES.has(base)) return true;
  if (/(?:^|\/)\.claude\/agents\/[^/]+\.md$/i.test(r)) return true;
  if (/(?:^|\/)\.cursor\/agents\/[^/]+\.md$/i.test(r)) return true;
  if (/(?:^|\/)\.codex\/agents\/[^/]+\.toml$/i.test(r)) return true;
  return false;
}

/** Hand-rolled recursive walk; collects relative (forward-slash) paths of interesting files. */
function walk(root: string): RepoFile[] {
  const out: RepoFile[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        stack.push(abs);
      } else if (ent.isFile()) {
        const rel = path.relative(root, abs).replace(/\\/g, "/");
        if (!isInteresting(rel)) continue;
        let content: string;
        try {
          content = fs.readFileSync(abs, "utf8");
        } catch {
          continue;
        }
        out.push({ path: rel, content });
      }
    }
  }
  return out;
}

/** Discover and import every native skill (and sibling MCP/agents) in `repoDir`. */
export function adoptRepo(repoDir: string): AdoptResult {
  const stat = fs.statSync(repoDir);
  if (!stat.isDirectory()) {
    throw new Error(`adopt requires a directory; got "${repoDir}".`);
  }
  const files = walk(repoDir);
  return detectSkillFiles(files);
}

/**
 * Write adopted skills (and agents) to `outDir`, one portable source per skill at
 * <outDir>/<name>/skill.sb.md, agents at <outDir>/<name>/agents or a shared
 * agents/ dir. Returns the list of written relative paths.
 */
export function writeAdopted(results: AdoptResult, outDir: string): { written: string[]; warnings: string[] } {
  const written: string[] = [];
  const warnings: string[] = [...results.warnings];

  for (const sk of results.skills) {
    const dir = path.join(outDir, sk.name);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "skill.sb.md");
    fs.writeFileSync(file, sk.sbText);
    written.push(path.relative(outDir, file).replace(/\\/g, "/"));
    warnings.push(...sk.warnings);
  }

  if (results.agents.length) {
    const agentsDir = path.join(outDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const seen = new Set<string>();
    for (const ag of results.agents) {
      if (!ag.name || seen.has(ag.name)) {
        if (ag.name) warnings.push(`agent "${ag.name}" appears more than once; kept the first (${ag.source}).`);
        continue;
      }
      seen.add(ag.name);
      const file = path.join(agentsDir, `${ag.name}.sb.md`);
      fs.writeFileSync(file, ag.sbText);
      written.push(path.relative(outDir, file).replace(/\\/g, "/"));
      warnings.push(...ag.warnings);
    }
  }

  return { written, warnings };
}
