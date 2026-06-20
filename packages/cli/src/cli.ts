#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { convert, parseTargets, loadSkill, importFile } from "./convert.js";
import { SourceHarness } from "./import-core.js";
import { TARGET_IDS, SPEC_VERSION } from "./format.js";
import { loadConfig } from "./config.js";
import { planSync, runSync, checkDrift, watchSync } from "./sync.js";
import { runInit } from "./init.js";
import { adoptRepo, writeAdopted } from "./adopt.js";
import { diagnose, applyFix } from "./doctor-core.js";
import { compatibilityMatrix, svgBadge, TARGET_LABELS } from "./badge-core.js";

const HELP = `skillbridge — write an agent skill once, run it on any agent.

Usage:
  skillbridge convert <skill> --to <targets> [--out <dir>]
  skillbridge import <SKILL.md> [--from <harness>] [--mcp <file>] [--out <file>]
  skillbridge validate <skill>
  skillbridge init [<dir>] [--force]
  skillbridge sync [--watch] [--dry-run] [--config <dir>]
  skillbridge check [--config <dir>]
  skillbridge adopt <repo> [--out <dir>]
  skillbridge doctor <skill> [--fix]
  skillbridge badge <skill> [--out <file.svg>]
  skillbridge --help | --version

Arguments:
  <skill>            Path to a skill directory or a skill.sb.md file.
  <SKILL.md>         Path to a native harness SKILL.md to import.
  <repo>             A repo to scan for native skills to adopt.

Options:
  --to <targets>     Comma-separated targets, or "all". Valid: ${TARGET_IDS.join(", ")}, all.
  --from <harness>   Source harness for import: ${TARGET_IDS.join(", ")}, auto (default).
  --mcp <file>       Native MCP config to import alongside a SKILL.md.
  --out <dir|file>   Output location (convert/adopt: dir; import/badge: file).
  --config <dir>     Where to start the skillbridge.config.json search (sync/check).
  --watch            Keep syncing on every source change (sync).
  --dry-run          Show what sync would write without writing (sync).
  --fix              Apply doctor's auto-fixes to the skill in place.
  --force            Overwrite existing files (init).
  -h, --help         Show this help.    -v, --version   Show version.

Examples:
  skillbridge convert ./examples/commit-helper --to all --out ./build
  skillbridge init && skillbridge sync --watch
  skillbridge check                       # CI drift gate (non-zero on drift)
  skillbridge adopt . --out ./adopted     # bring existing native skills in
  skillbridge doctor ./my-skill --fix
`;

interface Flags {
  to?: string;
  out?: string;
  from?: string;
  mcp?: string;
  config?: string;
  watch?: boolean;
  dryRun?: boolean;
  force?: boolean;
  fix?: boolean;
  _: string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to") flags.to = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--from") flags.from = argv[++i];
    else if (a === "--mcp") flags.mcp = argv[++i];
    else if (a === "--config") flags.config = argv[++i];
    else if (a === "--watch") flags.watch = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--fix") flags.fix = true;
    else if (a.startsWith("--to=")) flags.to = a.slice(5);
    else if (a.startsWith("--out=")) flags.out = a.slice(6);
    else if (a.startsWith("--from=")) flags.from = a.slice(7);
    else if (a.startsWith("--mcp=")) flags.mcp = a.slice(6);
    else if (a.startsWith("--config=")) flags.config = a.slice(9);
    else flags._.push(a);
  }
  return flags;
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** Read a skill's raw text, accepting a dir (→ skill.sb.md) or a file path. */
function readSkillRaw(arg: string): string {
  const p = fs.existsSync(arg) && fs.statSync(arg).isDirectory() ? path.join(arg, "skill.sb.md") : arg;
  return fs.readFileSync(p, "utf8");
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(HELP);
    return;
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    console.log(`skillbridge (spec ${SPEC_VERSION})`);
    return;
  }

  const cmd = argv[0];
  const flags = parseArgs(argv.slice(1));

  if (cmd === "validate") {
    const skillArg = flags._[0];
    if (!skillArg) fail("validate requires a <skill> path.");
    try {
      const { warnings } = loadSkill(skillArg);
      console.log(`✓ valid SkillBridge skill`);
      for (const w of warnings) console.log(`  ⚠ ${w}`);
    } catch (e) {
      fail((e as Error).message);
    }
    return;
  }

  if (cmd === "import") {
    const fileArg = flags._[0];
    if (!fileArg) fail("import requires a path to a native SKILL.md.");
    const from = (flags.from ?? "auto") as SourceHarness | "auto";
    const validFrom: string[] = ["auto", ...TARGET_IDS];
    if (!validFrom.includes(from)) fail(`--from must be one of ${validFrom.join(", ")}.`);
    let res;
    try {
      res = importFile(fileArg, from, flags.mcp);
    } catch (e) {
      fail((e as Error).message);
    }
    if (!res.ok) fail("import failed:\n  - " + res.errors.join("\n  - "));
    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, res.sbText!);
      console.error(`✓ imported (from ${res.detected}) → ${flags.out}`);
    } else {
      process.stdout.write(res.sbText!);
    }
    for (const w of res.warnings) console.error(`⚠ ${w}`);
    return;
  }

  if (cmd === "convert") {
    const skillArg = flags._[0];
    if (!skillArg) fail("convert requires a <skill> path.");
    if (!flags.to) fail("convert requires --to <targets>.");
    let targets;
    try {
      targets = parseTargets(flags.to);
    } catch (e) {
      fail((e as Error).message);
    }
    const outRoot = path.resolve(flags.out ?? ".");
    try {
      const { warnings, results } = convert(skillArg, targets!, outRoot);
      for (const w of warnings) console.log(`⚠ ${w}`);
      for (const r of results) {
        if (r.skipped) {
          console.log(`• ${r.target}: skipped (${r.warnings.join("; ")})`);
          continue;
        }
        console.log(`✓ ${r.target} → ${r.skillDir}`);
        for (const f of r.written) console.log(`    ${f}`);
        for (const d of r.copiedDirs) console.log(`    ${r.skillDir}/${d}/  (copied)`);
        for (const w of r.warnings) console.log(`    ⚠ ${w}`);
      }
      console.log(`\nDone → ${outRoot}`);
    } catch (e) {
      fail((e as Error).message);
    }
    return;
  }

  if (cmd === "init") {
    try {
      const cwd = flags._[0] ? path.resolve(flags._[0]) : process.cwd();
      const { created, nextSteps } = runInit(cwd, { force: flags.force });
      for (const p of created) console.log(`  created ${path.relative(process.cwd(), p)}`);
      for (const line of nextSteps) console.log(line);
    } catch (e) {
      fail((e as Error).message);
    }
    return;
  }

  if (cmd === "sync" || cmd === "check") {
    let loaded;
    try {
      loaded = loadConfig(flags.config ?? process.cwd());
    } catch (e) {
      fail((e as Error).message);
    }
    const { config, configDir, warnings } = loaded;
    for (const w of warnings) console.log(`⚠ ${w}`);
    const plan = planSync(config, configDir);
    if (plan.errors.length) fail("sync failed:\n  - " + plan.errors.join("\n  - "));

    if (cmd === "check") {
      const d = checkDrift(plan);
      if (d.inSync) {
        console.log("✓ all native files in sync");
        return;
      }
      for (const m of d.missing) console.log(`  missing: ${m}`);
      for (const f of d.drifted) console.log(`  drift:   ${f}`);
      console.error('native files are out of sync — run "skillbridge sync" and stage the result.');
      process.exit(1);
    }

    // sync
    const report = (p: typeof plan): void => {
      const r = runSync(p, { dryRun: flags.dryRun });
      for (const f of r.written) console.log(`  ${flags.dryRun ? "would write" : "wrote"} ${f}`);
      for (const w of r.warnings) console.log(`  ⚠ ${w}`);
    };
    report(plan);
    if (flags.watch) {
      console.log(`watching ${path.join(configDir, config.sourceDir)} … (Ctrl-C to stop)`);
      watchSync(config, configDir, (p) => report(p));
      return; // long-lived
    }
    console.log(`\nDone → ${plan.outRoot}`);
    return;
  }

  if (cmd === "adopt") {
    const repo = flags._[0];
    if (!repo) fail("adopt requires a <repo> path.");
    const outDir = path.resolve(flags.out ?? "./adopted");
    try {
      const result = adoptRepo(repo);
      for (const s of result.skills) {
        console.log(`✓ ${s.name}  (from ${s.sources.length} source(s))`);
        for (const c of s.conflicts) console.log(`    ⚠ conflict: ${c}`);
      }
      const { written, warnings } = writeAdopted(result, outDir);
      for (const w of [...result.warnings, ...warnings]) console.log(`⚠ ${w}`);
      console.log(`\nAdopted ${result.skills.length} skill(s), ${written.length} file(s) → ${outDir}`);
    } catch (e) {
      fail((e as Error).message);
    }
    return;
  }

  if (cmd === "doctor") {
    const skillArg = flags._[0];
    if (!skillArg) fail("doctor requires a <skill> path.");
    let raw: string;
    try { raw = readSkillRaw(skillArg); } catch (e) { fail((e as Error).message); }
    const report = diagnose(raw);
    if (!report.ok) fail("skill does not parse:\n  - " + report.errors.join("\n  - "));
    if (report.findings.length === 0) {
      console.log("✓ no portability issues found");
      return;
    }
    let fixed = raw;
    let applied = 0;
    for (const f of report.findings) {
      const icon = f.level === "warn" ? "⚠" : "•";
      console.log(`${icon} ${f.message}`);
      if (flags.fix && f.fix) {
        const r = applyFix(f, fixed);
        if (r.ok && r.raw) { fixed = r.raw; applied++; }
      }
    }
    if (flags.fix && applied > 0) {
      const p = fs.existsSync(skillArg) && fs.statSync(skillArg).isDirectory() ? path.join(skillArg, "skill.sb.md") : skillArg;
      fs.writeFileSync(p, fixed);
      console.log(`\n✓ applied ${applied} fix(es) → ${p}`);
    }
    return;
  }

  if (cmd === "badge") {
    const skillArg = flags._[0];
    if (!skillArg) fail("badge requires a <skill> path.");
    let raw: string;
    try { raw = readSkillRaw(skillArg); } catch (e) { fail((e as Error).message); }
    const matrix = compatibilityMatrix(raw);
    if (!matrix.ok) fail("skill does not parse:\n  - " + matrix.errors.join("\n  - "));
    for (const e of matrix.entries) console.log(`  ${TARGET_LABELS[e.target]}: ${e.status}`);
    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, svgBadge(matrix));
      console.log(`\n✓ badge → ${flags.out}`);
    }
    return;
  }

  fail(`unknown command "${cmd}". Run "skillbridge --help".`);
}

main();
