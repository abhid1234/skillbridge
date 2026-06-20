/**
 * SkillBridge format: types, parser, and validator for `skill.sb.md`.
 * See docs/spec.md (v0.1) for the authoritative field reference.
 */
import { parseYaml, YamlValue } from "./yaml.js";

export const SPEC_VERSION = "0.1";
export const TARGET_IDS = ["claude-code", "antigravity", "codex", "cursor"] as const;
export type TargetId = (typeof TARGET_IDS)[number];

export interface McpServer {
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http transport
  url?: string;
  headers?: Record<string, string>;
}

export interface ToolsBlock {
  filesystem?: "read" | "write" | "none";
  shell?: boolean | string[];
  network?: boolean | string[];
  mcp?: boolean | string[];
  // extended (richer-but-honest) permissions
  approval?: "untrusted" | "on-request" | "never";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  paths?: string[];
}

/** Slash-command / argument semantics. */
export interface ArgsBlock {
  hint?: string; // argument-hint
  spec?: string[]; // named positional arguments
  model_invocable?: boolean; // false => disable model auto-invocation
}

export type HooksBlock = Record<string, string | string[]>;

export interface TargetOverride {
  frontmatter?: Record<string, YamlValue>;
  skip?: boolean;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  spec_version?: string;
  version?: string;
  license?: string;
  author?: string;
  homepage?: string;
  keywords?: string[];
  tools?: ToolsBlock;
  mcp?: Record<string, McpServer>;
  agents?: string[]; // names of sibling sub-agent files: <skill>/agents/<name>.sb.md
  args?: ArgsBlock;
  hooks?: HooksBlock;
  scripts?: string[]; // declared executable entrypoints under scripts/
  targets?: Partial<Record<TargetId, TargetOverride>>;
}

export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
}

export interface ParseResult {
  skill?: Skill;
  errors: string[];
  warnings: string[];
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Split a `skill.sb.md` file into frontmatter (YAML) and markdown body. */
export function splitFrontmatter(raw: string): { fm: string; body: string } | null {
  // Tolerate a leading BOM / whitespace then `---`.
  const text = raw.replace(/^﻿/, "");
  const m = text.match(/^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/);
  if (!m) return null;
  return { fm: m[1], body: (m[2] ?? "").replace(/^\n+/, "") };
}

/** Parse and validate a raw `skill.sb.md` string. */
export function parseSkill(raw: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const split = splitFrontmatter(raw);
  if (!split) {
    return { errors: ["No YAML frontmatter found. A skill.sb.md must start with a '---' delimited block."], warnings };
  }

  let fm: YamlValue;
  try {
    fm = parseYaml(split.fm);
  } catch (e) {
    return { errors: [`Frontmatter is not valid YAML: ${(e as Error).message}`], warnings };
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    return { errors: ["Frontmatter must be a YAML mapping."], warnings };
  }
  const obj = fm as Record<string, YamlValue>;

  // --- Core ---
  if (typeof obj.name !== "string" || obj.name === "") {
    errors.push("`name` is required and must be a string.");
  } else if (!NAME_RE.test(obj.name)) {
    errors.push(`\`name\` must be lowercase kebab-case (matching ${NAME_RE}). Got: "${obj.name}".`);
  } else if (obj.name.length > 64) {
    errors.push("`name` must be ≤ 64 characters.");
  }
  if (typeof obj.description !== "string" || obj.description.trim() === "") {
    errors.push("`description` is required and must be a non-empty string.");
  } else if (obj.description.length > 1024) {
    warnings.push(`\`description\` is ${obj.description.length} chars; recommended ≤ 1024 (Claude Code truncates combined description near 1,536).`);
  }

  // --- spec_version ---
  if (obj.spec_version !== undefined) {
    if (typeof obj.spec_version !== "string") {
      errors.push("`spec_version` must be a string.");
    } else if (obj.spec_version !== SPEC_VERSION) {
      warnings.push(`Skill targets spec_version "${obj.spec_version}" but this converter implements "${SPEC_VERSION}".`);
    }
  }

  // --- tools ---
  if (obj.tools !== undefined) validateTools(obj.tools, errors);

  // --- mcp ---
  if (obj.mcp !== undefined) validateMcp(obj.mcp, errors);

  // --- agents / args / hooks / scripts ---
  if (obj.agents !== undefined) validateAgents(obj.agents, errors);
  if (obj.args !== undefined) validateArgs(obj.args, errors);
  if (obj.hooks !== undefined) validateHooks(obj.hooks, errors);
  if (obj.scripts !== undefined) validateScripts(obj.scripts, errors);

  // --- targets ---
  if (obj.targets !== undefined) validateTargets(obj.targets, errors);

  // --- unknown top-level keys (warn, forward-compat) ---
  const known = new Set([
    "name", "description", "spec_version", "version", "license",
    "author", "homepage", "keywords", "tools", "mcp",
    "agents", "args", "hooks", "scripts", "targets",
  ]);
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) warnings.push(`Unknown frontmatter key "${k}" (ignored; forward-compatible).`);
  }

  if (errors.length > 0) return { errors, warnings };
  return { skill: { frontmatter: obj as unknown as SkillFrontmatter, body: split.body }, errors, warnings };
}

function validateTools(tools: YamlValue, errors: string[]): void {
  if (tools === null || typeof tools !== "object" || Array.isArray(tools)) {
    errors.push("`tools` must be a mapping.");
    return;
  }
  const t = tools as Record<string, YamlValue>;
  if (t.filesystem !== undefined && !["read", "write", "none"].includes(String(t.filesystem))) {
    errors.push('`tools.filesystem` must be one of "read", "write", "none".');
  }
  for (const key of ["shell", "network", "mcp"] as const) {
    const v = t[key];
    if (v === undefined) continue;
    const ok = typeof v === "boolean" || (Array.isArray(v) && v.every((e) => typeof e === "string"));
    if (!ok) errors.push(`\`tools.${key}\` must be a boolean or an array of strings.`);
  }
  if (t.approval !== undefined && !["untrusted", "on-request", "never"].includes(String(t.approval))) {
    errors.push('`tools.approval` must be one of "untrusted", "on-request", "never".');
  }
  if (t.sandbox !== undefined && !["read-only", "workspace-write", "danger-full-access"].includes(String(t.sandbox))) {
    errors.push('`tools.sandbox` must be one of "read-only", "workspace-write", "danger-full-access".');
  }
  if (t.paths !== undefined && !(Array.isArray(t.paths) && t.paths.every((p) => typeof p === "string"))) {
    errors.push("`tools.paths` must be an array of strings.");
  }
}

function validateAgents(agents: YamlValue, errors: string[]): void {
  if (!Array.isArray(agents) || !agents.every((a) => typeof a === "string")) {
    errors.push("`agents` must be an array of sub-agent names (strings); each resolves to agents/<name>.sb.md.");
    return;
  }
  for (const a of agents) {
    if (!NAME_RE.test(a as string)) errors.push(`agent name "${a}" must be lowercase kebab-case (matching ${NAME_RE}).`);
  }
}

function validateArgs(args: YamlValue, errors: string[]): void {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    errors.push("`args` must be a mapping.");
    return;
  }
  const a = args as Record<string, YamlValue>;
  if (a.hint !== undefined && typeof a.hint !== "string") errors.push("`args.hint` must be a string.");
  if (a.spec !== undefined && !(Array.isArray(a.spec) && a.spec.every((s) => typeof s === "string"))) {
    errors.push("`args.spec` must be an array of strings.");
  }
  if (a.model_invocable !== undefined && typeof a.model_invocable !== "boolean") {
    errors.push("`args.model_invocable` must be a boolean.");
  }
}

function validateHooks(hooks: YamlValue, errors: string[]): void {
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
    errors.push("`hooks` must be a mapping of hook-name to command(s).");
    return;
  }
  for (const [k, v] of Object.entries(hooks as Record<string, YamlValue>)) {
    const ok = typeof v === "string" || (Array.isArray(v) && v.every((e) => typeof e === "string"));
    if (!ok) errors.push(`\`hooks.${k}\` must be a command string or an array of command strings.`);
  }
}

function validateScripts(scripts: YamlValue, errors: string[]): void {
  if (!Array.isArray(scripts) || !scripts.every((s) => typeof s === "string")) {
    errors.push("`scripts` must be an array of file paths (strings) under scripts/.");
  }
}

function validateMcp(mcp: YamlValue, errors: string[]): void {
  if (mcp === null || typeof mcp !== "object" || Array.isArray(mcp)) {
    errors.push("`mcp` must be a mapping of server-name to server config.");
    return;
  }
  for (const [name, srvRaw] of Object.entries(mcp as Record<string, YamlValue>)) {
    if (srvRaw === null || typeof srvRaw !== "object" || Array.isArray(srvRaw)) {
      errors.push(`\`mcp.${name}\` must be a mapping.`);
      continue;
    }
    const srv = srvRaw as Record<string, YamlValue>;
    const hasCommand = typeof srv.command === "string";
    const hasUrl = typeof srv.url === "string";
    if (hasCommand && hasUrl) {
      errors.push(`\`mcp.${name}\` has both \`command\` and \`url\`; specify exactly one transport.`);
    } else if (!hasCommand && !hasUrl) {
      errors.push(`\`mcp.${name}\` must specify either \`command\` (stdio) or \`url\` (http).`);
    }
    if (srv.args !== undefined && !(Array.isArray(srv.args) && srv.args.every((a) => typeof a === "string" || typeof a === "number"))) {
      errors.push(`\`mcp.${name}.args\` must be an array of strings.`);
    }
  }
}

function validateTargets(targets: YamlValue, errors: string[]): void {
  if (targets === null || typeof targets !== "object" || Array.isArray(targets)) {
    errors.push("`targets` must be a mapping.");
    return;
  }
  for (const [id, ovRaw] of Object.entries(targets as Record<string, YamlValue>)) {
    if (!(TARGET_IDS as readonly string[]).includes(id)) {
      errors.push(`Unknown target "${id}" in \`targets\`. Known: ${TARGET_IDS.join(", ")}.`);
      continue;
    }
    if (ovRaw === null || typeof ovRaw !== "object" || Array.isArray(ovRaw)) {
      errors.push(`\`targets.${id}\` must be a mapping.`);
      continue;
    }
    const ov = ovRaw as Record<string, YamlValue>;
    if (ov.frontmatter !== undefined && (ov.frontmatter === null || typeof ov.frontmatter !== "object" || Array.isArray(ov.frontmatter))) {
      errors.push(`\`targets.${id}.frontmatter\` must be a mapping.`);
    }
    if (ov.skip !== undefined && typeof ov.skip !== "boolean") {
      errors.push(`\`targets.${id}.skip\` must be a boolean.`);
    }
  }
}
