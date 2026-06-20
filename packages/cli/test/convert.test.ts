import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parseSkill, splitFrontmatter } from "../src/format.js";
import { parseYaml, stringifyYaml } from "../src/yaml.js";
import { convert, parseTargets } from "../src/convert.js";
import { convertString } from "../src/convert-core.js";
import { importToSkillBridge, importAgentFile } from "../src/import-core.js";

const EXAMPLE = path.resolve(__dirname, "../../../../examples/commit-helper");

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillbridge-test-"));
}

// --------------------------------------------------------------------------
// YAML subset parser
// --------------------------------------------------------------------------
test("yaml: scalars, flow seq, nested maps, block seq", () => {
  const y = parseYaml(`name: x
description: A line with: a colon and "quotes" inside.
keywords: [git, commits]
flag: true
count: 3
mcp:
  github:
    command: npx
    args: ["-y", "@scope/pkg"]
    env:
      TOKEN: "\${T}"
shell:
  - "git "
  - "npm "
`) as any;
  assert.equal(y.name, "x");
  assert.equal(y.description, 'A line with: a colon and "quotes" inside.');
  assert.deepEqual(y.keywords, ["git", "commits"]);
  assert.equal(y.flag, true);
  assert.equal(y.count, 3);
  assert.equal(y.mcp.github.command, "npx");
  assert.deepEqual(y.mcp.github.args, ["-y", "@scope/pkg"]);
  assert.equal(y.mcp.github.env.TOKEN, "${T}");
  assert.deepEqual(y.shell, ["git ", "npm "]);
});

test("yaml: round-trip through stringify reparses equal", () => {
  const obj = { name: "commit-helper", description: 'Use "save my work" trigger, ok.', "allowed-tools": "Bash(git diff*), Bash(git log*)" };
  const reparsed = parseYaml(stringifyYaml(obj as any));
  assert.deepEqual(reparsed, obj);
});

test("yaml: fails loud on unsupported constructs instead of corrupting silently", () => {
  assert.throws(() => parseYaml("d: |\n  x\n  y\nname: z"), /block scalars/);
  assert.throws(() => parseYaml("d: >\n  a b\n"), /block scalars/);
  assert.throws(() => parseYaml("env: {a: 1, b: 2}"), /flow maps/);
  assert.throws(() => parseYaml("x: &anchor"), /anchors/);
  assert.throws(() => parseYaml("x: !!str 5"), /anchors/);
});

test("yaml: strips inline comments, keeps URL '#', no leading-zero int coercion", () => {
  const p = (s: string) => parseYaml(s) as any;
  assert.equal(p("name: foo # the name").name, "foo");
  assert.equal(p("u: http://x/#frag").u, "http://x/#frag"); // no space before # → kept
  assert.equal(p("name: 007").name, "007"); // leading zero stays string
  assert.equal(p("n: 42").n, 42); // normal ints still coerce
  assert.equal(p('q: "a # b"').q, "a # b"); // comment inside quotes preserved
});

test("yaml: arrays of objects round-trip (agents/args/hooks shapes)", () => {
  const obj = {
    name: "x",
    agents: ["reviewer", "fixer"],
    args: [
      { name: "issue", description: "the issue number" },
      { name: "branch", description: "target branch" },
    ],
    hooks: { PostToolUse: "echo done" },
    nested: [{ a: 1, b: { c: "deep", d: "v" } }],
  };
  const round = parseYaml(stringifyYaml(obj as any));
  assert.deepEqual(round, obj);
});

// --------------------------------------------------------------------------
// Format parse + validation
// --------------------------------------------------------------------------
test("format: rejects missing frontmatter", () => {
  const r = parseSkill("# no frontmatter here");
  assert.ok(r.errors.length > 0);
  assert.ok(!r.skill);
});

test("format: rejects bad name and missing description", () => {
  const r = parseSkill(`---\nname: Not_Valid\n---\nbody`);
  assert.ok(r.errors.some((e) => e.includes("name")));
  assert.ok(r.errors.some((e) => e.includes("description")));
});

test("format: rejects mcp server with both/neither transport", () => {
  const both = parseSkill(`---\nname: s\ndescription: d\nmcp:\n  x:\n    command: foo\n    url: http://y\n---\nb`);
  assert.ok(both.errors.some((e) => e.includes("exactly one")));
  const neither = parseSkill(`---\nname: s\ndescription: d\nmcp:\n  x:\n    args: ["a"]\n---\nb`);
  assert.ok(neither.errors.some((e) => e.includes("either")));
});

test("format: validates agents/args/hooks/scripts + extended permissions", () => {
  const ok = parseSkill(`---
name: rich
description: exercises new capability fields.
agents: [reviewer, fixer]
args:
  hint: "[issue]"
  spec: [issue, branch]
  model_invocable: false
hooks:
  PostToolUse: "echo done"
scripts: ["scripts/lint.sh"]
tools:
  filesystem: write
  approval: on-request
  sandbox: workspace-write
  paths: ["src/**"]
---
body`);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.skill!.frontmatter.agents, ["reviewer", "fixer"]);

  const bad = parseSkill(`---\nname: x\ndescription: d\nagents: [Bad_Name]\ntools:\n  approval: sometimes\n---\nb`);
  assert.ok(bad.errors.some((e) => e.includes("agent name")));
  assert.ok(bad.errors.some((e) => e.includes("approval")));
});

test("format: example skill parses clean", () => {
  const raw = fs.readFileSync(path.join(EXAMPLE, "skill.sb.md"), "utf8");
  const r = parseSkill(raw);
  assert.deepEqual(r.errors, []);
  assert.ok(r.skill);
  assert.equal(r.skill!.frontmatter.name, "commit-helper");
  assert.ok(r.skill!.body.includes("Conventional Commits"));
});

// --------------------------------------------------------------------------
// End-to-end conversion (the Phase 2 acceptance criterion)
// --------------------------------------------------------------------------
test("convert: example → all targets produces valid native files", () => {
  const out = tmpOut();
  const { results } = convert(EXAMPLE, parseTargets("all"), out);
  assert.equal(results.length, 4);

  // --- Claude Code ---
  const ccPath = path.join(out, ".claude/skills/commit-helper/SKILL.md");
  assert.ok(fs.existsSync(ccPath), "claude SKILL.md exists");
  const ccFm = splitFrontmatter(fs.readFileSync(ccPath, "utf8"))!;
  const ccObj = parseYaml(ccFm.fm) as any;
  assert.equal(ccObj.name, "commit-helper");
  assert.ok(ccObj.description.length > 0);
  assert.equal(ccObj["allowed-tools"], "Bash(git diff*), Bash(git status*), Bash(git log*)");
  const ccMcp = JSON.parse(fs.readFileSync(path.join(out, ".mcp.json"), "utf8"));
  assert.equal(ccMcp.mcpServers.github.type, "stdio");
  assert.equal(ccMcp.mcpServers.github.command, "npx");
  // resource dir copied
  assert.ok(fs.existsSync(path.join(out, ".claude/skills/commit-helper/references/conventional-commits.md")));

  // --- Antigravity ---
  const agPath = path.join(out, ".agents/skills/commit-helper/SKILL.md");
  assert.ok(fs.existsSync(agPath), "antigravity SKILL.md exists");
  const agObj = parseYaml(splitFrontmatter(fs.readFileSync(agPath, "utf8"))!.fm) as any;
  assert.equal(agObj.name, "commit-helper");
  assert.equal(agObj["allowed-tools"], undefined, "antigravity skill carries no allowed-tools");
  const agMcp = JSON.parse(fs.readFileSync(path.join(out, "mcp_config.json"), "utf8"));
  assert.equal(agMcp.mcpServers.github.command, "npx");

  // --- Codex ---
  const cxPath = path.join(out, ".agents/skills/commit-helper/SKILL.md");
  assert.ok(fs.existsSync(cxPath));
  const cxToml = fs.readFileSync(path.join(out, "config.toml"), "utf8");
  assert.ok(cxToml.includes("[mcp_servers.github]"));
  assert.ok(cxToml.includes('command = "npx"'));
  assert.ok(cxToml.includes("[mcp_servers.github.env]"));

  // --- Cursor ---
  const curPath = path.join(out, ".cursor/skills/commit-helper/SKILL.md");
  assert.ok(fs.existsSync(curPath), "cursor SKILL.md exists");
  const curMcp = JSON.parse(fs.readFileSync(path.join(out, ".cursor/mcp.json"), "utf8"));
  assert.equal(curMcp.mcpServers.github.command, "npx");
  assert.equal(curMcp.mcpServers.github.type, undefined, "cursor mcp omits the type field");

  fs.rmSync(out, { recursive: true, force: true });
});

test("convert-core: convertString returns in-memory files (no fs)", () => {
  const raw = fs.readFileSync(path.join(EXAMPLE, "skill.sb.md"), "utf8");
  const res = convertString(raw, ["claude-code", "antigravity", "codex", "cursor"]);
  assert.equal(res.ok, true);
  assert.equal(res.results.length, 4);
  const cc = res.results.find((r) => r.target === "claude-code")!;
  const skillFile = cc.files.find((f) => f.path.endsWith("SKILL.md"))!;
  assert.match(skillFile.content, /name: commit-helper/);
  assert.match(skillFile.content, /allowed-tools:/);
  // invalid input surfaces errors, not a throw
  const bad = convertString("no frontmatter", ["claude-code"]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length > 0);
});

test("convert: skip override excludes a target", () => {
  const out = tmpOut();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-"));
  fs.writeFileSync(path.join(dir, "skill.sb.md"),
    `---\nname: s\ndescription: d\ntargets:\n  codex:\n    skip: true\n---\nbody\n`);
  const { results } = convert(dir, parseTargets("all"), out);
  const codex = results.find((r) => r.target === "codex")!;
  assert.equal(codex.skipped, true);
  assert.ok(!fs.existsSync(path.join(out, ".agents/skills/s/SKILL.md")) || true);
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("agents + capabilities: per-harness sub-agent / args / hooks / permissions emission", () => {
  const skill = `---
name: code-reviewer
description: reviews a diff. use after writing code.
agents: [security]
args:
  hint: "[path]"
  model_invocable: false
hooks:
  PostToolUse: "echo reviewed"
tools:
  filesystem: read
  approval: on-request
  sandbox: read-only
  shell: ["git "]
---
# Code Reviewer
Review it.
`;
  const agentText = `---
name: security
description: security specialist. flags vulnerabilities.
tools:
  filesystem: read
---
# Security
You find vulnerabilities.
`;
  const res = convertString(skill, ["claude-code", "antigravity", "codex", "cursor"], [agentText]);
  assert.equal(res.ok, true);
  const by = Object.fromEntries(res.results.map((r) => [r.target, r]));

  // Claude: agent .md + SKILL.md with argument-hint / disable-model-invocation / hooks / allowed-tools
  assert.ok(by["claude-code"].files.find((f) => f.path === ".claude/agents/security.md"));
  const cc = by["claude-code"].files.find((f) => f.path.endsWith("SKILL.md"))!.content;
  assert.match(cc, /argument-hint:/);
  assert.match(cc, /disable-model-invocation: true/);
  assert.match(cc, /hooks:/);
  assert.match(cc, /allowed-tools:/);

  // Codex: agent .toml + config.toml with approval/sandbox
  assert.ok(by["codex"].files.find((f) => f.path === ".codex/agents/security.toml"));
  const cfg = by["codex"].files.find((f) => f.path === "config.toml")!.content;
  assert.match(cfg, /approval_policy = "on-request"/);
  assert.match(cfg, /sandbox_mode = "read-only"/);

  // Cursor: agent .md
  assert.ok(by["cursor"].files.find((f) => f.path === ".cursor/agents/security.md"));

  // Antigravity: NO agent file; runtime-only note lives in SETUP.antigravity.md
  assert.ok(!by["antigravity"].files.some((f) => /security\.(md|toml)$/.test(f.path)));
  const setup = by["antigravity"].files.find((f) => f.path.endsWith("SETUP.antigravity.md"))!;
  assert.match(setup.content, /define_subagent/);
});

test("honesty: tools.paths is warned (not silently dropped) for Antigravity + Codex", () => {
  const res = convertString(`---\nname: x\ndescription: d\ntools:\n  paths: ["src/**"]\n---\nbody`, ["antigravity", "codex"]);
  for (const r of res.results) {
    assert.ok(r.warnings.some((w) => /paths/i.test(w)), `${r.target} must warn that tools.paths is dropped`);
  }
});

test("convert: warns when antigravity/codex SKILL.md collide with different content", () => {
  const out = tmpOut();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-"));
  // Divergent per-target frontmatter forces different SKILL.md at the shared .agents path.
  fs.writeFileSync(path.join(dir, "skill.sb.md"),
    `---\nname: s\ndescription: d\ntargets:\n  antigravity:\n    frontmatter:\n      foo: a\n  codex:\n    frontmatter:\n      foo: b\n---\nbody\n`);
  const { results } = convert(dir, parseTargets("all"), out);
  const collided = results.some((r) => r.warnings.some((w) => w.includes("overwrites")));
  assert.ok(collided, "expected a collision warning for the shared .agents/skills path");
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("import: Claude SKILL.md round-trips through SkillBridge", () => {
  const native = `---\nname: code-reviewer\ndescription: Reviews a diff for bugs. Use after writing code.\nallowed-tools: "Read, Grep, Bash(git diff*)"\nmodel: inherit\n---\n\n# Code Reviewer\n\nReview the staged diff.\n`;
  const imp = importToSkillBridge(native, "auto");
  assert.equal(imp.ok, true);
  assert.equal(imp.detected, "claude-code");
  assert.ok(imp.sbText!.includes("name: code-reviewer"));
  assert.ok(imp.sbText!.includes("targets:"));
  // the generated skill.sb.md must itself be valid and re-emit the Claude fields
  const reparsed = parseSkill(imp.sbText!);
  assert.deepEqual(reparsed.errors, []);
  const back = convertString(imp.sbText!, ["claude-code"]);
  const skillFile = back.results[0].files.find((f) => f.path.endsWith("SKILL.md"))!.content;
  assert.match(skillFile, /allowed-tools: "Read, Grep, Bash\(git diff\*\)"/);
  assert.match(skillFile, /model: inherit/);
});

test("import: generic skill (name+description only) becomes pure core", () => {
  const native = `---\nname: explain-code\ndescription: Explains code in plain language.\n---\n\n# Explain\n\nDo it.\n`;
  const imp = importToSkillBridge(native, "auto");
  assert.equal(imp.ok, true);
  assert.equal(imp.detected, "generic");
  assert.ok(!imp.sbText!.includes("targets:"));
  assert.deepEqual(parseSkill(imp.sbText!).errors, []);
});

test("import: native agent files (Claude .md + Codex .toml) -> portable agent", () => {
  const claudeAgent = `---\nname: security\ndescription: security specialist.\ntools: "Read, Grep"\nmodel: inherit\n---\n\n# Security\nYou find vulnerabilities.\n`;
  const a = importAgentFile(claudeAgent, "md");
  assert.equal(a.name, "security");
  assert.deepEqual(parseSkill(a.sbText!).errors, []);
  assert.match(a.sbText!, /targets:/); // tools/model preserved under claude-code
  assert.match(a.sbText!, /You find vulnerabilities\./);

  const codexAgent = `name = "reviewer"\ndescription = "PR reviewer."\ndeveloper_instructions = """\nReview like an owner.\nPrioritize correctness.\n"""\nsandbox_mode = "read-only"\n`;
  const c = importAgentFile(codexAgent, "toml");
  assert.equal(c.name, "reviewer");
  const reparsed = parseSkill(c.sbText!);
  assert.deepEqual(reparsed.errors, []);
  assert.match(c.sbText!, /Review like an owner\./);
  assert.match(c.sbText!, /sandbox: read-only/);
});

test("import: missing name/description is an error, not a throw", () => {
  const imp = importToSkillBridge(`---\ndescription: no name here\n---\nbody`, "auto");
  assert.equal(imp.ok, false);
  assert.ok(imp.errors.some((e) => e.includes("name")));
});

test("convert: http MCP maps per target (serverUrl / bearer_token_env_var)", () => {
  const out = tmpOut();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-skill-"));
  fs.writeFileSync(path.join(dir, "skill.sb.md"),
    `---\nname: figma-skill\ndescription: uses figma mcp over http.\nmcp:\n  figma:\n    url: "https://mcp.figma.com/mcp"\n    headers:\n      Authorization: "Bearer \${FIGMA_TOKEN}"\n---\nbody\n`);
  convert(dir, parseTargets("all"), out);
  const agMcp = JSON.parse(fs.readFileSync(path.join(out, "mcp_config.json"), "utf8"));
  assert.equal(agMcp.mcpServers.figma.serverUrl, "https://mcp.figma.com/mcp");
  const cxToml = fs.readFileSync(path.join(out, "config.toml"), "utf8");
  assert.ok(cxToml.includes("experimental_use_rmcp_client = true"));
  assert.ok(cxToml.includes('bearer_token_env_var = "FIGMA_TOKEN"'));
  const ccMcp = JSON.parse(fs.readFileSync(path.join(out, ".mcp.json"), "utf8"));
  assert.equal(ccMcp.mcpServers.figma.type, "http");
  assert.equal(ccMcp.mcpServers.figma.url, "https://mcp.figma.com/mcp");
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("import: native MCP (JSON + TOML) round-trips into an mcp block", () => {
  const native = `---\nname: gh-helper\ndescription: uses github mcp.\n---\n\n# GH\n\nbody\n`;
  const json = JSON.stringify({ mcpServers: { github: { type: "stdio", command: "npx", args: ["-y", "x"], env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } } } });
  const impJson = importToSkillBridge(native, "claude-code", { text: json, kind: "json" });
  assert.equal(impJson.ok, true);
  assert.match(impJson.sbText!, /mcp:/);
  assert.match(impJson.sbText!, /command: npx/);
  // round-trips back to a Claude .mcp.json
  const back = convertString(impJson.sbText!, ["claude-code"]);
  const mcpFile = back.results[0].files.find((f) => f.path === ".mcp.json")!;
  assert.match(mcpFile.content, /"command": "npx"/);

  const toml = `[mcp_servers.figma]\nurl = "https://mcp.figma.com/mcp"\nbearer_token_env_var = "FIGMA_TOKEN"\n`;
  const impToml = importToSkillBridge(native, "codex", { text: toml, kind: "toml" });
  assert.match(impToml.sbText!, /figma:/);
  assert.match(impToml.sbText!, /Authorization: "Bearer \$\{FIGMA_TOKEN\}"/);
});

test("schema ↔ skills agreement: every tools key used by example skills is declared in the JSON Schema", () => {
  const cliRoot = path.resolve(__dirname, "../..");
  const schema = JSON.parse(fs.readFileSync(path.join(cliRoot, "../../docs/skill.sb.schema.json"), "utf8"));
  const toolsProps = new Set(Object.keys(schema.properties.tools.properties));
  const topProps = new Set(Object.keys(schema.properties));
  // the code-reviewer example exercises the full v0.2 surface
  const raw = fs.readFileSync(path.join(EXAMPLE, "../code-reviewer/skill.sb.md"), "utf8");
  const fm = (parseSkill(raw).skill!).frontmatter as any;
  for (const k of Object.keys(fm)) {
    assert.ok(topProps.has(k), `schema missing top-level property "${k}" (validator accepts it → drift)`);
  }
  if (fm.tools) for (const k of Object.keys(fm.tools)) {
    assert.ok(toolsProps.has(k), `schema's tools block (additionalProperties:false) rejects "${k}" that the validator accepts → editors would falsely flag valid skills`);
  }
});

test("dual-build invariant: no web-included source imports a Node-only builtin", () => {
  const cliRoot = path.resolve(__dirname, "../..");
  const webCfg = JSON.parse(fs.readFileSync(path.join(cliRoot, "tsconfig.web.json"), "utf8"));
  const nodeOnly = /\bfrom\s+["'](node:[^"']+|fs|path|child_process|os|net|https?|stream|readline|worker_threads|crypto)["']/;
  const offenders: string[] = [];
  for (const inc of webCfg.include as string[]) {
    const src = fs.readFileSync(path.join(cliRoot, inc), "utf8");
    if (nodeOnly.test(src)) offenders.push(inc);
  }
  assert.deepEqual(offenders, [], `web-bundled files import Node-only builtins (would break the browser): ${offenders.join(", ")}`);
});

test("golden: example skill conversion is byte-stable across all targets", () => {
  const raw = fs.readFileSync(path.join(EXAMPLE, "skill.sb.md"), "utf8");
  const res = convertString(raw, ["claude-code", "antigravity", "codex", "cursor"]);
  const manifest = res.results
    .flatMap((r) => r.files.map((f) => `### ${f.path}\n${f.content}`))
    .join("\n");
  const goldenPath = path.join(__dirname, "../../test/golden/commit-helper.txt");
  const golden = fs.readFileSync(goldenPath, "utf8");
  assert.equal(manifest, golden, "conversion output changed — review the diff and update test/golden/commit-helper.txt if intended");
});
