import { Skill } from "../format.js";

export interface OutputFile {
  /** Path relative to the conversion output root. */
  path: string;
  content: string;
}

export interface TargetOutput {
  /** Relative dir holding the emitted SKILL.md (resource dirs copy here). Null if skipped. */
  skillDir: string | null;
  files: OutputFile[];
  warnings: string[];
  skipped: boolean;
}

export type TargetConverter = (skill: Skill, agents?: Skill[]) => TargetOutput;

/** Assemble a native SKILL.md from an ordered frontmatter object + markdown body. */
export function buildSkillMd(
  frontmatter: Record<string, unknown>,
  body: string,
  stringifyYaml: (v: any) => string,
): string {
  return `---\n${stringifyYaml(frontmatter)}---\n\n${body.trimEnd()}\n`;
}
