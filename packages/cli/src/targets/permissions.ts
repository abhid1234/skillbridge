/**
 * Pure mapping of the neutral tools/permissions block to each harness.
 * One source of truth so the lossy warnings stay consistent across targets.
 */
import { ToolsBlock } from "../format.js";

/** Claude Code: tools -> an allowed-tools / `tools` string (sub-agents use `tools`). */
export function mapClaudePermissions(tools?: ToolsBlock): { allowedTools?: string; warnings: string[] } {
  const parts: string[] = [];
  const warnings: string[] = [];
  if (!tools) return { warnings };
  if (tools.filesystem === "read" || tools.filesystem === "write") {
    parts.push("Read", "Grep", "Glob");
    if (tools.filesystem === "write") parts.push("Edit", "Write");
  }
  if (tools.shell === true) parts.push("Bash");
  else if (Array.isArray(tools.shell)) for (const p of tools.shell) parts.push(`Bash(${p.trim()}*)`);
  if (Array.isArray(tools.mcp)) {
    for (const m of tools.mcp) { const [s, t] = m.split("/"); parts.push(t ? `mcp__${s}__${t}` : `mcp__${s}`); }
  } else if (tools.mcp === true) {
    warnings.push("tools.mcp: true can't be enumerated into Claude Code allowed-tools; relying on default permissions.");
  }
  if (tools.network !== undefined) warnings.push("tools.network has no per-skill equivalent in Claude Code; dropped.");
  return { allowedTools: parts.length ? parts.join(", ") : undefined, warnings };
}

/** Codex: approval/sandbox/network -> a config.toml fragment (top-level keys). */
export function mapCodexPermissions(tools?: ToolsBlock): { tomlFragment: string; warnings: string[] } {
  const warnings: string[] = [];
  if (!tools) return { tomlFragment: "", warnings };
  const lines: string[] = [];
  if (tools.approval) lines.push(`approval_policy = "${tools.approval}"`);
  let sandbox = tools.sandbox;
  if (!sandbox && tools.filesystem === "write") sandbox = "workspace-write";
  if (!sandbox && tools.filesystem === "read") sandbox = "read-only";
  if (sandbox) lines.push(`sandbox_mode = "${sandbox}"`);
  let frag = lines.length ? lines.join("\n") + "\n" : "";
  if (tools.network === true || Array.isArray(tools.network)) {
    frag += `\n[sandbox_workspace_write]\nnetwork_access = true\n`;
    if (Array.isArray(tools.network)) warnings.push("tools.network host list isn't expressible in Codex; enabled network access broadly instead.");
  }
  if (Array.isArray(tools.shell)) warnings.push("tools.shell prefix list maps only coarsely to Codex (approval/sandbox, no per-prefix gating).");
  if (tools.paths) warnings.push("tools.paths (glob scoping) has no Codex equivalent; dropped.");
  return { tomlFragment: frag, warnings };
}

/** Antigravity: tools -> action(target) permission-engine lines for SETUP.md. */
export function mapAntigravityPermissions(tools?: ToolsBlock): { setupLines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!tools) return { setupLines: [], warnings };
  const lines: string[] = [];
  if (tools.filesystem === "read" || tools.filesystem === "write") lines.push("read_file(*)");
  if (tools.filesystem === "write") lines.push("write_file(*)");
  if (tools.shell === true) lines.push("command(*)");
  else if (Array.isArray(tools.shell)) for (const p of tools.shell) lines.push(`command(${p.trim()})`);
  if (tools.network === true) lines.push("read_url(*)");
  else if (Array.isArray(tools.network)) for (const h of tools.network) lines.push(`read_url(${h})`);
  if (tools.mcp === true) lines.push("mcp(*)");
  else if (Array.isArray(tools.mcp)) for (const m of tools.mcp) lines.push(`mcp(${m})`);
  if (tools.approval || tools.sandbox) warnings.push("tools.approval/sandbox are Codex concepts; not represented in Antigravity's permission engine.");
  if (tools.paths) warnings.push("tools.paths (glob scoping) has no Antigravity skill equivalent; dropped.");
  return { setupLines: lines, warnings };
}

/** Cursor: gates at the agent/mode level — nothing emitted into the skill file. */
export function mapCursorPermissions(tools?: ToolsBlock): { warnings: string[] } {
  const warnings: string[] = [];
  if (!tools) return { warnings };
  if (tools.filesystem || tools.shell || tools.network || tools.mcp || tools.approval || tools.sandbox) {
    warnings.push("tools: Cursor gates at the agent/mode level, not the skill file; the tools block was not emitted.");
  }
  return { warnings };
}
