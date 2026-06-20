import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  loadConfig,
  validateConfig,
  discoverSkills,
} from "../src/config.js";
import { TARGET_IDS } from "../src/format.js";
import { runInit } from "../src/init.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sb-config-"));
}

function writeSkill(root: string, name: string): void {
  const dir = path.join(root, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "skill.sb.md"),
    `---\nname: ${name}\ndescription: a skill named ${name} for testing.\n---\nbody\n`,
  );
}

// --------------------------------------------------------------------------
// validateConfig: defaults + validation (no throw)
// --------------------------------------------------------------------------
test("config: empty object applies all defaults", () => {
  const { config, errors } = validateConfig({});
  assert.deepEqual(errors, []);
  assert.equal(config.sourceDir, DEFAULT_CONFIG.sourceDir);
  assert.equal(config.outDir, DEFAULT_CONFIG.outDir);
  assert.deepEqual(config.targets, [...TARGET_IDS]);
});

test("config: rejects unknown target, accepts a valid subset", () => {
  const bad = validateConfig({ targets: ["claude-code", "nope"] });
  assert.ok(bad.errors.some((e) => e.includes("nope")));

  const ok = validateConfig({ targets: ["claude-code", "codex"] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.targets, ["claude-code", "codex"]);
});

test("config: type errors are collected, not thrown", () => {
  const r = validateConfig({ sourceDir: 5, outDir: "", targets: [], skills: "x" });
  assert.ok(r.errors.some((e) => e.includes("sourceDir")));
  assert.ok(r.errors.some((e) => e.includes("outDir")));
  assert.ok(r.errors.some((e) => e.includes("targets")));
  assert.ok(r.errors.some((e) => e.includes("skills")));
});

test("config: unknown top-level key warns but is forward-compatible", () => {
  const r = validateConfig({ futureField: true });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes("futureField")));
});

// --------------------------------------------------------------------------
// loadConfig: walk-up discovery + boundaries
// --------------------------------------------------------------------------
test("config: loadConfig walks up from a nested cwd to find the config", () => {
  const root = tmpProject();
  fs.writeFileSync(
    path.join(root, CONFIG_FILENAME),
    JSON.stringify({ sourceDir: "skills", outDir: "build" }),
  );
  const nested = path.join(root, "a", "b", "c");
  fs.mkdirSync(nested, { recursive: true });

  const { config, configDir, configPath } = loadConfig(nested);
  assert.equal(configDir, fs.realpathSync(root));
  assert.equal(path.basename(configPath), CONFIG_FILENAME);
  assert.equal(config.outDir, "build");

  fs.rmSync(root, { recursive: true, force: true });
});

test("config: loadConfig stops at the repo root (.git boundary)", () => {
  const root = tmpProject();
  // config lives ABOVE the repo root; the .git boundary must hide it.
  fs.writeFileSync(path.join(root, CONFIG_FILENAME), JSON.stringify({}));
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const cwd = path.join(repo, "pkg");
  fs.mkdirSync(cwd, { recursive: true });

  assert.throws(() => loadConfig(cwd), /No skillbridge\.config\.json/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("config: loadConfig throws on invalid JSON", () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, CONFIG_FILENAME), "{ not json");
  assert.throws(() => loadConfig(root), /not valid JSON/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("config: loadConfig throws with field errors on invalid config", () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, CONFIG_FILENAME), JSON.stringify({ targets: ["bogus"] }));
  assert.throws(() => loadConfig(root), /Unknown target "bogus"/);
  fs.rmSync(root, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// discoverSkills
// --------------------------------------------------------------------------
test("config: discoverSkills scans sourceDir for */skill.sb.md, sorted", () => {
  const root = tmpProject();
  writeSkill(root, "beta");
  writeSkill(root, "alpha");
  // a dir without a skill.sb.md must be ignored
  fs.mkdirSync(path.join(root, "skills", "not-a-skill"), { recursive: true });

  const found = discoverSkills({ ...DEFAULT_CONFIG }, root);
  assert.deepEqual(found.map((d) => path.basename(d)), ["alpha", "beta"]);

  fs.rmSync(root, { recursive: true, force: true });
});

test("config: discoverSkills honors explicit skills list and ignore", () => {
  const root = tmpProject();
  writeSkill(root, "one");
  writeSkill(root, "two");
  writeSkill(root, "three");

  const explicit = discoverSkills({ ...DEFAULT_CONFIG, skills: ["two", "one"] }, root);
  assert.deepEqual(explicit.map((d) => path.basename(d)).sort(), ["one", "two"]);

  const ignored = discoverSkills({ ...DEFAULT_CONFIG, ignore: ["two"] }, root);
  assert.deepEqual(ignored.map((d) => path.basename(d)), ["one", "three"]);

  fs.rmSync(root, { recursive: true, force: true });
});

test("config: discoverSkills returns empty when sourceDir is absent", () => {
  const root = tmpProject();
  assert.deepEqual(discoverSkills({ ...DEFAULT_CONFIG }, root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// init scaffolding (lives with config so loadConfig can find the output)
// --------------------------------------------------------------------------
test("init: scaffolds a valid project that loadConfig + discoverSkills can read", () => {
  const root = tmpProject();
  const res = runInit(root, {});
  assert.equal(res.created.length, 2);
  assert.ok(res.nextSteps.length > 0);

  const { config, configDir } = loadConfig(root);
  assert.equal(configDir, fs.realpathSync(root));
  const skills = discoverSkills(config, configDir);
  assert.deepEqual(skills.map((d) => path.basename(d)), ["hello-skill"]);

  fs.rmSync(root, { recursive: true, force: true });
});

test("init: refuses to overwrite unless force", () => {
  const root = tmpProject();
  runInit(root, {});
  assert.throws(() => runInit(root, {}), /--force/);
  // force succeeds
  assert.doesNotThrow(() => runInit(root, { force: true }));
  fs.rmSync(root, { recursive: true, force: true });
});
