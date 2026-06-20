/**
 * Project-level build pipeline: plan/run/check/watch a whole `skills/` tree.
 *
 * planSync computes the expected native files for every discovered skill,
 * keyed by absolute output path. runSync writes that plan to disk (reusing the
 * one write path from convert.ts — no duplicated I/O). checkDrift compares the
 * plan against what's on disk. watchSync rebuilds on source changes.
 */
import * as fs from "fs";
import * as path from "path";
import { TargetId } from "./format.js";
import { SkillBridgeConfig, discoverSkills } from "./config.js";
import {
  loadSkill,
  writeOutputFiles,
  RESOURCE_DIRS,
} from "./convert.js";
import { CONVERTERS } from "./convert-core.js";

/** A skill that contributes resource dirs to copy after writing files. */
interface ResourceCopy {
  /** Absolute source dir (the skill folder). */
  sourceDir: string;
  /** Absolute destination skill dir under outRoot. */
  destSkillDir: string;
}

export interface SyncPlan {
  /** Output root (absolute) all files live under. */
  outRoot: string;
  /** Expected file content keyed by absolute output path. */
  files: Map<string, string>;
  /** Resource directories to copy (scripts/references/assets). */
  resources: ResourceCopy[];
  /** Skill dirs (absolute) that were planned. */
  skills: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Compute the expected outputs for every discovered skill, without touching
 * disk for the conversion itself. Uses loadSkill (so bundled agents + resource
 * dirs are resolved) and the in-memory CONVERTERS to derive each target's files.
 * Cross-skill / cross-target collisions on a shared absolute path are surfaced
 * as warnings (same policy as the single-skill convert path).
 */
export function planSync(config: SkillBridgeConfig, configDir: string): SyncPlan {
  const outRoot = path.resolve(configDir, config.outDir);
  const files = new Map<string, string>();
  const resources: ResourceCopy[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const skillDirs = discoverSkills(config, configDir);
  if (skillDirs.length === 0) {
    warnings.push(
      `No skills found under "${config.sourceDir}". Add a <name>/skill.sb.md or set "skills" in the config.`,
    );
  }

  // Track which source produced each path so collisions are reported clearly.
  const source = new Map<string, string>();

  for (const skillDir of skillDirs) {
    let loaded;
    try {
      loaded = loadSkill(skillDir);
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }
    warnings.push(...loaded.warnings);

    for (const target of config.targets) {
      const out = CONVERTERS[target as TargetId](loaded.skill, loaded.agents);
      warnings.push(...out.warnings);
      if (out.skipped) continue;

      for (const f of out.files) {
        const abs = path.join(outRoot, f.path);
        const prev = files.get(abs);
        if (prev !== undefined && prev !== f.content) {
          warnings.push(
            `${f.path}: output overwrites the file already produced by "${source.get(abs)}" (shared namespace). Use a separate outDir if you need both.`,
          );
        }
        files.set(abs, f.content);
        source.set(abs, `${path.basename(skillDir)}:${target}`);
      }

      // Plan resource-dir copies for skills that emit a skill dir.
      if (out.skillDir) {
        for (const dir of RESOURCE_DIRS) {
          const src = path.join(loaded.sourceDir, dir);
          if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
            resources.push({
              sourceDir: src,
              destSkillDir: path.join(outRoot, out.skillDir, dir),
            });
          }
        }
      }
    }
  }

  return { outRoot, files, resources, skills: skillDirs, warnings, errors };
}

export interface RunSyncResult {
  written: string[];
  copiedDirs: string[];
  warnings: string[];
  dryRun: boolean;
}

/**
 * Materialize a plan to disk. With { dryRun: true } nothing is written; the
 * would-be paths are reported instead. Reuses writeOutputFiles (the single
 * write path) and fs.cpSync for resource dirs.
 */
export function runSync(plan: SyncPlan, opts: { dryRun?: boolean } = {}): RunSyncResult {
  const dryRun = opts.dryRun === true;
  const warnings: string[] = [];
  const written: string[] = [];
  const copiedDirs: string[] = [];

  if (dryRun) {
    for (const abs of plan.files.keys()) written.push(path.relative(plan.outRoot, abs));
    for (const r of plan.resources) copiedDirs.push(path.relative(plan.outRoot, r.destSkillDir));
    written.sort();
    copiedDirs.sort();
    return { written, copiedDirs, warnings, dryRun };
  }

  // writeOutputFiles expects OutputFile[] with paths relative to a root; feed
  // it absolute paths against root "" so it writes exactly where planned.
  const out = writeOutputFiles(
    Array.from(plan.files.entries()).map(([abs, content]) => ({ path: abs, content })),
    "",
  );
  written.push(...out.written.map((p) => path.relative(plan.outRoot, p)));
  warnings.push(...out.warnings);

  for (const r of plan.resources) {
    fs.cpSync(r.sourceDir, r.destSkillDir, { recursive: true });
    copiedDirs.push(path.relative(plan.outRoot, r.destSkillDir));
  }

  return { written, copiedDirs, warnings, dryRun };
}

export interface DriftResult {
  inSync: boolean;
  /** Paths (relative to outRoot) whose on-disk bytes differ from the plan. */
  drifted: string[];
  /** Paths (relative to outRoot) that the plan expects but are absent on disk. */
  missing: string[];
}

/**
 * Compare expected (planned) file bytes against what's on disk. Resource-dir
 * copies are out of scope here (binary/arbitrary trees); we check the generated
 * native files, which is what drift in source most commonly affects.
 */
export function checkDrift(plan: SyncPlan): DriftResult {
  const drifted: string[] = [];
  const missing: string[] = [];

  for (const [abs, expected] of plan.files) {
    const rel = path.relative(plan.outRoot, abs);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const actual = fs.readFileSync(abs, "utf8");
    if (actual !== expected) drifted.push(rel);
  }

  drifted.sort();
  missing.sort();
  return { inSync: drifted.length === 0 && missing.length === 0, drifted, missing };
}

export interface Watcher {
  /** Stop watching and release all fs watchers/timers. */
  close(): void;
}

/**
 * Watch the source tree and rebuild on change. Uses a single recursive
 * fs.watch where the platform supports it (macOS/Windows), falling back to
 * per-directory watchers elsewhere (Linux). Changes are debounced 100ms and
 * coalesced into one onRebuild call carrying the fresh plan.
 */
export function watchSync(
  config: SkillBridgeConfig,
  configDir: string,
  onRebuild: (plan: SyncPlan) => void,
): Watcher {
  const sourceRoot = path.resolve(configDir, config.sourceDir);
  const watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const rebuild = (): void => {
    if (closed) return;
    timer = null;
    let plan: SyncPlan;
    try {
      plan = planSync(config, configDir);
    } catch (e) {
      plan = {
        outRoot: path.resolve(configDir, config.outDir),
        files: new Map(),
        resources: [],
        skills: [],
        warnings: [],
        errors: [(e as Error).message],
      };
    }
    onRebuild(plan);
  };

  const schedule = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  };

  if (fs.existsSync(sourceRoot) && fs.statSync(sourceRoot).isDirectory()) {
    let recursiveOk = false;
    try {
      watchers.push(fs.watch(sourceRoot, { recursive: true }, schedule));
      recursiveOk = true;
    } catch {
      recursiveOk = false;
    }
    if (!recursiveOk) {
      // Fallback: watch the root and each subdirectory individually.
      try {
        watchers.push(fs.watch(sourceRoot, schedule));
      } catch {
        /* ignore */
      }
      for (const dir of listDirsRecursive(sourceRoot)) {
        try {
          watchers.push(fs.watch(dir, schedule));
        } catch {
          /* a dir may vanish between listing and watching; ignore */
        }
      }
    }
  }

  return {
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Depth-first list of all directories under `root` (including `root`). */
function listDirsRecursive(root: string): string[] {
  const out: string[] = [root];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) out.push(...listDirsRecursive(path.join(root, e.name)));
  }
  return out;
}
