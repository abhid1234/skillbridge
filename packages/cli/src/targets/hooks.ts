/** Hook mapping: Claude Code supports skill-level hooks natively; others get a note. */
import { HooksBlock } from "../format.js";
import { YamlValue } from "../yaml.js";

export function claudeHooks(hooks?: HooksBlock): Record<string, YamlValue> | undefined {
  if (!hooks || Object.keys(hooks).length === 0) return undefined;
  return hooks as Record<string, YamlValue>;
}

/** Human-readable lines describing hooks for harnesses that can't carry them in-skill. */
export function hookSetupLines(hooks?: HooksBlock): string[] {
  if (!hooks) return [];
  return Object.entries(hooks).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join("; ") : v}`);
}
