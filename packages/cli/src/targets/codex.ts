import { Skill, McpServer } from "../format.js";
import { stringifyYaml, YamlValue } from "../yaml.js";
import { OutputFile, TargetOutput, buildSkillMd } from "./types.js";
import { mapCodexPermissions } from "./permissions.js";
import { hookSetupLines } from "./hooks.js";
import { emitCodexAgent } from "./agents.js";

function tomlStr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function tomlArray(arr: string[]): string {
  return "[" + arr.map(tomlStr).join(", ") + "]";
}

/** Build a Codex config.toml fragment for the skill's MCP servers. */
function codexMcpToml(mcp: Record<string, McpServer>, warnings: string[]): string {
  let hasHttp = false;
  const blocks: string[] = [];
  for (const [name, srv] of Object.entries(mcp)) {
    let block = `[mcp_servers.${name}]\n`;
    if (srv.command) {
      block += `command = ${tomlStr(srv.command)}\n`;
      if (srv.args) block += `args = ${tomlArray(srv.args)}\n`;
      if (srv.env) {
        block += `\n[mcp_servers.${name}.env]\n`;
        for (const [k, v] of Object.entries(srv.env)) block += `${k} = ${tomlStr(v)}\n`;
      }
    } else {
      hasHttp = true;
      block += `url = ${tomlStr(srv.url!)}\n`;
      // Map `Authorization: Bearer ${VAR}` → bearer_token_env_var = "VAR".
      const auth = srv.headers?.["Authorization"] ?? srv.headers?.["authorization"];
      const m = auth?.match(/Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}/);
      if (m) {
        block += `bearer_token_env_var = ${tomlStr(m[1])}\n`;
      } else if (srv.headers) {
        block += `\n[mcp_servers.${name}.http_headers]\n`;
        for (const [k, v] of Object.entries(srv.headers)) block += `${tomlStr(k)} = ${tomlStr(v)}\n`;
      }
    }
    blocks.push(block);
  }
  let header = "";
  if (hasHttp) {
    header = "# HTTP MCP transport requires the experimental rmcp client.\nexperimental_use_rmcp_client = true\n\n";
    warnings.push("mcp: Codex needs `experimental_use_rmcp_client = true` for HTTP servers (emitted into config.toml).");
  }
  return header + blocks.join("\n");
}

export function convertCodex(skill: Skill, agents: Skill[] = []): TargetOutput {
  const fm = skill.frontmatter;
  const override = fm.targets?.["codex"];
  if (override?.skip) {
    return { skillDir: null, files: [], warnings: ["skipped: targets.codex.skip = true"], skipped: true };
  }

  const warnings: string[] = [];
  const skillDir = `.agents/skills/${fm.name}`;

  // Codex skills require name + description.
  const out: Record<string, YamlValue> = { name: fm.name, description: fm.description };
  if (override?.frontmatter) {
    for (const [k, v] of Object.entries(override.frontmatter)) out[k] = v as YamlValue;
  }

  if (fm.args) warnings.push("args: Codex deprecated argument substitution into skills; document the invocation in the body instead. Not emitted.");
  if (fm.hooks) warnings.push("hooks: Codex has no skill-level hooks; see SETUP.md note. Not emitted into the skill.");

  const files: OutputFile[] = [
    { path: `${skillDir}/SKILL.md`, content: buildSkillMd(out, skill.body, stringifyYaml) },
  ];

  // sub-agents → .codex/agents/<name>.toml
  for (const agent of agents) {
    const r = emitCodexAgent(agent);
    files.push(r.file);
    warnings.push(...r.warnings);
  }

  // config.toml: MCP servers + permissions (approval/sandbox). Emit even with no MCP if permissions present.
  const perm = mapCodexPermissions(fm.tools);
  warnings.push(...perm.warnings);
  const hasMcp = fm.mcp && Object.keys(fm.mcp).length > 0;
  if (hasMcp || perm.tomlFragment) {
    let toml = perm.tomlFragment ? perm.tomlFragment + (hasMcp ? "\n" : "") : "";
    if (hasMcp) toml += codexMcpToml(fm.mcp!, warnings);
    files.push({ path: "config.toml", content: toml });
  }

  // hooks → SETUP note
  const hookLines = hookSetupLines(fm.hooks);
  if (hookLines.length) {
    files.push({ path: `${skillDir}/SETUP.codex.md`, content: `# Codex setup for ${fm.name}\n\n## Hooks (configure manually)\n${hookLines.join("\n")}\n` });
  }

  return { skillDir, files, warnings, skipped: false };
}
