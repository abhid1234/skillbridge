/**
 * Tier-2 conformance: per-target lossiness matrix.
 *
 * Derives a lossiness matrix from REAL converter output. We run `convertString`
 * over a representative set of skills (examples/commit-helper + registry skills,
 * plus a synthetic "rich" skill exercising hooks/args/agents/network/shell), then
 * bucket every emitted warning into one of three fidelity classes per target:
 *
 *   - "dropped"      a portable capability is NOT representable on the target and
 *                    is silently lost (e.g. tools.network on Claude Code).
 *   - "approximated" the capability survives but in a coarser / shifted form, or
 *                    requires manual setup (e.g. tools.shell prefixes on Codex,
 *                    Antigravity runtime-only sub-agents).
 *   - "native"       no warning fired for that capability on that target: it maps
 *                    cleanly.
 *
 * Pure: no filesystem. Callers (the test, the generator script) supply the skill
 * texts. Browser-safe (imports only convert-core + format).
 */
import { convertString } from "../convert-core.js";
import { TARGET_IDS, TargetId } from "../format.js";

export type Fidelity = "native" | "approximated" | "dropped";

/** The portable capabilities we track fidelity for. Stable row order. */
export const CAPABILITIES = [
  "tools.filesystem",
  "tools.shell",
  "tools.network",
  "tools.mcp",
  "tools.approval",
  "tools.sandbox",
  "mcp",
  "agents",
  "args",
  "hooks",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** One captured warning attributed to a (target, capability, fidelity). */
export interface LossEvent {
  target: TargetId;
  capability: Capability;
  fidelity: Fidelity;
  /** The raw converter warning that produced this classification. */
  warning: string;
  /** Skill the warning came from. */
  skill: string;
}

export interface CellSummary {
  /** Worst (most lossy) fidelity observed for this cell; "native" if no warnings. */
  fidelity: Fidelity;
  /** Distinct warnings observed (deduped), most-lossy first. */
  warnings: string[];
}

export interface LossinessMatrix {
  /** Stable target order (== TARGET_IDS). */
  targets: TargetId[];
  /** Stable capability order (== CAPABILITIES). */
  capabilities: Capability[];
  /** capability -> target -> summary. Every cell is populated. */
  cells: Record<Capability, Record<TargetId, CellSummary>>;
  /** Skills that were actually converted to build this matrix. */
  skills: string[];
  /** Every raw event, for drill-down / golden manifests. */
  events: LossEvent[];
}

export interface SkillSource {
  /** Stable label for the skill (e.g. "examples/commit-helper"). */
  name: string;
  /** Raw skill.sb.md text. */
  raw: string;
  /** Optional sub-agent skill.sb.md texts. */
  agentTexts?: string[];
}

const FIDELITY_RANK: Record<Fidelity, number> = { native: 0, approximated: 1, dropped: 2 };

/**
 * Classify a single converter warning into (capability, fidelity).
 *
 * Matching is keyed off the stable warning vocabulary emitted by the target
 * converters (see src/targets/*.ts). Each rule is intentionally specific so a new
 * warning string fails closed (returns null -> surfaces in `unclassified`) rather
 * than being mis-bucketed.
 */
export function classifyWarning(w: string): { capability: Capability; fidelity: Fidelity } | null {
  const has = (...needles: string[]) => needles.every((n) => w.includes(n));

  // --- tools.network ---
  if (has("tools.network") && w.includes("dropped")) {
    return { capability: "tools.network", fidelity: "dropped" };
  }
  if (has("tools.network") && (w.includes("broadly") || w.includes("isn't expressible"))) {
    return { capability: "tools.network", fidelity: "approximated" };
  }

  // --- tools.shell ---
  if (has("tools.shell")) {
    return { capability: "tools.shell", fidelity: "approximated" };
  }

  // --- tools.mcp (the tools.mcp:true enumeration note, NOT the mcp: block) ---
  if (has("tools.mcp")) {
    return { capability: "tools.mcp", fidelity: "approximated" };
  }

  // --- tools.approval / tools.sandbox ---
  if (has("tools.approval") || has("tools.sandbox") || has("approval/sandbox")) {
    return { capability: "tools.approval", fidelity: "approximated" };
  }

  // --- generic tools gating (Antigravity permission engine / Cursor agent-level) ---
  // These mean the whole tools block isn't expressed in the skill file: it is
  // either pushed to a SETUP.md (approximated) or simply not emitted (dropped).
  if (w.startsWith("tools:") || w.includes("tools: ")) {
    if (w.includes("was not emitted")) return { capability: "tools.filesystem", fidelity: "dropped" };
    return { capability: "tools.filesystem", fidelity: "approximated" };
  }

  // --- mcp: block ---
  if (w.startsWith("mcp.") || w.startsWith("mcp:")) {
    // env-var substitution caveat / rmcp client flag: server still emitted -> approximated.
    return { capability: "mcp", fidelity: "approximated" };
  }

  // --- agents ---
  if (w.startsWith("agent ") || w.includes("sub-agent")) {
    if (w.includes("no file emitted") || w.includes("runtime-only")) {
      return { capability: "agents", fidelity: "dropped" };
    }
    return { capability: "agents", fidelity: "approximated" };
  }

  // --- args ---
  if (w.startsWith("args")) {
    if (w.includes("Not emitted") || w.includes("not emitted")) {
      return { capability: "args", fidelity: "dropped" };
    }
    return { capability: "args", fidelity: "approximated" };
  }

  // --- hooks ---
  if (w.startsWith("hooks:")) {
    if (w.includes("not emitted") || w.includes("Not emitted")) {
      return { capability: "hooks", fidelity: "dropped" };
    }
    return { capability: "hooks", fidelity: "approximated" };
  }

  return null;
}

function emptyCell(): CellSummary {
  return { fidelity: "native", warnings: [] };
}

/**
 * Build the lossiness matrix by converting every supplied skill to all targets
 * and bucketing the resulting warnings. Capabilities a skill never exercises stay
 * "native" (clean) for every target — which is correct: nothing was lost.
 */
export function buildLossinessMatrix(sources: SkillSource[]): {
  matrix: LossinessMatrix;
  /** Warnings we could not classify (signals the vocabulary drifted). */
  unclassified: { warning: string; target: TargetId; skill: string }[];
} {
  const targets = [...TARGET_IDS] as TargetId[];
  const cells = {} as Record<Capability, Record<TargetId, CellSummary>>;
  for (const cap of CAPABILITIES) {
    cells[cap] = {} as Record<TargetId, CellSummary>;
    for (const t of targets) cells[cap][t] = emptyCell();
  }

  const events: LossEvent[] = [];
  const unclassified: { warning: string; target: TargetId; skill: string }[] = [];
  const skills: string[] = [];

  for (const src of sources) {
    skills.push(src.name);
    const res = convertString(src.raw, targets, src.agentTexts ?? []);
    if (!res.ok) {
      // A source that fails to parse is a fixture bug, not a lossiness signal —
      // record it as an unclassified marker so the test/generator surfaces it.
      unclassified.push({ warning: `convertString failed: ${res.errors[0] ?? "unknown"}`, target: targets[0], skill: src.name });
      continue;
    }
    for (const r of res.results) {
      for (const w of r.warnings) {
        const c = classifyWarning(w);
        if (!c) {
          unclassified.push({ warning: w, target: r.target, skill: src.name });
          continue;
        }
        events.push({ target: r.target, capability: c.capability, fidelity: c.fidelity, warning: w, skill: src.name });
      }
    }
  }

  // Fold events into cells: a cell takes the WORST fidelity observed, and collects
  // the distinct warnings (most-lossy first, then alphabetical for stability).
  for (const ev of events) {
    const cell = cells[ev.capability][ev.target];
    if (FIDELITY_RANK[ev.fidelity] > FIDELITY_RANK[cell.fidelity]) cell.fidelity = ev.fidelity;
    if (!cell.warnings.includes(ev.warning)) cell.warnings.push(ev.warning);
  }
  for (const cap of CAPABILITIES) {
    for (const t of targets) {
      cells[cap][t].warnings.sort((a, b) => a.localeCompare(b));
    }
  }

  return {
    matrix: { targets, capabilities: [...CAPABILITIES], cells, skills, events },
    unclassified,
  };
}

/** Count of non-native cells — a quick "how lossy is the whole matrix" scalar. */
export function lossyCellCount(m: LossinessMatrix): number {
  let n = 0;
  for (const cap of m.capabilities) for (const t of m.targets) if (m.cells[cap][t].fidelity !== "native") n++;
  return n;
}
