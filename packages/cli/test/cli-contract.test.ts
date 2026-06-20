import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve(__dirname, "../src/cli.js");
const EXAMPLE = path.resolve(__dirname, "../../../../examples/commit-helper");

function run(args: string[], cwd?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

test("cli: --help and --version exit 0", () => {
  const h = run(["--help"]);
  assert.equal(h.status, 0);
  assert.match(h.out, /Usage:/);
  assert.equal(run(["--version"]).status, 0);
});

test("cli: unknown command exits 1", () => {
  const r = run(["frobnicate"]);
  assert.equal(r.status, 1);
  assert.match(r.out, /unknown command/);
});

test("cli: convert requires --to; missing path errors", () => {
  assert.equal(run(["convert", EXAMPLE]).status, 1); // no --to
  assert.equal(run(["convert", "/no/such/skill", "--to", "all"]).status, 1);
  assert.equal(run(["convert", EXAMPLE, "--to", "bogus-harness"]).status, 1);
});

test("cli: validate exits 0 for valid, 1 for invalid", () => {
  assert.equal(run(["validate", EXAMPLE]).status, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-bad-"));
  fs.writeFileSync(path.join(dir, "skill.sb.md"), "---\nname: Bad_Name\n---\nx");
  assert.equal(run(["validate", dir]).status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cli: convert to all targets exits 0 and writes files", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "sb-out-"));
  const r = run(["convert", EXAMPLE, "--to", "all", "--out", out]);
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(out, ".claude/skills/commit-helper/SKILL.md")));
  fs.rmSync(out, { recursive: true, force: true });
});

test("cli: init → sync → check is clean (0); drift fails (1); re-sync clean (0)", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "sb-proj-"));
  assert.equal(run(["init"], proj).status, 0);
  assert.equal(run(["sync"], proj).status, 0);
  assert.equal(run(["check"], proj).status, 0, "in sync → exit 0");
  // corrupt one emitted file
  const emitted = path.join(proj, ".claude/skills/hello-skill/SKILL.md");
  fs.appendFileSync(emitted, "\ndrift\n");
  assert.equal(run(["check"], proj).status, 1, "drift → exit 1 (CI gate)");
  assert.equal(run(["sync"], proj).status, 0);
  assert.equal(run(["check"], proj).status, 0, "re-sync restores → exit 0");
  fs.rmSync(proj, { recursive: true, force: true });
});
