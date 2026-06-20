import { Skill, McpServer } from "../format.js";
import { stringifyYaml, YamlValue } from "../yaml.js";
import { OutputFile, TargetOutput, buildSkillMd } from "./types.js";
import { mapClaudePermissions } from "./permissions.js";
import { claudeHooks } from "./hooks.js";
import { emitClaudeAgent } from "./agents.js";

function claudeMcpEntry(srv: McpServer): Record<string, YamlValue> {
  if (srv.command) {
    const e: Record<string, YamlValue> = { type: "stdio", command: srv.command };
    if (srv.args) e.args = srv.args;
    if (srv.env) e.env = srv.env;
    return e;
  }
  const e: Record<string, YamlValue> = { type: "http", url: srv.url! };
  if (srv.headers) e.headers = srv.headers;
  return e;
}

export function convertClaudeCode(skill: Skill, agents: Skill[] = []): TargetOutput {
  const fm = skill.frontmatter;
  const override = fm.targets?.["claude-code"];
  if (override?.skip) {
    return { skillDir: null, files: [], warnings: ["skipped: targets.claude-code.skip = true"], skipped: true };
  }

  const warnings: string[] = [];
  const skillDir = `.claude/skills/${fm.name}`;

  const out: Record<string, YamlValue> = { name: fm.name, description: fm.description };
  const perm = mapClaudePermissions(fm.tools);
  warnings.push(...perm.warnings);
  if (perm.allowedTools) out["allowed-tools"] = perm.allowedTools;
  if (fm.tools?.paths) out.paths = fm.tools.paths;
  // args / slash semantics (Claude native)
  if (fm.args?.hint) out["argument-hint"] = fm.args.hint;
  if (fm.args?.spec) out.arguments = fm.args.spec;
  if (fm.args?.model_invocable === false) out["disable-model-invocation"] = true;
  // hooks (Claude native)
  const hooks = claudeHooks(fm.hooks);
  if (hooks) out.hooks = hooks;
  // verbatim per-target overrides win last
  if (override?.frontmatter) {
    for (const [k, v] of Object.entries(override.frontmatter)) out[k] = v as YamlValue;
  }

  const files: OutputFile[] = [
    { path: `${skillDir}/SKILL.md`, content: buildSkillMd(out, skill.body, stringifyYaml) },
  ];

  // sub-agents → .claude/agents/<name>.md
  for (const agent of agents) files.push(emitClaudeAgent(agent));

  // MCP → .mcp.json (project scope)
  if (fm.mcp && Object.keys(fm.mcp).length > 0) {
    const mcpServers: Record<string, unknown> = {};
    for (const [name, srv] of Object.entries(fm.mcp)) mcpServers[name] = claudeMcpEntry(srv);
    files.push({ path: ".mcp.json", content: JSON.stringify({ mcpServers }, null, 2) + "\n" });
  }

  return { skillDir, files, warnings, skipped: false };
}
