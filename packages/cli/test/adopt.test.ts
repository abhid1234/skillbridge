import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { detectSkillFiles, RepoFile } from "../src/adopt-core.js";
import { adoptRepo, writeAdopted } from "../src/adopt.js";
import { parseSkill } from "../src/format.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sb-adopt-"));
}

const CLAUDE_SKILL = `---
name: commit-helper
description: Writes a clear commit message. Use when committing.
allowed-tools: "Bash(git diff*), Bash(git log*)"
---

# Commit Helper

Stage and write a Conventional Commit.
`;

// Identical body/core under .agents (generic harness, no Claude-only fields).
const GENERIC_SKILL = `---
name: commit-helper
description: Writes a clear commit message. Use when committing.
---

# Commit Helper

Stage and write a Conventional Commit.
`;

test("adopt-core: identical skill across .claude + .agents -> one source, zero conflicts", () => {
  const files: RepoFile[] = [
    { path: ".claude/skills/commit-helper/SKILL.md", content: GENERIC_SKILL },
    { path: ".agents/skills/commit-helper/SKILL.md", content: GENERIC_SKILL },
  ];
  const res = detectSkillFiles(files);
  assert.equal(res.skills.length, 1);
  const sk = res.skills[0];
  assert.equal(sk.name, "commit-helper");
  assert.equal(sk.sources.length, 2);
  assert.deepEqual(sk.conflicts, []);
  // the unified source is a valid SkillBridge skill
  assert.deepEqual(parseSkill(sk.sbText).errors, []);
});

test("adopt-core: divergent body -> exactly one conflict", () => {
  const diverged = GENERIC_SKILL.replace("Stage and write a Conventional Commit.", "Do something entirely different.");
  const files: RepoFile[] = [
    { path: ".claude/skills/commit-helper/SKILL.md", content: GENERIC_SKILL },
    { path: ".agents/skills/commit-helper/SKILL.md", content: diverged },
  ];
  const res = detectSkillFiles(files);
  assert.equal(res.skills.length, 1);
  const sk = res.skills[0];
  assert.equal(sk.conflicts.length, 1);
  assert.match(sk.conflicts[0], /body differs/);
});

test("adopt-core: Claude allowed-tools preserved through adoption", () => {
  const files: RepoFile[] = [
    { path: ".claude/skills/commit-helper/SKILL.md", content: CLAUDE_SKILL },
  ];
  const res = detectSkillFiles(files);
  assert.equal(res.skills.length, 1);
  const sk = res.skills[0];
  // preserved under targets.claude-code.frontmatter
  assert.match(sk.sbText, /allowed-tools/);
  const parsed = parseSkill(sk.sbText);
  assert.deepEqual(parsed.errors, []);
  const cc = parsed.skill!.frontmatter.targets?.["claude-code"]?.frontmatter as any;
  assert.equal(cc["allowed-tools"], "Bash(git diff*), Bash(git log*)");
});

test("adopt-core: sibling .mcp.json is picked up into the mcp block", () => {
  const mcp = JSON.stringify({
    mcpServers: { github: { type: "stdio", command: "npx", args: ["-y", "x"], env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } } },
  });
  const files: RepoFile[] = [
    { path: ".claude/skills/commit-helper/SKILL.md", content: CLAUDE_SKILL },
    { path: ".mcp.json", content: mcp },
  ];
  const res = detectSkillFiles(files);
  const sk = res.skills[0];
  assert.match(sk.sbText, /mcp:/);
  assert.match(sk.sbText, /command: npx/);
  const parsed = parseSkill(sk.sbText);
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.skill!.frontmatter.mcp?.github);
});

test("adopt (fs): walks a repo and skips node_modules", () => {
  const repo = tmpDir();
  // a real native skill
  fs.mkdirSync(path.join(repo, ".claude/skills/commit-helper"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".claude/skills/commit-helper/SKILL.md"), CLAUDE_SKILL);
  // a decoy skill inside node_modules that must be ignored
  fs.mkdirSync(path.join(repo, "node_modules/pkg/.claude/skills/ghost"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules/pkg/.claude/skills/ghost/SKILL.md"), GENERIC_SKILL.replace("commit-helper", "ghost"));

  const res = adoptRepo(repo);
  assert.equal(res.skills.length, 1, "node_modules skill must be skipped");
  assert.equal(res.skills[0].name, "commit-helper");

  const out = tmpDir();
  const { written } = writeAdopted(res, out);
  assert.ok(written.includes("commit-helper/skill.sb.md"));
  assert.ok(fs.existsSync(path.join(out, "commit-helper/skill.sb.md")));

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

test("adopt-core: native agent files become portable agents", () => {
  const claudeAgent = `---
name: security
description: security specialist. flags vulns.
tools: "Read, Grep"
---

# Security
You find vulnerabilities.
`;
  const files: RepoFile[] = [
    { path: ".claude/skills/commit-helper/SKILL.md", content: CLAUDE_SKILL },
    { path: ".claude/agents/security.md", content: claudeAgent },
  ];
  const res = detectSkillFiles(files);
  assert.equal(res.agents.length, 1);
  assert.equal(res.agents[0].name, "security");
  assert.deepEqual(parseSkill(res.agents[0].sbText).errors, []);
});
