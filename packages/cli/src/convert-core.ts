/**
 * Browser-safe conversion core — pure functions, NO filesystem.
 * Used by both the Node CLI (which adds file I/O) and the web playground.
 */
import { parseSkill, Skill, TargetId } from "./format.js";
import { OutputFile, TargetOutput } from "./targets/types.js";
import { convertClaudeCode } from "./targets/claude-code.js";
import { convertAntigravity } from "./targets/antigravity.js";
import { convertCodex } from "./targets/codex.js";
import { convertCursor } from "./targets/cursor.js";

export const CONVERTERS: Record<TargetId, (s: Skill, agents?: Skill[]) => TargetOutput> = {
  "claude-code": convertClaudeCode,
  antigravity: convertAntigravity,
  codex: convertCodex,
  cursor: convertCursor,
};

export interface InMemoryTargetResult {
  target: TargetId;
  skipped: boolean;
  skillDir: string | null;
  files: OutputFile[];
  warnings: string[];
}

export interface InMemoryResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  results: InMemoryTargetResult[];
}

/**
 * Parse and convert a raw skill.sb.md string to in-memory native files for each
 * target. Detects collisions across targets that share an output path
 * (Antigravity + Codex both write `.agents/skills/...`).
 */
export function convertString(raw: string, targets: TargetId[], agentTexts: string[] = []): InMemoryResult {
  const parsed = parseSkill(raw);
  if (!parsed.skill) {
    return { ok: false, errors: parsed.errors, warnings: parsed.warnings, results: [] };
  }
  const skill = parsed.skill;
  const warnings: string[] = [...parsed.warnings];
  const agents: Skill[] = [];
  for (const at of agentTexts) {
    const pa = parseSkill(at);
    if (pa.skill) agents.push(pa.skill);
    else warnings.push(`sub-agent failed to parse: ${pa.errors[0] ?? "invalid"}`);
  }
  const seen = new Map<string, { target: TargetId; content: string }>();
  const results: InMemoryTargetResult[] = targets.map((t) => {
    const o = CONVERTERS[t](skill, agents);
    const warnings = [...o.warnings];
    if (!o.skipped) {
      for (const f of o.files) {
        const prev = seen.get(f.path);
        if (prev && prev.content !== f.content) {
          warnings.push(`${f.path}: overwrites the file already produced for "${prev.target}" (shared namespace).`);
        }
        seen.set(f.path, { target: t, content: f.content });
      }
    }
    return { target: t, skipped: o.skipped, skillDir: o.skillDir, files: o.files, warnings };
  });
  return { ok: true, errors: [], warnings, results };
}
