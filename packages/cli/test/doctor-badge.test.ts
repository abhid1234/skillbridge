import { test } from "node:test";
import * as assert from "node:assert/strict";

import { parseSkill } from "../src/format.js";
import { diagnose, applyFix } from "../src/doctor-core.js";
import { compatibilityMatrix, svgBadge, TARGET_LABELS } from "../src/badge-core.js";

// A skill exercising the two flagged fields: tools.network + args.model_invocable.
const NETWORK_MODEL = `---
name: netty
description: A skill that uses network access and disables model invocation.
tools:
  filesystem: read
  network: true
args:
  model_invocable: false
---

# Netty
Fetch and summarize.
`;

// Pure core: only name + description → lossless everywhere.
const PURE = `---
name: pure-core
description: A pure skill with only name and description and a markdown body.
---

# Pure
Do the thing.
`;

// A tools block without network → lossless on Claude, lossy on ag/codex/cursor.
const TOOLSY = `---
name: toolsy
description: A skill that declares a tools block with filesystem shell and mcp.
tools:
  filesystem: write
  shell:
    - "git "
  mcp:
    - github/create_issue
---

# Toolsy
Body here.
`;

// --------------------------------------------------------------------------
// doctor
// --------------------------------------------------------------------------
test("doctor: flags network + model_invocable on a skill that uses them", () => {
  const report = diagnose(NETWORK_MODEL);
  assert.equal(report.ok, true);
  assert.equal(report.errors.length, 0);

  const msgs = report.findings.map((f) => f.message).join("\n");
  assert.match(msgs, /tools\.network/);
  assert.match(msgs, /model_invocable/);

  // Both flagged findings carry machine-applicable fixes.
  const netFinding = report.findings.find((f) => /tools\.network/.test(f.message) && f.fix);
  const modelFinding = report.findings.find((f) => /model_invocable/.test(f.message) && f.fix);
  assert.ok(netFinding, "expected a fixable network finding");
  assert.ok(modelFinding, "expected a fixable model_invocable finding");
});

test("doctor: applying the network fix re-parses with zero errors", () => {
  const report = diagnose(NETWORK_MODEL);
  const netFinding = report.findings.find((f) => /tools\.network/.test(f.message) && f.fix)!;
  const applied = applyFix(netFinding, NETWORK_MODEL);
  assert.equal(applied.ok, true, applied.errors.join("; "));
  assert.ok(applied.raw);

  const re = parseSkill(applied.raw!);
  assert.equal(re.errors.length, 0);
  assert.ok(re.skill);
  // network has been lifted out of the neutral tools block.
  assert.equal(re.skill!.frontmatter.tools?.network, undefined);
  // ...and preserved under the codex target override.
  const cx = re.skill!.frontmatter.targets?.codex?.frontmatter as Record<string, unknown> | undefined;
  assert.ok(cx && cx.network === true);
});

test("doctor: applying the model_invocable fix re-parses with zero errors", () => {
  const report = diagnose(NETWORK_MODEL);
  const modelFinding = report.findings.find((f) => /model_invocable/.test(f.message) && f.fix)!;
  const applied = applyFix(modelFinding, NETWORK_MODEL);
  assert.equal(applied.ok, true, applied.errors.join("; "));
  const re = parseSkill(applied.raw!);
  assert.equal(re.errors.length, 0);
  assert.ok(re.skill);
  assert.equal(re.skill!.frontmatter.args?.model_invocable, undefined);
  const cc = re.skill!.frontmatter.targets?.["claude-code"]?.frontmatter as Record<string, unknown> | undefined;
  assert.ok(cc && cc["disable-model-invocation"] === true);
});

test("doctor: pure-core skill has no fixable findings", () => {
  const report = diagnose(PURE);
  assert.equal(report.ok, true);
  assert.equal(report.findings.filter((f) => f.fix).length, 0);
});

// --------------------------------------------------------------------------
// compatibilityMatrix
// --------------------------------------------------------------------------
test("compatibilityMatrix: pure-core is lossless across all four targets", () => {
  const m = compatibilityMatrix(PURE);
  assert.equal(m.ok, true);
  assert.equal(m.entries.length, 4);
  for (const e of m.entries) assert.equal(e.status, "lossless", `${e.target} -> ${e.status}`);
});

test("compatibilityMatrix: tools-block skill is lossy on ag/codex/cursor, lossless on claude", () => {
  const m = compatibilityMatrix(TOOLSY);
  const byTarget = Object.fromEntries(m.entries.map((e) => [e.target, e.status]));
  assert.equal(byTarget["claude-code"], "lossless");
  assert.equal(byTarget["antigravity"], "lossy");
  assert.equal(byTarget["codex"], "lossy");
  assert.equal(byTarget["cursor"], "lossy");
});

// --------------------------------------------------------------------------
// svgBadge
// --------------------------------------------------------------------------
test("svgBadge: contains the four target labels and a valid <svg> element", () => {
  const m = compatibilityMatrix(TOOLSY);
  const svg = svgBadge(m);
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  for (const label of Object.values(TARGET_LABELS)) {
    assert.ok(svg.includes(`>${label}</text>`), `expected label ${label} in svg`);
  }
});
