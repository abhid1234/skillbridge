import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

import { parseSkill, TARGET_IDS, TargetId } from "../src/format.js";
import { convertString } from "../src/convert-core.js";
import { importToSkillBridge } from "../src/import-core.js";
import {
  buildLossinessMatrix,
  classifyWarning,
  lossyCellCount,
  CAPABILITIES,
  SkillSource,
} from "../src/conformance/lossiness.js";
import { renderMatrixMarkdown } from "../src/conformance/matrix-render.js";
import { behavioralEnabled, runBehavioralProbes, whichCli } from "../src/conformance/behavioral.js";

const REPO = path.resolve(__dirname, "../../../..");
const EXAMPLE = path.join(REPO, "examples", "commit-helper", "skill.sb.md");

// Synthetic skill mirroring the one in scripts/gen-conformance.mjs: exercises the
// capabilities (args/hooks/agents/network/shell) the registry skills don't use, so
// the matrix has full lossy signal.
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

function loadSources(): SkillSource[] {
  const sources: SkillSource[] = [];
  sources.push({ name: "examples/commit-helper", raw: fs.readFileSync(EXAMPLE, "utf8") });
  const regDir = path.join(REPO, "registry");
  for (const name of fs.readdirSync(regDir).sort()) {
    const f = path.join(regDir, name, "skill.sb.md");
    if (fs.existsSync(f)) sources.push({ name: `registry/${name}`, raw: fs.readFileSync(f, "utf8") });
  }
  sources.push({ name: "synthetic/rich-skill", raw: RICH_SKILL, agentTexts: [RICH_AGENT] });
  return sources;
}

// --------------------------------------------------------------------------
// Structural conformance: emitted SKILL.md re-validates via import + parse
// --------------------------------------------------------------------------
test("conformance: every emitted SKILL.md re-imports + re-parses clean", () => {
  const sources = loadSources();
  assert.ok(sources.length >= 2, "expected example + registry skills");
  for (const src of sources) {
    const res = convertString(src.raw, [...TARGET_IDS] as TargetId[]);
    assert.equal(res.ok, true, `${src.name} should convert`);
    for (const r of res.results) {
      if (r.skipped) continue;
      const skillFile = r.files.find((f) => f.path.endsWith("SKILL.md"));
      assert.ok(skillFile, `${src.name} [${r.target}] emits a SKILL.md`);
      // Round-trip: native SKILL.md -> SkillBridge -> parse must be error-free.
      const imp = importToSkillBridge(skillFile!.content, "auto");
      assert.equal(imp.ok, true, `${src.name} [${r.target}] SKILL.md re-imports`);
      const reparsed = parseSkill(imp.sbText!);
      assert.deepEqual(reparsed.errors, [], `${src.name} [${r.target}] re-parses clean`);
    }
  }
});

// --------------------------------------------------------------------------
// Lossiness matrix is well-formed and non-empty
// --------------------------------------------------------------------------
test("conformance: lossiness matrix is fully populated and has lossy signal", () => {
  const { matrix, unclassified } = buildLossinessMatrix(loadSources());
  assert.deepEqual(unclassified, [], `unclassified warnings (vocabulary drift): ${JSON.stringify(unclassified)}`);

  // Every cell present for every capability×target.
  for (const cap of CAPABILITIES) {
    for (const t of TARGET_IDS) {
      const cell = matrix.cells[cap][t as TargetId];
      assert.ok(cell, `cell ${cap}×${t} exists`);
      assert.ok(["native", "approximated", "dropped"].includes(cell.fidelity));
    }
  }
  // Non-empty: real lossiness exists (e.g. args dropped on several targets).
  assert.ok(lossyCellCount(matrix) > 0, "matrix must capture at least one lossy cell");
  assert.ok(matrix.events.length > 0, "matrix must have classified events");
  assert.equal(matrix.cells["args"]["antigravity"].fidelity, "dropped");
  assert.equal(matrix.cells["tools.network"]["claude-code"].fidelity, "dropped");
});

test("conformance: classifyWarning buckets the known vocabulary, fails closed on novelty", () => {
  assert.deepEqual(classifyWarning("tools.network has no per-skill equivalent in Claude Code; dropped."), {
    capability: "tools.network",
    fidelity: "dropped",
  });
  assert.deepEqual(classifyWarning("hooks: Cursor has no skill-level hooks; not emitted."), {
    capability: "hooks",
    fidelity: "dropped",
  });
  assert.equal(classifyWarning("some entirely new warning we have never seen"), null);
});

test("conformance: matrix renders to markdown with a table and legend", () => {
  const { matrix } = buildLossinessMatrix(loadSources());
  const md = renderMatrixMarkdown(matrix);
  assert.match(md, /# SkillBridge Lossiness Matrix/);
  assert.match(md, /\| Capability \|/);
  assert.match(md, /native/);
  assert.match(md, /dropped/);
  for (const t of TARGET_IDS) assert.ok(md.includes(t), `header includes ${t}`);
});

// --------------------------------------------------------------------------
// Determinism: a core-only skill converts identically across repeated runs
// --------------------------------------------------------------------------
test("conformance: core-only skill converts identically x4 (deterministic)", () => {
  const coreOnly = `---
name: explain-this
description: Explains a snippet of code in plain language with no special capabilities.
spec_version: "0.1"
---

# Explain This

Explain the selected code clearly.
`;
  const runs = Array.from({ length: 4 }, () => convertString(coreOnly, [...TARGET_IDS] as TargetId[]));
  const fingerprint = (r: ReturnType<typeof convertString>) =>
    r.results.map((t) => `${t.target}|${t.skipped}|` + t.files.map((f) => `${f.path}=${f.content}`).join("¦")).join("‖");
  const first = fingerprint(runs[0]);
  for (let i = 1; i < runs.length; i++) {
    assert.equal(fingerprint(runs[i]), first, `run ${i} differs from run 0 — conversion is non-deterministic`);
  }
  // A core-only skill should produce zero lossiness warnings on any target.
  for (const r of runs[0].results) assert.deepEqual(r.warnings, [], `${r.target} should be lossless for a core-only skill`);
});

// --------------------------------------------------------------------------
// Behavioral layer: always safe — never throws, auto-skips when gate off / CLI absent
// --------------------------------------------------------------------------
test("conformance: behavioral probes never throw and skip when not enabled", () => {
  const results = runBehavioralProbes([...TARGET_IDS] as TargetId[]);
  assert.equal(results.length, TARGET_IDS.length);
  if (!behavioralEnabled()) {
    for (const r of results) assert.equal(r.status, "skipped", `${r.target} skipped when SKILLBRIDGE_BEHAVIORAL unset`);
  } else {
    // Gate on: cursor/antigravity have no CLI here -> still skipped, never error-thrown.
    for (const r of results) assert.ok(["ok", "skipped", "error"].includes(r.status));
  }
  // whichCli on an impossible binary returns null, never throws.
  assert.equal(whichCli("definitely-not-a-real-binary-xyz"), null);
});
