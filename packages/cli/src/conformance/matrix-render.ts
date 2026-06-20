/**
 * Render a LossinessMatrix to Markdown for docs/lossiness-matrix.md.
 * Pure string-building; browser-safe.
 */
import { LossinessMatrix, Fidelity, Capability, lossyCellCount } from "./lossiness.js";
import { TargetId } from "../format.js";

const GLYPH: Record<Fidelity, string> = {
  native: "✅ native",
  approximated: "🟡 approx",
  dropped: "❌ dropped",
};

/** Human-friendly label for a capability row. */
const CAP_LABEL: Record<Capability, string> = {
  "tools.filesystem": "tools.filesystem",
  "tools.shell": "tools.shell (prefix gating)",
  "tools.network": "tools.network (host allowlist)",
  "tools.mcp": "tools.mcp (enable flag)",
  "tools.approval": "tools.approval / sandbox",
  "tools.sandbox": "tools.sandbox",
  mcp: "mcp servers",
  agents: "agents (sub-agents)",
  args: "args (slash/arg-hint)",
  hooks: "hooks",
};

function targetHeader(t: TargetId): string {
  return t;
}

/** Render the matrix table + a per-cell footnote section. */
export function renderMatrixMarkdown(m: LossinessMatrix, opts?: { generatedNote?: boolean }): string {
  const lines: string[] = [];
  lines.push("# SkillBridge Lossiness Matrix");
  lines.push("");
  lines.push(
    "Per-target fidelity of each portable capability, derived automatically from real " +
      "converter warnings. This file is GENERATED — run `npm run conformance` to regenerate; " +
      "`npm run conformance:check` fails CI if it drifts.",
  );
  lines.push("");
  lines.push("Legend: ✅ native (maps cleanly) · 🟡 approx (coarser form / manual setup) · ❌ dropped (not representable, lost).");
  lines.push("");

  // --- summary line ---
  const total = m.capabilities.length * m.targets.length;
  lines.push(`**Coverage:** ${total - lossyCellCount(m)}/${total} capability×target cells map natively across ${m.skills.length} sampled skills.`);
  lines.push("");

  // --- the table ---
  lines.push("| Capability | " + m.targets.map(targetHeader).join(" | ") + " |");
  lines.push("| --- | " + m.targets.map(() => "---").join(" | ") + " |");
  // footnote registry: warning text -> [n]
  const footnotes: string[] = [];
  const fnIndex = new Map<string, number>();
  const fnRef = (w: string): string => {
    if (!fnIndex.has(w)) {
      fnIndex.set(w, footnotes.length + 1);
      footnotes.push(w);
    }
    return `[^${fnIndex.get(w)}]`;
  };

  for (const cap of m.capabilities) {
    const row: string[] = [CAP_LABEL[cap]];
    for (const t of m.targets) {
      const cell = m.cells[cap][t];
      let s = GLYPH[cell.fidelity];
      if (cell.warnings.length) s += " " + cell.warnings.map(fnRef).join("");
      row.push(s);
    }
    lines.push("| " + row.join(" | ") + " |");
  }
  lines.push("");

  // --- footnotes ---
  if (footnotes.length) {
    lines.push("## Notes");
    lines.push("");
    footnotes.forEach((w, i) => {
      lines.push(`[^${i + 1}]: ${w}`);
    });
    lines.push("");
  }

  // --- sampled skills ---
  lines.push("## Sampled skills");
  lines.push("");
  for (const s of m.skills) lines.push(`- \`${s}\``);
  lines.push("");

  return lines.join("\n");
}
