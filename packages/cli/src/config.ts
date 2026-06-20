/**
 * SkillBridge project configuration.
 *
 * A `skillbridge.config.json` lives at a project root and tells the `sync` /
 * `check` / `watch` commands which skills to build, which targets to emit, and
 * where to write them. Hand-rolled validation (no deps) in the house style:
 * accumulate problems into errors[]/warnings[] rather than throwing.
 */
import * as fs from "fs";
import * as path from "path";
import { TargetId, TARGET_IDS } from "./format.js";

export const CONFIG_FILENAME = "skillbridge.config.json";

export interface SkillBridgeConfig {
  /** Spec/config version (informational; reserved for forward-compat). */
  version?: string;
  /** Directory (relative to the config dir) holding `<skill>/skill.sb.md`. */
  sourceDir: string;
  /** Targets to emit on sync. */
  targets: TargetId[];
  /** Output root (relative to the config dir) for emitted native files. */
  outDir: string;
  /** Explicit allow-list of skill names to build; omit to build all discovered. */
  skills?: string[];
  /** Skill names to skip during discovery. */
  ignore?: string[];
}

/** Defaults applied when a field is missing from the on-disk config. */
export const DEFAULT_CONFIG: SkillBridgeConfig = {
  sourceDir: "skills",
  targets: [...TARGET_IDS],
  outDir: ".",
};

export interface LoadConfigResult {
  config: SkillBridgeConfig;
  /** Absolute path to the config file that was found. */
  configPath: string;
  /** Absolute directory containing the config file (the project root). */
  configDir: string;
  warnings: string[];
}

/**
 * Walk up from `cwd` looking for `skillbridge.config.json`. Stops at a
 * directory containing `.git` (project boundary) or the filesystem root.
 * Throws a descriptive Error if no config is found or the file is invalid.
 */
export function loadConfig(cwd: string): LoadConfigResult {
  const start = path.resolve(cwd);
  let dir = start;
  let configPath: string | null = null;

  // Walk up to the fs root, stopping after we examine a directory holding .git.
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      configPath = candidate;
      break;
    }
    // Boundary: don't search above a repository root.
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached fs root
    dir = parent;
  }

  if (!configPath) {
    throw new Error(
      `No ${CONFIG_FILENAME} found in ${start} or any parent directory (stopped at repo root). Run "skillbridge init" to create one.`,
    );
  }

  const configDir = path.dirname(configPath);
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (e) {
    throw new Error(`Could not read ${configPath}: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${CONFIG_FILENAME} is not valid JSON: ${(e as Error).message}`);
  }

  const { config, errors, warnings } = validateConfig(parsed);
  if (errors.length > 0) {
    throw new Error(`Invalid ${CONFIG_FILENAME} (${configPath}):\n  - ${errors.join("\n  - ")}`);
  }

  return { config, configPath, configDir, warnings };
}

/**
 * Validate a parsed config object and merge in defaults. Returns the resolved
 * config plus any accumulated errors/warnings (does not throw).
 */
export function validateConfig(input: unknown): {
  config: SkillBridgeConfig;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    errors.push("config must be a JSON object.");
    return { config: { ...DEFAULT_CONFIG }, errors, warnings };
  }
  const obj = input as Record<string, unknown>;

  // version (optional, informational)
  let version: string | undefined;
  if (obj.version !== undefined) {
    if (typeof obj.version !== "string") errors.push("`version` must be a string.");
    else version = obj.version;
  }

  // sourceDir
  let sourceDir = DEFAULT_CONFIG.sourceDir;
  if (obj.sourceDir !== undefined) {
    if (typeof obj.sourceDir !== "string" || obj.sourceDir.trim() === "") {
      errors.push("`sourceDir` must be a non-empty string.");
    } else {
      sourceDir = obj.sourceDir;
    }
  }

  // outDir
  let outDir = DEFAULT_CONFIG.outDir;
  if (obj.outDir !== undefined) {
    if (typeof obj.outDir !== "string" || obj.outDir.trim() === "") {
      errors.push("`outDir` must be a non-empty string.");
    } else {
      outDir = obj.outDir;
    }
  }

  // targets
  let targets: TargetId[] = [...DEFAULT_CONFIG.targets];
  if (obj.targets !== undefined) {
    if (!Array.isArray(obj.targets) || !obj.targets.every((t) => typeof t === "string")) {
      errors.push("`targets` must be an array of target id strings.");
    } else if (obj.targets.length === 0) {
      errors.push("`targets` must list at least one target.");
    } else {
      const valid: TargetId[] = [];
      for (const t of obj.targets as string[]) {
        if ((TARGET_IDS as readonly string[]).includes(t)) {
          valid.push(t as TargetId);
        } else {
          errors.push(`Unknown target "${t}" in \`targets\`. Valid: ${TARGET_IDS.join(", ")}.`);
        }
      }
      if (valid.length > 0) targets = valid;
    }
  }

  // skills (optional allow-list)
  let skills: string[] | undefined;
  if (obj.skills !== undefined) {
    if (!Array.isArray(obj.skills) || !obj.skills.every((s) => typeof s === "string")) {
      errors.push("`skills` must be an array of skill-name strings.");
    } else {
      skills = obj.skills as string[];
    }
  }

  // ignore (optional skip-list)
  let ignore: string[] | undefined;
  if (obj.ignore !== undefined) {
    if (!Array.isArray(obj.ignore) || !obj.ignore.every((s) => typeof s === "string")) {
      errors.push("`ignore` must be an array of skill-name strings.");
    } else {
      ignore = obj.ignore as string[];
    }
  }

  // unknown top-level keys (warn, forward-compat)
  const known = new Set(["version", "sourceDir", "targets", "outDir", "skills", "ignore"]);
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) warnings.push(`Unknown config key "${k}" (ignored; forward-compatible).`);
  }

  const config: SkillBridgeConfig = { sourceDir, targets, outDir };
  if (version !== undefined) config.version = version;
  if (skills !== undefined) config.skills = skills;
  if (ignore !== undefined) config.ignore = ignore;

  return { config, errors, warnings };
}

/**
 * Resolve the set of skill directories to build for a config.
 *
 * If `config.skills` is an explicit list, those are used (each is a skill
 * directory name under `sourceDir`). Otherwise scan `sourceDir` for immediate
 * subdirectories that contain a `skill.sb.md`. Names in `config.ignore` are
 * always excluded. Returns absolute paths to the skill directories, sorted for
 * deterministic ordering.
 */
export function discoverSkills(config: SkillBridgeConfig, configDir: string): string[] {
  const sourceRoot = path.resolve(configDir, config.sourceDir);
  const ignore = new Set(config.ignore ?? []);

  let names: string[];
  if (config.skills && config.skills.length > 0) {
    names = config.skills.slice();
  } else {
    if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
      return [];
    }
    names = [];
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(sourceRoot, entry.name, "skill.sb.md");
      if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
        names.push(entry.name);
      }
    }
  }

  const dirs = names
    .filter((n) => !ignore.has(n))
    .map((n) => path.resolve(sourceRoot, n));

  // de-dup + sort for deterministic plans
  return Array.from(new Set(dirs)).sort();
}
