/**
 * Browser-safe skill "doctor" — pure functions, NO filesystem.
 *
 * diagnose(raw) runs convertString across every target, folds the lossy
 * conversion warnings into structured findings, and layers on a handful of
 * static rules transcribed from the lossy conversion model (things the
 * converters silently drop or caveat). Each finding may carry a machine-
 * applicable `fix(raw)` that returns a corrected `skill.sb.md` string which
 * re-parses with zero errors.
 *
 * Shares the convert/parse public API; adds no new runtime dependencies.
 */
import { parseSkill, TARGET_IDS, TargetId, ToolsBlock, ArgsBlock } from "./format.js";
import { convertString } from "./convert-core.js";
import { splitFrontmatter } from "./format.js";
import { parseYaml, stringifyYaml, YamlValue } from "./yaml.js";

export type FindingLevel = "info" | "warn";

export interface Finding {
  level: FindingLevel;
  message: string;
  /** Optional source: target id this finding came from, or "static". */
  source?: TargetId | "static";
  /** Returns a corrected skill.sb.md string, or null if not auto-applicable. */
  fix?: (raw: string) => string | null;
}

export interface DoctorReport {
  ok: boolean;
  /** Parse errors (if the skill doesn't even parse, findings will be empty). */
  errors: string[];
  findings: Finding[];
}

// --------------------------------------------------------------------------
// Frontmatter rewrite helpers (used by fixes). The frontmatter parses with the
// SkillBridge YAML subset, we mutate the plain object, then re-stringify.
// --------------------------------------------------------------------------

type FmObject = Record<string, YamlValue>;

function loadFm(raw: string): { fm: FmObject; body: string } | null {
  const split = splitFrontmatter(raw);
  if (!split) return null;
  let parsed: YamlValue;
  try {
    parsed = parseYaml(split.fm);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return { fm: parsed as FmObject, body: split.body };
}

function rebuild(fm: FmObject, body: string): string {
  return `---\n${stringifyYaml(fm)}---\n\n${body.trimEnd()}\n`;
}

/** Get (creating if needed) targets.<id>.frontmatter as a plain object. */
function targetFrontmatter(fm: FmObject, id: TargetId): FmObject {
  let targets = fm.targets;
  if (targets === null || typeof targets !== "object" || Array.isArray(targets)) {
    targets = {};
    fm.targets = targets;
  }
  const t = targets as FmObject;
  let ov = t[id];
  if (ov === null || typeof ov !== "object" || Array.isArray(ov)) {
    ov = {};
    t[id] = ov;
  }
  const o = ov as FmObject;
  let frontmatter = o.frontmatter;
  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    frontmatter = {};
    o.frontmatter = frontmatter;
  }
  return frontmatter as FmObject;
}

function deleteToolsKey(fm: FmObject, key: keyof ToolsBlock): void {
  const tools = fm.tools;
  if (tools === null || typeof tools !== "object" || Array.isArray(tools)) return;
  delete (tools as FmObject)[key as string];
  if (Object.keys(tools as FmObject).length === 0) delete fm.tools;
}

// --------------------------------------------------------------------------
// diagnose
// --------------------------------------------------------------------------

export function diagnose(raw: string): DoctorReport {
  const parsed = parseSkill(raw);
  if (!parsed.skill) {
    return { ok: false, errors: parsed.errors, findings: [] };
  }
  const fm = parsed.skill.frontmatter;
  const findings: Finding[] = [];

  // -- parse-time warnings (e.g. long description, spec_version drift) --
  for (const w of parsed.warnings) {
    findings.push({ level: "warn", message: w, source: "static" });
  }

  // -- conversion warnings across all targets --
  const conv = convertString(raw, TARGET_IDS as unknown as TargetId[]);
  for (const r of conv.results) {
    for (const w of r.warnings) {
      findings.push({ level: "warn", message: `[${r.target}] ${w}`, source: r.target });
    }
  }

  // -- static rules transcribed from the lossy model --
  staticRules(fm.tools, fm.args, findings);

  return { ok: true, errors: [], findings };
}

/**
 * Static, fix-bearing rules mirroring the lossy conversion model. These overlap
 * intentionally with converter warnings but additionally attach machine fixes.
 */
function staticRules(tools: ToolsBlock | undefined, args: ArgsBlock | undefined, findings: Finding[]): void {
  // args.model_invocable — the "disable model invocation" knob is honored by
  // Claude Code and Cursor but is a no-op on Antigravity/Codex (they treat the
  // whole args block as lossy). Flag it as a Claude/Cursor-only field; the fix
  // scopes it under targets so cross-harness conversion stops dropping it.
  if (args?.model_invocable !== undefined) {
    findings.push({
      level: "warn",
      message:
        "args.model_invocable (model auto-invocation control) is only honored by Claude Code and Cursor; " +
        "Antigravity and Codex drop the args block entirely. Scope it under targets.<harness>.frontmatter.",
      source: "static",
      fix(raw) {
        const loaded = loadFm(raw);
        if (!loaded) return null;
        const a = loaded.fm.args;
        if (a === null || typeof a !== "object" || Array.isArray(a)) return null;
        const aObj = a as FmObject;
        const mi = aObj.model_invocable;
        if (mi === undefined) return null;
        // disable-model-invocation is the Claude/Cursor native key.
        if (mi === false) {
          targetFrontmatter(loaded.fm, "claude-code")["disable-model-invocation"] = true;
          targetFrontmatter(loaded.fm, "cursor")["disable-model-invocation"] = true;
        }
        delete aObj.model_invocable;
        if (Object.keys(aObj).length === 0) delete loaded.fm.args;
        return rebuild(loaded.fm, loaded.body);
      },
    });
  }

  if (!tools) return;

  // tools.network — dropped for Claude (no per-skill network gate). Fix:
  // move it to targets.<harness>.frontmatter where it's expressible (Codex/
  // Antigravity carry it natively) and drop from the neutral block so Claude
  // conversion stops dropping it silently.
  if (tools.network !== undefined) {
    findings.push({
      level: "warn",
      message:
        "tools.network has no per-skill equivalent in Claude Code and is dropped on conversion. " +
        "Move it to targets.<harness>.frontmatter for harnesses that support it, or remove it.",
      source: "static",
      fix(raw) {
        const loaded = loadFm(raw);
        if (!loaded) return null;
        const net = (loaded.fm.tools as FmObject | undefined)?.network;
        if (net === undefined) return null;
        // Preserve the intent on Codex (it expresses network access).
        const cx = targetFrontmatter(loaded.fm, "codex");
        cx.network = net as YamlValue;
        deleteToolsKey(loaded.fm, "network");
        return rebuild(loaded.fm, loaded.body);
      },
    });
  }

  // Claude-only fields: approval / sandbox are Codex concepts; they appear in
  // the neutral tools block but Antigravity/Cursor can't carry them. Suggest
  // relocating to targets.codex.frontmatter so they're scoped, not implicit.
  for (const key of ["approval", "sandbox"] as const) {
    if (tools[key] !== undefined) {
      findings.push({
        level: "info",
        message:
          `tools.${key} is a Codex-specific permission concept; Antigravity and Cursor cannot represent it. ` +
          `Consider scoping it under targets.codex.frontmatter if it is harness-specific.`,
        source: "static",
        fix(raw) {
          const loaded = loadFm(raw);
          if (!loaded) return null;
          const val = (loaded.fm.tools as FmObject | undefined)?.[key];
          if (val === undefined) return null;
          const cx = targetFrontmatter(loaded.fm, "codex");
          cx[key] = val as YamlValue;
          deleteToolsKey(loaded.fm, key);
          return rebuild(loaded.fm, loaded.body);
        },
      });
    }
  }

  // tools.shell as a prefix list — Codex maps it only coarsely; Antigravity's
  // ${VAR}-substitution caveat is a runtime note, surfaced as info.
  if (Array.isArray(tools.shell)) {
    findings.push({
      level: "info",
      message:
        "tools.shell prefix list maps coarsely to Codex (approval/sandbox only, no per-prefix gating); " +
        "verify the resulting sandbox is appropriately scoped.",
      source: "static",
    });
  }
}

/**
 * Apply a finding's fix to raw and confirm the result re-parses cleanly.
 * Returns the corrected skill or throws-shaped result with the parse errors.
 */
export function applyFix(finding: Finding, raw: string): { ok: boolean; raw?: string; errors: string[] } {
  if (!finding.fix) return { ok: false, errors: ["finding has no machine-applicable fix"] };
  const next = finding.fix(raw);
  if (next === null) return { ok: false, errors: ["fix did not apply (precondition not met)"] };
  const re = parseSkill(next);
  if (!re.skill) return { ok: false, errors: re.errors };
  return { ok: true, raw: next, errors: [] };
}
