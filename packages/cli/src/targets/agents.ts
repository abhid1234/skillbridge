/**
 * Sub-agent emitters. A sub-agent is a skill-shaped doc (name + description + body
 * = system prompt) loaded from a sibling `agents/<name>.sb.md` file. Each harness has
 * its own native agent file; Antigravity has none (runtime-only) → handled by a note.
 */
import { Skill } from "../format.js";
import { stringifyYaml, YamlValue } from "../yaml.js";
import { OutputFile, buildSkillMd } from "./types.js";
import { mapClaudePermissions } from "./permissions.js";

export function emitClaudeAgent(agent: Skill): OutputFile {
  const fm = agent.frontmatter;
  const out: Record<string, YamlValue> = { name: fm.name, description: fm.description };
  const perm = mapClaudePermissions(fm.tools);
  if (perm.allowedTools) out.tools = perm.allowedTools; // Claude sub-agents use `tools`, not allowed-tools
  const ov = fm.targets?.["claude-code"]?.frontmatter;
  if (ov) for (const [k, v] of Object.entries(ov)) out[k] = v as YamlValue;
  return { path: `.claude/agents/${fm.name}.md`, content: buildSkillMd(out, agent.body, stringifyYaml) };
}

function tomlStr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export function emitCodexAgent(agent: Skill): { file: OutputFile; warnings: string[] } {
  const fm = agent.frontmatter;
  const warnings: string[] = [];
  let toml = `name = ${tomlStr(fm.name)}\ndescription = ${tomlStr(fm.description)}\n`;
  const body = agent.body.trim().replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  toml += `developer_instructions = """\n${body}\n"""\n`;
  if (fm.tools?.sandbox) toml += `sandbox_mode = ${tomlStr(fm.tools.sandbox)}\n`;
  const ov = fm.targets?.["codex"]?.frontmatter;
  if (ov) for (const [k, v] of Object.entries(ov)) toml += `${k} = ${typeof v === "string" ? tomlStr(v) : JSON.stringify(v)}\n`;
  warnings.push(`agent "${fm.name}": Codex carries the system prompt as developer_instructions; sandbox granularity is coarse.`);
  return { file: { path: `.codex/agents/${fm.name}.toml`, content: toml }, warnings };
}

export function emitCursorAgent(agent: Skill): OutputFile {
  const fm = agent.frontmatter;
  const out: Record<string, YamlValue> = { name: fm.name, description: fm.description };
  const ov = fm.targets?.["cursor"]?.frontmatter;
  if (ov) for (const [k, v] of Object.entries(ov)) out[k] = v as YamlValue;
  return { path: `.cursor/agents/${fm.name}.md`, content: buildSkillMd(out, agent.body, stringifyYaml) };
}

/** Antigravity: no loadable agent file exists; produce a runtime-only note + warning. */
export function antigravityAgentNote(agent: Skill): { line: string; warning: string } {
  return {
    line: `- **${agent.frontmatter.name}** — ${agent.frontmatter.description} (define at runtime via define_subagent/invoke_subagent)`,
    warning: `agent "${agent.frontmatter.name}": Antigravity sub-agents are runtime-only — no file emitted; see SETUP.md for the define_subagent pattern.`,
  };
}
