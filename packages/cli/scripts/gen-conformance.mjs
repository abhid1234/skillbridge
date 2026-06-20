#!/usr/bin/env node
/**
 * Regenerate the Tier-2 conformance artifacts. Plain Node, zero dependencies.
 *
 *   node scripts/gen-conformance.mjs            # write docs/lossiness-matrix.md + golden manifest
 *   node scripts/gen-conformance.mjs --check    # exit non-zero if either would change (CI drift gate)
 *
 * Imports the COMPILED converter + conformance modules from dist/, so this must
 * run after `npm run build`. (The package's `conformance` / `conformance:check`
 * scripts wire that ordering — see integrationNeeds.)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, ".."); // packages/cli
const repoRoot = join(cliRoot, "..", ".."); // repo root
const distDir = join(cliRoot, "dist", "src");

const lossinessMod = join(distDir, "conformance", "lossiness.js");
const renderMod = join(distDir, "conformance", "matrix-render.js");
if (!existsSync(lossinessMod) || !existsSync(renderMod)) {
  console.error(
    `gen-conformance: compiled modules not found at ${distDir}/conformance/.\n` +
      "Run `npm run build` first (the `conformance` npm script does this).",
  );
  process.exit(2);
}

const { buildLossinessMatrix } = await import(pathToUrl(lossinessMod));
const { renderMatrixMarkdown } = await import(pathToUrl(renderMod));

function pathToUrl(p) {
  return "file://" + p;
}

// ---- assemble the skill sample set: examples/commit-helper + all registry skills ----
function loadSources() {
  const sources = [];
  const example = join(repoRoot, "examples", "commit-helper", "skill.sb.md");
  if (existsSync(example)) sources.push({ name: "examples/commit-helper", raw: readFileSync(example, "utf8") });

  const regDir = join(repoRoot, "registry");
  if (existsSync(regDir)) {
    for (const name of readdirSync(regDir).sort()) {
      const f = join(regDir, name, "skill.sb.md");
      if (existsSync(f)) sources.push({ name: `registry/${name}`, raw: readFileSync(f, "utf8") });
    }
  }

  // Synthetic "rich" skill: exercises hooks/args/agents/network/shell so the
  // matrix has signal for capabilities the registry skills don't use yet.
  sources.push({
    name: "synthetic/rich-skill",
    raw: RICH_SKILL,
    agentTexts: [RICH_AGENT],
  });
  return sources;
}

const RICH_SKILL = `---
name: rich-skill
description: Synthetic skill exercising hooks, args, sub-agents, network allowlist, and shell prefixes for full lossiness coverage.
spec_version: "0.1"
tools:
  filesystem: write
  shell: ["git ", "npm "]
  network: ["api.github.com"]
  approval: on-request
  sandbox: workspace-write
args:
  hint: "[issue]"
  spec: [issue, branch]
  model_invocable: false
hooks:
  PostToolUse: "echo done"
agents: [reviewer]
---

# Rich Skill

A synthetic skill used only by the conformance harness.
`;

const RICH_AGENT = `---
name: reviewer
description: Sub-agent that reviews changes and reports findings back to the parent.
tools:
  filesystem: read
---

# Reviewer

Review the change.
`;

// ---- structural golden manifest: a stable structural fingerprint of conversion ----
// Records, per (skill, target): skipped flag + sorted emitted file paths. This is
// the STRUCTURE of the conversion (which files land where), independent of byte
// content, so it catches "a target stopped emitting a file" regressions cheaply.
const { convertString } = await import(pathToUrl(join(distDir, "convert-core.js")));
const { TARGET_IDS: TARGETS } = await import(pathToUrl(join(distDir, "format.js")));

function buildGoldenManifest(sources) {
  const targets = [...TARGETS];
  const lines = [];
  for (const src of sources) {
    const res = convertString(src.raw, targets, src.agentTexts ?? []);
    lines.push(`# ${src.name}  ok=${res.ok}`);
    if (!res.ok) {
      lines.push(`  ERROR ${res.errors[0] ?? "unknown"}`);
      continue;
    }
    for (const r of res.results) {
      const paths = r.files.map((f) => f.path).sort();
      lines.push(`  [${r.target}] skipped=${r.skipped} files=${paths.length}`);
      for (const p of paths) lines.push(`    - ${p}`);
    }
  }
  return lines.join("\n") + "\n";
}

// ---- run ----
const check = process.argv.includes("--check");
const sources = loadSources();

const { matrix, unclassified } = buildLossinessMatrix(sources);
if (unclassified.length) {
  console.error("gen-conformance: UNCLASSIFIED converter warnings (vocabulary drifted — update classifyWarning):");
  for (const u of unclassified) console.error(`  [${u.target}] ${u.skill}: ${u.warning}`);
  // In --check this is drift; in write mode it's a hard failure so we never bake
  // an incomplete matrix.
  process.exit(3);
}

const matrixMd = renderMatrixMarkdown(matrix);
const goldenManifest = buildGoldenManifest(sources);

const docsDir = join(repoRoot, "docs");
const matrixPath = join(docsDir, "lossiness-matrix.md");
const goldenPath = join(cliRoot, "test", "golden", "conformance-manifest.txt");

if (check) {
  let drift = false;
  drift = compare(matrixPath, matrixMd, "docs/lossiness-matrix.md") || drift;
  drift = compare(goldenPath, goldenManifest, "test/golden/conformance-manifest.txt") || drift;
  if (drift) {
    console.error("\ngen-conformance --check: DRIFT detected. Run `npm run conformance` and commit the result.");
    process.exit(1);
  }
  console.log("gen-conformance --check: no drift.");
  process.exit(0);
}

mkdirSync(docsDir, { recursive: true });
mkdirSync(dirname(goldenPath), { recursive: true });
writeFileSync(matrixPath, matrixMd);
writeFileSync(goldenPath, goldenManifest);
console.log(`gen-conformance: wrote ${matrixPath}`);
console.log(`gen-conformance: wrote ${goldenPath}`);

function compare(path, next, label) {
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (prev !== next) {
    console.error(`  drift: ${label}${prev === null ? " (missing)" : ""}`);
    return true;
  }
  return false;
}
