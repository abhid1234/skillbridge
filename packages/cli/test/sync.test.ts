import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { planSync, runSync, checkDrift, watchSync } from "../src/sync.js";
import { SkillBridgeConfig, DEFAULT_CONFIG } from "../src/config.js";
import { runInit } from "../src/init.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sb-sync-"));
}

function writeSkill(root: string, name: string, body = "body"): void {
  const dir = path.join(root, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "skill.sb.md"),
    `---\nname: ${name}\ndescription: a skill named ${name} for sync testing.\n---\n${body}\n`,
  );
}

function cfg(over: Partial<SkillBridgeConfig> = {}): SkillBridgeConfig {
  return { ...DEFAULT_CONFIG, outDir: "build", ...over };
}

// --------------------------------------------------------------------------
// planSync
// --------------------------------------------------------------------------
test("sync: planSync computes expected files keyed by absolute path", () => {
  const root = tmpProject();
  writeSkill(root, "alpha");
  const plan = planSync(cfg({ targets: ["claude-code"] }), root);

  assert.deepEqual(plan.errors, []);
  const expected = path.join(root, "build", ".claude/skills/alpha/SKILL.md");
  assert.ok(plan.files.has(expected), "absolute claude path planned");
  assert.match(plan.files.get(expected)!, /name: alpha/);
  // every key is absolute
  for (const k of plan.files.keys()) assert.ok(path.isAbsolute(k));

  fs.rmSync(root, { recursive: true, force: true });
});

test("sync: planSync warns when no skills are found", () => {
  const root = tmpProject();
  const plan = planSync(cfg(), root);
  assert.equal(plan.files.size, 0);
  assert.ok(plan.warnings.some((w) => w.includes("No skills")));
  fs.rmSync(root, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// runSync: dry-run vs write
// --------------------------------------------------------------------------
test("sync: runSync dry-run writes nothing but reports paths", () => {
  const root = tmpProject();
  writeSkill(root, "alpha");
  const plan = planSync(cfg({ targets: ["claude-code"] }), root);
  const res = runSync(plan, { dryRun: true });

  assert.equal(res.dryRun, true);
  assert.ok(res.written.includes(".claude/skills/alpha/SKILL.md"));
  assert.ok(!fs.existsSync(path.join(root, "build")), "no build dir created in dry-run");

  fs.rmSync(root, { recursive: true, force: true });
});

test("sync: runSync writes the planned native files to disk", () => {
  const root = tmpProject();
  writeSkill(root, "alpha");
  const plan = planSync(cfg({ targets: ["claude-code", "codex"] }), root);
  const res = runSync(plan, {});

  assert.equal(res.dryRun, false);
  const cc = path.join(root, "build", ".claude/skills/alpha/SKILL.md");
  assert.ok(fs.existsSync(cc));
  assert.equal(fs.readFileSync(cc, "utf8"), plan.files.get(cc));

  fs.rmSync(root, { recursive: true, force: true });
});

test("sync: runSync copies resource dirs (references/) into the skill dir", () => {
  const root = tmpProject();
  writeSkill(root, "alpha");
  const refDir = path.join(root, "skills", "alpha", "references");
  fs.mkdirSync(refDir, { recursive: true });
  fs.writeFileSync(path.join(refDir, "guide.md"), "# guide\n");

  const plan = planSync(cfg({ targets: ["claude-code"] }), root);
  assert.ok(plan.resources.length >= 1, "resource copy planned");
  runSync(plan, {});
  assert.ok(
    fs.existsSync(path.join(root, "build", ".claude/skills/alpha/references/guide.md")),
  );

  fs.rmSync(root, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// checkDrift
// --------------------------------------------------------------------------
test("sync: checkDrift reports missing then in-sync then drifted", () => {
  const root = tmpProject();
  writeSkill(root, "alpha");
  const config = cfg({ targets: ["claude-code"] });

  // before write: everything is missing
  let plan = planSync(config, root);
  let drift = checkDrift(plan);
  assert.equal(drift.inSync, false);
  assert.ok(drift.missing.length > 0);
  assert.equal(drift.drifted.length, 0);

  // after write: in sync
  runSync(plan, {});
  drift = checkDrift(planSync(config, root));
  assert.equal(drift.inSync, true);

  // mutate source -> plan changes -> on-disk now drifts
  writeSkill(root, "alpha", "DIFFERENT BODY CONTENT");
  plan = planSync(config, root);
  drift = checkDrift(plan);
  assert.equal(drift.inSync, false);
  assert.ok(drift.drifted.includes(".claude/skills/alpha/SKILL.md"));

  fs.rmSync(root, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// end-to-end with init scaffolding
// --------------------------------------------------------------------------
test("sync: an init'd project plans, syncs, and verifies in-sync", () => {
  const root = tmpProject();
  runInit(root, {});
  const config = cfg({ targets: [...DEFAULT_CONFIG.targets], outDir: "out" });
  const plan = planSync(config, root);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.skills.length, 1);

  runSync(plan, {});
  assert.equal(checkDrift(planSync(config, root)).inSync, true);

  fs.rmSync(root, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// watchSync
// --------------------------------------------------------------------------
test("sync: watchSync fires onRebuild (debounced) after a source change", async () => {
  const root = tmpProject();
  writeSkill(root, "alpha");
  const config = cfg({ targets: ["claude-code"] });

  const rebuilds: number[] = [];
  const watcher = watchSync(config, root, (plan) => {
    rebuilds.push(plan.files.size);
  });

  // touch the source after the watcher is established
  await new Promise((r) => setTimeout(r, 50));
  writeSkill(root, "alpha", "changed body to trigger watch");

  await new Promise((r) => setTimeout(r, 400));
  watcher.close();

  assert.ok(rebuilds.length >= 1, "expected at least one debounced rebuild");
  assert.ok(rebuilds[rebuilds.length - 1] >= 1, "rebuild plan contains files");

  fs.rmSync(root, { recursive: true, force: true });
});

test("sync: watchSync.close is idempotent and safe with no source dir", () => {
  const root = tmpProject();
  const watcher = watchSync(cfg(), root, () => {});
  assert.doesNotThrow(() => {
    watcher.close();
    watcher.close();
  });
  fs.rmSync(root, { recursive: true, force: true });
});
