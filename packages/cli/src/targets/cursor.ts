import { Skill, McpServer } from "../format.js";
import { stringifyYaml, YamlValue } from "../yaml.js";
import { OutputFile, TargetOutput, buildSkillMd } from "./types.js";
import { mapCursorPermissions } from "./permissions.js";
import { emitCursorAgent } from "./agents.js";

// Cursor (v2.4+) has native Agent Skills at .cursor/skills/<name>/SKILL.md with the
// same name+description frontmatter family. MCP lives in .cursor/mcp.json (mcpServers,
// no `type` field — Cursor infers transport from command vs url).
function cursorMcpEntry(srv: McpServer): Record<string, unknown> {
  if (srv.command) {
    const e: Record<string, unknown> = { command: srv.command };
    if (srv.args) e.args = srv.args;
    if (srv.env) e.env = srv.env;
    return e;
  }
  const e: Record<string, unknown> = { url: srv.url };
  if (srv.headers) e.headers = srv.headers;
  return e;
}

export function convertCursor(skill: Skill, agents: Skill[] = []): TargetOutput {
  const fm = skill.frontmatter;
  const override = fm.targets?.["cursor"];
  if (override?.skip) {
    return { skillDir: null, files: [], warnings: ["skipped: targets.cursor.skip = true"], skipped: true };
  }

  const warnings: string[] = [];
  const skillDir = `.cursor/skills/${fm.name}`;

  // Cursor Agent Skills carry name + description (+ optional paths, disable-model-invocation).
  const out: Record<string, YamlValue> = { name: fm.name, description: fm.description };
  if (fm.tools?.paths) out.paths = fm.tools.paths;
  if (fm.args?.model_invocable === false) out["disable-model-invocation"] = true;
  if (fm.args?.hint || fm.args?.spec) warnings.push("args.hint/spec: Cursor skills have no argument-hint/arguments; not emitted (model_invocable is honored).");
  if (fm.hooks) warnings.push("hooks: Cursor has no skill-level hooks; not emitted.");
  warnings.push(...mapCursorPermissions(fm.tools).warnings);
  if (override?.frontmatter) {
    for (const [k, v] of Object.entries(override.frontmatter)) out[k] = v as YamlValue;
  }

  const files: OutputFile[] = [
    { path: `${skillDir}/SKILL.md`, content: buildSkillMd(out, skill.body, stringifyYaml) },
  ];

  // sub-agents → .cursor/agents/<name>.md
  for (const agent of agents) files.push(emitCursorAgent(agent));

  // MCP → .cursor/mcp.json (same mcpServers shape as Claude, minus the `type` field).
  if (fm.mcp && Object.keys(fm.mcp).length > 0) {
    const mcpServers: Record<string, unknown> = {};
    for (const [name, srv] of Object.entries(fm.mcp)) mcpServers[name] = cursorMcpEntry(srv);
    files.push({ path: ".cursor/mcp.json", content: JSON.stringify({ mcpServers }, null, 2) + "\n" });
  }

  return { skillDir, files, warnings, skipped: false };
}
