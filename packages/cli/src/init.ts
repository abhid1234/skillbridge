/**
 * `skillbridge init` — scaffold a new project: a skillbridge.config.json plus a
 * working starter skill (skills/hello-skill/skill.sb.md) that is a valid
 * core-only skill (no target-specific fields, converts cleanly to all targets).
 */
import * as fs from "fs";
import * as path from "path";
import { TARGET_IDS } from "./format.js";
import { CONFIG_FILENAME, SkillBridgeConfig } from "./config.js";

/** Starter project config written by init. */
const STARTER_CONFIG: SkillBridgeConfig = {
  version: "0.1",
  sourceDir: "skills",
  targets: [...TARGET_IDS],
  outDir: ".",
};

/** A valid core-only skill — no `targets:` block, converts to every harness. */
const STARTER_SKILL = `---
name: hello-skill
description: A starter SkillBridge skill. Greets the user and explains how to edit this file. Use when the user says hello or asks how SkillBridge works.
spec_version: "0.1"
version: "0.1.0"
keywords: [starter, example]
---

# Hello Skill

This is a starter skill authored in the portable SkillBridge format
(\`skill.sb.md\`). Edit this file, then run \`skillbridge sync\` to emit native
files for every configured target (${TARGET_IDS.join(", ")}).

## Steps
1. Greet the user warmly.
2. Tell them they can edit \`skills/hello-skill/skill.sb.md\` to change this behavior.
3. Point them at \`skillbridge sync --watch\` to rebuild on every save.
`;

export interface InitResult {
  /** Absolute paths created. */
  created: string[];
  /** Human-readable next-step lines (also printed by the CLI). */
  nextSteps: string[];
}

/**
 * Write the starter config + skill into `cwd`. Refuses to clobber an existing
 * config or starter skill unless { force: true }. Returns the created paths and
 * the next-step guidance.
 */
export function runInit(cwd: string, opts: { force?: boolean } = {}): InitResult {
  const force = opts.force === true;
  const root = path.resolve(cwd);

  const configPath = path.join(root, CONFIG_FILENAME);
  const skillDir = path.join(root, STARTER_CONFIG.sourceDir, "hello-skill");
  const skillPath = path.join(skillDir, "skill.sb.md");

  if (!force) {
    const clashes: string[] = [];
    if (fs.existsSync(configPath)) clashes.push(CONFIG_FILENAME);
    if (fs.existsSync(skillPath)) clashes.push(path.relative(root, skillPath));
    if (clashes.length > 0) {
      throw new Error(
        `Refusing to overwrite existing ${clashes.join(", ")}. Re-run with --force to overwrite.`,
      );
    }
  }

  const created: string[] = [];

  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(STARTER_CONFIG, null, 2) + "\n");
  created.push(configPath);

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillPath, STARTER_SKILL);
  created.push(skillPath);

  const nextSteps = [
    "Next steps:",
    `  1. Edit ${path.relative(root, skillPath)} to author your skill.`,
    "  2. Run  skillbridge sync           to build native files for all targets.",
    "  3. Run  skillbridge sync --watch   to rebuild automatically on save.",
    "  4. Run  skillbridge check          in CI to verify outputs are up to date.",
  ];

  return { created, nextSteps };
}
