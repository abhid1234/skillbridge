import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { parseYaml, stringifyYaml } from "../src/yaml.js";
import { parseSkill, splitFrontmatter } from "../src/format.js";
import { convertString } from "../src/convert-core.js";
import { importToSkillBridge } from "../src/import-core.js";

const REG = path.resolve(__dirname, "../../../registry");
const EX = path.resolve(__dirname, "../../../examples");

// ---- deterministic PRNG (no Math.random → reproducible) ----
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const CHARS = "abcXYZ012 :#,\"'/.@-_\\";
function randStr(r: () => number): string {
  const n = Math.floor(r() * 14);
  let s = "";
  for (let i = 0; i < n; i++) s += CHARS[Math.floor(r() * CHARS.length)];
  return s; // never contains a newline
}
function randScalar(r: () => number): any {
  const t = r();
  if (t < 0.6) return randStr(r);
  if (t < 0.85) return Math.floor(r() * 1000); // ints, no leading zero
  return r() < 0.5;
}
function randMap(r: () => number, depth: number): any {
  const n = 1 + Math.floor(r() * 3); // non-empty
  const m: any = {};
  for (let i = 0; i < n; i++) m["k" + i] = randValue(r, depth);
  return m;
}
function randValue(r: () => number, depth: number): any {
  const t = r();
  if (depth <= 0 || t < 0.55) return randScalar(r);
  if (t < 0.72) { // array of scalars (flow seq)
    const n = 1 + Math.floor(r() * 3); const a: any[] = [];
    for (let i = 0; i < n; i++) a.push(randScalar(r));
    return a;
  }
  if (t < 0.85) { // array of NON-EMPTY maps (block seq)
    const n = 1 + Math.floor(r() * 2); const a: any[] = [];
    for (let i = 0; i < n; i++) a.push(randMap(r, depth - 1));
    return a;
  }
  return randMap(r, depth - 1); // nested map
}

test("yaml fuzz: parseYaml(stringifyYaml(x)) === x over 2000 random structures (supported subset)", () => {
  const r = rng(0xC0FFEE);
  for (let i = 0; i < 2000; i++) {
    const x = randMap(r, 3);
    let round: any;
    try {
      round = parseYaml(stringifyYaml(x));
    } catch (e) {
      assert.fail(`iter ${i}: round-trip threw on ${JSON.stringify(x)} :: ${(e as Error).message}`);
    }
    assert.deepEqual(round, x, `iter ${i}: round-trip mismatch for ${JSON.stringify(x)}\n  emitted:\n${stringifyYaml(x)}`);
  }
});

test("splitFrontmatter: a body containing a '---' line is not mistaken for the fence", () => {
  const raw = "---\nname: x\ndescription: d\n---\n\n# Title\n\nsome text\n\n---\n\nmore text after a rule\n";
  const s = splitFrontmatter(raw)!;
  assert.match(s.fm, /name: x/);
  assert.ok(s.body.includes("more text after a rule"), "body after a markdown --- rule must survive");
});

function allSkills(): { name: string; raw: string }[] {
  const out: { name: string; raw: string }[] = [];
  for (const root of [REG, EX]) {
    if (!fs.existsSync(root)) continue;
    for (const n of fs.readdirSync(root)) {
      const f = path.join(root, n, "skill.sb.md");
      if (fs.existsSync(f)) out.push({ name: n, raw: fs.readFileSync(f, "utf8") });
    }
  }
  return out;
}

test("invariant: the markdown body survives byte-for-byte into every emitted SKILL.md", () => {
  for (const { name, raw } of allSkills()) {
    const srcBody = splitFrontmatter(raw)!.body.trimEnd();
    const res = convertString(raw, ["claude-code", "antigravity", "codex", "cursor"]);
    assert.ok(res.ok, `${name} must convert`);
    for (const r of res.results) {
      const skill = r.files.find((f) => f.path.endsWith("SKILL.md"));
      if (!skill) continue;
      const outBody = splitFrontmatter(skill.content)!.body.trimEnd();
      assert.equal(outBody, srcBody, `${name} → ${r.target}: body must be preserved byte-for-byte`);
    }
  }
});

test("invariant: convert is idempotent (byte-identical across runs)", () => {
  for (const { name, raw } of allSkills()) {
    const m = () => JSON.stringify(convertString(raw, ["claude-code", "antigravity", "codex", "cursor"]).results.flatMap((r) => r.files.map((f) => [f.path, f.content])));
    assert.equal(m(), m(), `${name} conversion must be deterministic`);
  }
});

test("invariant: MCP servers survive convert → import(SKILL.md + .mcp.json) round-trip", () => {
  // stdio + http servers
  const raw = `---
name: mcp-rt
description: round-trips mcp.
mcp:
  gh:
    command: npx
    args: ["-y", "@x/server"]
    env:
      TOKEN: "\${TOKEN}"
  figma:
    url: "https://mcp.figma.com/mcp"
    headers:
      Authorization: "Bearer \${FIGMA}"
---
body
`;
  const cc = convertString(raw, ["claude-code"]).results[0];
  const skillMd = cc.files.find((f) => f.path.endsWith("SKILL.md"))!.content;
  const mcpJson = cc.files.find((f) => f.path === ".mcp.json")!.content;
  const back = importToSkillBridge(skillMd, "claude-code", { text: mcpJson, kind: "json" });
  assert.ok(back.ok);
  const fm = parseSkill(back.sbText!).skill!.frontmatter as any;
  assert.equal(fm.mcp.gh.command, "npx");
  assert.deepEqual(fm.mcp.gh.args, ["-y", "@x/server"]);
  assert.equal(fm.mcp.gh.env.TOKEN, "${TOKEN}");
  assert.equal(fm.mcp.figma.url, "https://mcp.figma.com/mcp");
  assert.equal(fm.mcp.figma.headers.Authorization, "Bearer ${FIGMA}");
});

test("invariant: Claude SKILL.md re-imports to a valid skill preserving name + description", () => {
  for (const { name, raw } of allSkills()) {
    const parsed = parseSkill(raw).skill!;
    const cc = convertString(raw, ["claude-code"]).results[0].files.find((f) => f.path.endsWith("SKILL.md"))!;
    const back = importToSkillBridge(cc.content, "claude-code");
    assert.ok(back.ok, `${name}: re-import must succeed`);
    const reparsed = parseSkill(back.sbText!).skill!;
    assert.equal(reparsed.frontmatter.name, parsed.frontmatter.name, `${name}: name preserved through round-trip`);
    assert.equal(reparsed.frontmatter.description, parsed.frontmatter.description, `${name}: description preserved`);
  }
});
