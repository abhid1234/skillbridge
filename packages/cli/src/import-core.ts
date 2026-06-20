/**
 * Browser-safe IMPORT: native harness files -> portable skill.sb.md.
 * The inverse of conversion. Reads a SKILL.md and (optionally) a native MCP
 * config (.mcp.json / mcp_config.json JSON, or config.toml) back into the
 * portable format. Pure functions, no filesystem.
 */
import { parseYaml, stringifyYaml, YamlValue } from "./yaml.js";
import { splitFrontmatter, McpServer } from "./format.js";

export type SourceHarness = "claude-code" | "antigravity" | "codex" | "cursor" | "generic";
export type McpKind = "json" | "toml" | "auto";

export interface McpInput {
  text: string;
  kind?: McpKind;
}

export interface ImportResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  detected: SourceHarness | null;
  sbText?: string; // the generated skill.sb.md
}

// Frontmatter keys that only Claude Code defines — strong signal for detection.
const CLAUDE_HINTS = [
  "allowed-tools", "disallowed-tools", "when_to_use", "disable-model-invocation",
  "user-invocable", "argument-hint", "arguments", "context", "agent", "paths",
  "effort", "model", "hooks", "shell",
];

export function detectHarness(fm: Record<string, YamlValue>): SourceHarness {
  if (Object.keys(fm).some((k) => CLAUDE_HINTS.includes(k))) return "claude-code";
  return "generic"; // Antigravity & Codex carry only name + description — indistinguishable
}

// ---- native MCP parsing (the inverse of the target emitters) ----

/** Parse a native MCP config (JSON or TOML) into the SkillBridge `mcp` map. */
export function parseNativeMcp(text: string, kind: McpKind = "auto"): Record<string, McpServer> {
  const k = kind === "auto" ? (text.trim().startsWith("{") ? "json" : "toml") : kind;
  return k === "json" ? parseJsonMcp(text) : parseTomlMcp(text);
}

function parseJsonMcp(text: string): Record<string, McpServer> {
  const out: Record<string, McpServer> = {};
  let obj: any;
  try { obj = JSON.parse(text); } catch { return out; }
  const servers = obj && obj.mcpServers ? obj.mcpServers : {};
  for (const [name, raw] of Object.entries<any>(servers)) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.command === "string") {
      const s: McpServer = { command: raw.command };
      if (Array.isArray(raw.args)) s.args = raw.args.map(String);
      if (raw.env && typeof raw.env === "object") s.env = { ...raw.env };
      out[name] = s;
    } else {
      const url = raw.url || raw.serverUrl; // Antigravity uses serverUrl
      if (typeof url !== "string") continue;
      const s: McpServer = { url };
      if (raw.headers && typeof raw.headers === "object") s.headers = { ...raw.headers };
      out[name] = s;
    }
  }
  return out;
}

function tomlValue(raw: string): string | string[] | boolean {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[")) {
    return v.slice(1, v.lastIndexOf("]")).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter((x) => x !== "");
  }
  return v.replace(/^["']|["']$/g, "");
}

/** Minimal TOML reader for the `[mcp_servers.*]` subset SkillBridge emits for Codex. */
function parseTomlMcp(text: string): Record<string, McpServer> {
  interface Acc { command?: string; args?: string[]; env: Record<string, string>; url?: string; bearer?: string; headers: Record<string, string>; }
  const acc: Record<string, Acc> = {};
  let section: { name: string; sub: string } | null = null;
  for (const lineRaw of text.split("\n")) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[mcp_servers\.([^\].]+)(?:\.(\w+))?\]$/);
    if (sec) {
      const name = sec[1];
      acc[name] = acc[name] || { env: {}, headers: {} };
      section = { name, sub: sec[2] || "root" };
      continue;
    }
    if (line.startsWith("[")) { section = null; continue; } // unrelated table
    if (!section) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    const val = tomlValue(line.slice(eq + 1));
    const s = acc[section.name];
    if (section.sub === "env") s.env[key] = String(val);
    else if (section.sub === "http_headers") s.headers[key] = String(val);
    else if (key === "command") s.command = String(val);
    else if (key === "args") s.args = Array.isArray(val) ? val : [String(val)];
    else if (key === "url") s.url = String(val);
    else if (key === "bearer_token_env_var") s.bearer = String(val);
  }
  const out: Record<string, McpServer> = {};
  for (const [name, s] of Object.entries(acc)) {
    if (s.command) {
      const srv: McpServer = { command: s.command };
      if (s.args && s.args.length) srv.args = s.args;
      if (Object.keys(s.env).length) srv.env = s.env;
      out[name] = srv;
    } else if (s.url) {
      const headers = { ...s.headers };
      if (s.bearer) headers["Authorization"] = `Bearer \${${s.bearer}}`;
      const srv: McpServer = { url: s.url };
      if (Object.keys(headers).length) srv.headers = headers;
      out[name] = srv;
    }
  }
  return out;
}

export interface AgentImportResult {
  name: string;
  sbText?: string; // the generated agents/<name>.sb.md
  errors: string[];
  warnings: string[];
}

function parseCodexAgentToml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (val.startsWith('"""')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes('"""')) { buf.push(lines[i]); i++; }
      out[key] = buf.join("\n");
    } else {
      out[key] = val.replace(/^"|"$/g, "");
    }
  }
  return out;
}

/** Import a native sub-agent file (Claude `.md` or Codex `.toml`) into a portable agents/<name>.sb.md. */
export function importAgentFile(text: string, kind: "md" | "toml" = "md"): AgentImportResult {
  const warnings: string[] = [];
  if (kind === "toml") {
    const d = parseCodexAgentToml(text);
    const name = d.name ?? "";
    const description = d.description ?? "";
    if (!name || !description) return { name, errors: ["Codex agent .toml missing name or description."], warnings };
    const body = d.developer_instructions ?? "";
    const ordered: Record<string, YamlValue> = { name, description, spec_version: "0.1" };
    if (d.sandbox_mode) ordered.tools = { sandbox: d.sandbox_mode } as YamlValue;
    const extra: Record<string, YamlValue> = {};
    for (const [k, v] of Object.entries(d)) {
      if (!["name", "description", "developer_instructions", "sandbox_mode"].includes(k)) extra[k] = v;
    }
    if (Object.keys(extra).length) ordered.targets = { codex: { frontmatter: extra } } as YamlValue;
    return { name, sbText: `---\n${stringifyYaml(ordered)}---\n\n${body.trim()}\n`, errors: [], warnings };
  }
  const split = splitFrontmatter(text);
  if (!split) return { name: "", errors: ["Agent file has no frontmatter."], warnings };
  let fm: YamlValue;
  try { fm = parseYaml(split.fm); } catch (e) { return { name: "", errors: [`Agent frontmatter YAML error: ${(e as Error).message}`], warnings }; }
  const obj = fm as Record<string, YamlValue>;
  const name = typeof obj.name === "string" ? obj.name : "";
  const description = typeof obj.description === "string" ? obj.description : "";
  if (!name || !description) return { name, errors: ["Agent .md missing name or description."], warnings };
  const extra: Record<string, YamlValue> = {};
  for (const [k, v] of Object.entries(obj)) if (k !== "name" && k !== "description" && v !== undefined) extra[k] = v;
  const ordered: Record<string, YamlValue> = { name, description, spec_version: "0.1" };
  if (Object.keys(extra).length) {
    ordered.targets = { "claude-code": { frontmatter: extra } } as YamlValue;
    warnings.push(`agent "${name}": preserved Claude-specific field(s) [${Object.keys(extra).join(", ")}] under targets.claude-code.frontmatter.`);
  }
  return { name, sbText: `---\n${stringifyYaml(ordered)}---\n\n${split.body.trimEnd()}\n`, errors: [], warnings };
}

/**
 * Convert native harness file(s) into a SkillBridge skill.sb.md string.
 * `from` may force the source harness ("auto" detects it); `mcp` optionally
 * supplies the harness's MCP config so it round-trips into an `mcp:` block.
 */
export function importToSkillBridge(raw: string, from: SourceHarness | "auto" = "auto", mcp?: McpInput): ImportResult {
  const warnings: string[] = [];
  const split = splitFrontmatter(raw);
  if (!split) {
    return { ok: false, errors: ["No frontmatter found — expected a native SKILL.md starting with a '---' YAML block."], warnings, detected: null };
  }
  let fm: YamlValue;
  try {
    fm = parseYaml(split.fm);
  } catch (e) {
    return { ok: false, errors: [`Frontmatter is not valid YAML: ${(e as Error).message}`], warnings, detected: null };
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    return { ok: false, errors: ["Frontmatter must be a YAML mapping."], warnings, detected: null };
  }
  const obj = fm as Record<string, YamlValue>;

  const name = typeof obj.name === "string" ? obj.name : "";
  const description = typeof obj.description === "string" ? obj.description : "";
  const errors: string[] = [];
  if (!name) errors.push("Source SKILL.md has no `name` (required by SkillBridge).");
  if (!description) errors.push("Source SKILL.md has no `description` (required by SkillBridge).");
  if (errors.length) return { ok: false, errors, warnings, detected: null };

  const detected = from === "auto" ? detectHarness(obj) : from;

  // Carry name + description into the portable core; preserve everything else as a
  // harness-specific override so a re-conversion is faithful to the source harness.
  const extra: Record<string, YamlValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "name" || k === "description" || v === undefined) continue;
    extra[k] = v as YamlValue;
  }

  const ordered: Record<string, YamlValue> = { name, description, spec_version: "0.1" };

  // optional native MCP -> `mcp:` block
  if (mcp && mcp.text.trim()) {
    const servers = parseNativeMcp(mcp.text, mcp.kind ?? "auto");
    const count = Object.keys(servers).length;
    if (count) {
      ordered.mcp = servers as unknown as YamlValue;
      warnings.push(`Imported ${count} MCP server(s) from the supplied native config.`);
    } else {
      warnings.push("Supplied MCP config had no recognizable servers; none imported.");
    }
  } else {
    warnings.push("No MCP config supplied — MCP servers live in separate native files (.mcp.json / config.toml). Paste one to import it, or add an `mcp:` block by hand.");
  }

  if (Object.keys(extra).length) {
    const bucket = detected === "generic" ? "claude-code" : detected;
    ordered.targets = { [bucket]: { frontmatter: extra } } as YamlValue;
    if (detected === "generic") {
      warnings.push(`Could not identify the source harness; preserved non-core field(s) [${Object.keys(extra).join(", ")}] under targets.claude-code.frontmatter. If the source was Codex or Antigravity, set the "from" selector.`);
    } else {
      warnings.push(`Preserved ${detected}-specific field(s) [${Object.keys(extra).join(", ")}] under targets.${detected}.frontmatter.`);
    }
  }

  const sbText = `---\n${stringifyYaml(ordered)}---\n\n${split.body.trimEnd()}\n`;
  return { ok: true, errors: [], warnings, detected, sbText };
}
