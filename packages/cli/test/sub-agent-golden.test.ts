import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

import { convertString } from "../src/convert-core.js";

const EXAMPLE = path.resolve(__dirname, "../../../../examples/code-reviewer");

// Mirrors the commit-helper byte-stable golden test in convert.test.ts, but for the
// flagship Tier-3 example: a skill that lists a sub-agent, args, a hook, scripts, and
// extended permissions, converted to ALL targets together with its sibling sub-agent.
test("golden: code-reviewer + sub-agent conversion is byte-stable across all targets", () => {
  const skill = fs.readFileSync(path.join(EXAMPLE, "skill.sb.md"), "utf8");
  const agent = fs.readFileSync(path.join(EXAMPLE, "agents/security.sb.md"), "utf8");
  const res = convertString(skill, ["claude-code", "antigravity", "codex", "cursor"], [agent]);
  assert.equal(res.ok, true);
  const manifest = res.results
    .flatMap((r) => r.files.map((f) => `### ${f.path}\n${f.content}`))
    .join("\n");
  const goldenPath = path.join(__dirname, "../../test/golden/sub-agent-skill.txt");
  const golden = fs.readFileSync(goldenPath, "utf8");
  assert.equal(manifest, golden, "conversion output changed — review the diff and update test/golden/sub-agent-skill.txt if intended");
});
