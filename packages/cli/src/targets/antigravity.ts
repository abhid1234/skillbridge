import { Skill, McpServer } from "../format.js";
import { stringifyYaml, YamlValue } from "../yaml.js";
import { OutputFile, TargetOutput, buildSkillMd } from "./types.js";
import { mapAntigravityPermissions } from "./permissions.js";
import { hookSetupLines } from "./hooks.js";
import { antigravityAgentNote } from "./agents.js";

function antigravityMcpEntry(srv: McpServer, name: string, warnings: string[]): Record<string, unknown> {
  if (srv.command) {
    const e: Record<string, unknown> = { command: srv.command };
    if (srv.args) e.args = srv.args;
    if (srv.env) {
      e.env = srv.env;
      warnings.push(`mcp.${name}: Antigravity's env-var substitution has been unreliable in preview — verify the value of any \${VAR} after conversion.`);
    }
    return e;
  }
  // HTTP: Antigravity uses `serverUrl` (renamed from httpUrl).
  const e: Record<string, unknown> = { serverUrl: srv.url };
  if (srv.headers) e.headers = srv.headers;
  return e;
}

export function convertAntigravity(skill: Skill, agents: Skill[] = []): TargetOutput {
  const fm = skill.frontmatter;
  const override = fm.targets?.["antigravity"];
  if (override?.skip) {
    return { skillDir: null, files: [], warnings: ["skipped: targets.antigravity.skip = true"], skipped: true };
  }

  const warnings: string[] = [];
  const skillDir = `.agents/skills/${fm.name}`;

  // Antigravity skills officially carry only name + description.
  const out: Record<string, YamlValue> = { name: fm.name, description: fm.description };
  if (override?.frontmatter) {
    for (const [k, v] of Object.entries(override.frontmatter)) out[k] = v as YamlValue;
  }

  const files: OutputFile[] = [
    { path: `${skillDir}/SKILL.md`, content: buildSkillMd(out, skill.body, stringifyYaml) },
  ];

  // Everything Antigravity can't carry in-skill goes into a SETUP.md sidecar (honest, visible).
  const setup: string[] = [];
  const perm = mapAntigravityPermissions(fm.tools);
  warnings.push(...perm.warnings);
  if (perm.setupLines.length) {
    warnings.push("tools: Antigravity gates via its permission engine (action(target)), not the skill file — emitted to SETUP.md.");
    setup.push("## Permissions (configure in Antigravity's permission engine)", ...perm.setupLines.map((l) => `- ${l}`), "");
  }
  for (const agent of agents) {
    const note = antigravityAgentNote(agent);
    warnings.push(note.warning);
    setup.push("## Sub-agents (runtime-only — define via define_subagent)", note.line, "");
  }
  const hookLines = hookSetupLines(fm.hooks);
  if (hookLines.length) setup.push("## Hooks (no skill-level support — wire manually)", ...hookLines, "");
  if (fm.args) warnings.push("args: Antigravity uses workflows for slash/args, not skills; document in the body. Not emitted.");
  if (setup.length) {
    files.push({ path: `${skillDir}/SETUP.antigravity.md`, content: `# Antigravity setup for ${fm.name}\n\nThings SkillBridge could not carry inside the Antigravity skill file:\n\n${setup.join("\n")}` });
  }

  // MCP → mcp_config.json (merge into ~/.gemini/config/mcp_config.json).
  if (fm.mcp && Object.keys(fm.mcp).length > 0) {
    const mcpServers: Record<string, unknown> = {};
    for (const [name, srv] of Object.entries(fm.mcp)) mcpServers[name] = antigravityMcpEntry(srv, name, warnings);
    files.push({ path: "mcp_config.json", content: JSON.stringify({ mcpServers }, null, 2) + "\n" });
  }

  return { skillDir, files, warnings, skipped: false };
}
