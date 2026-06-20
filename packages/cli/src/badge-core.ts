/**
 * Browser-safe compatibility matrix + SVG badge — pure functions, NO filesystem.
 *
 * compatibilityMatrix(raw) converts a skill across every target and grades each
 * one lossless | lossy | skipped from the conversion warnings. svgBadge(matrix)
 * renders a small self-contained SVG with cc / ag / cx / cur labels colored by
 * status, suitable for embedding in a README.
 *
 * Adds no new runtime dependencies.
 */
import { parseSkill, TARGET_IDS, TargetId } from "./format.js";
import { convertString } from "./convert-core.js";

export type CompatStatus = "lossless" | "lossy" | "skipped";

export interface CompatEntry {
  target: TargetId;
  status: CompatStatus;
  warnings: string[];
}

export interface CompatibilityMatrix {
  ok: boolean;
  errors: string[];
  entries: CompatEntry[];
}

/** Compact label per target, used in the SVG and CLI output. */
export const TARGET_LABELS: Record<TargetId, string> = {
  "claude-code": "cc",
  antigravity: "ag",
  codex: "cx",
  cursor: "cur",
};

export function compatibilityMatrix(raw: string): CompatibilityMatrix {
  const parsed = parseSkill(raw);
  if (!parsed.skill) {
    return { ok: false, errors: parsed.errors, entries: [] };
  }
  const conv = convertString(raw, TARGET_IDS as unknown as TargetId[]);
  const entries: CompatEntry[] = conv.results.map((r) => {
    let status: CompatStatus;
    if (r.skipped) status = "skipped";
    else if (r.warnings.length > 0) status = "lossy";
    else status = "lossless";
    return { target: r.target, status, warnings: r.warnings };
  });
  return { ok: true, errors: [], entries };
}

const STATUS_COLOR: Record<CompatStatus, string> = {
  lossless: "#3fb950", // green
  lossy: "#d29922", // amber
  skipped: "#8b949e", // gray
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a self-contained SVG: a leading "skillbridge" tab plus one colored
 * cell per target showing its compact label. No external fonts/images.
 */
export function svgBadge(matrix: CompatibilityMatrix): string {
  const labelW = 78; // "skillbridge" tab width
  const cellW = 34; // per-target cell width
  const h = 20;
  const entries = matrix.entries;
  const totalW = labelW + cellW * entries.length;

  const cells: string[] = [];
  entries.forEach((e, i) => {
    const x = labelW + cellW * i;
    const color = STATUS_COLOR[e.status];
    const label = escapeXml(TARGET_LABELS[e.target]);
    const cx = x + cellW / 2;
    cells.push(
      `<rect x="${x}" width="${cellW}" height="${h}" fill="${color}"/>` +
        `<text x="${cx}" y="14" fill="#0d1117" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">${label}</text>`,
    );
  });

  const titleStatus = entries.map((e) => `${TARGET_LABELS[e.target]}=${e.status}`).join(" ");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="skillbridge: ${escapeXml(titleStatus)}">` +
    `<title>skillbridge: ${escapeXml(titleStatus)}</title>` +
    `<rect width="${totalW}" height="${h}" fill="#24292f"/>` +
    `<rect width="${labelW}" height="${h}" fill="#1f6feb"/>` +
    `<text x="${labelW / 2}" y="14" fill="#ffffff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">skillbridge</text>` +
    cells.join("") +
    `</svg>`
  );
}
