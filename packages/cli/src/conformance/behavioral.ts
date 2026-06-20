/**
 * OPTIONAL behavioral conformance layer.
 *
 * NODE-ONLY: imports node:child_process. MUST NOT be imported by browser code
 * (it is excluded from tsconfig.web.json's include list).
 *
 * Gated behind env SKILLBRIDGE_BEHAVIORAL=1. When the gate is off, or when a
 * required harness CLI is not installed, every probe AUTO-SKIPS — it never throws.
 * Only claude-code and codex have invocable CLIs here; cursor and antigravity are
 * not installed in this environment, so their probes always report skipped.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { TargetId } from "../format.js";

export interface ProbeResult {
  target: TargetId;
  /** The CLI we tried to drive (or null if the target has no CLI probe). */
  cli: string | null;
  status: "ok" | "skipped" | "error";
  /** Why it was skipped or errored (human-readable). */
  reason?: string;
  /** Raw stdout (truncated) when status === "ok". */
  output?: string;
}

/** Is the behavioral layer enabled at all? */
export function behavioralEnabled(): boolean {
  return process.env.SKILLBRIDGE_BEHAVIORAL === "1";
}

/** Resolve a CLI on PATH via `which`; returns the path or null. Never throws. */
export function whichCli(name: string): string | null {
  try {
    const r = spawnSync("which", [name], { encoding: "utf8" });
    if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim().split("\n")[0];
  } catch {
    /* which absent or denied — treat as not found */
  }
  return null;
}

/** Maps each target to the harness CLI binary that can run a skill, if any. */
const TARGET_CLI: Partial<Record<TargetId, string>> = {
  "claude-code": "claude",
  codex: "codex",
  // cursor + antigravity: no headless skill-runner CLI here -> always skipped.
};

function truncate(s: string, n = 4000): string {
  return s.length > n ? s.slice(0, n) + "\n…[truncated]" : s;
}

/**
 * Probe one target by asking its CLI to answer a tiny prompt in a structured
 * (JSON) output mode. We are NOT asserting model behavior — we only verify the
 * harness accepts the invocation shape, which is the behavioral contract that
 * matters for "does a converted skill load here". Auto-skips when absent.
 */
export function probeTarget(target: TargetId, prompt = "Reply with the single word: ready."): ProbeResult {
  if (!behavioralEnabled()) {
    return { target, cli: null, status: "skipped", reason: "SKILLBRIDGE_BEHAVIORAL not set to 1" };
  }
  const cli = TARGET_CLI[target] ?? null;
  if (!cli) {
    return { target, cli: null, status: "skipped", reason: `no behavioral CLI probe defined for "${target}"` };
  }
  const resolved = whichCli(cli);
  if (!resolved) {
    return { target, cli, status: "skipped", reason: `\`${cli}\` not found on PATH` };
  }

  // Per-CLI invocation shape.
  let args: string[];
  if (target === "claude-code") {
    // claude -p "<prompt>" --output-format json
    args = ["-p", prompt, "--output-format", "json"];
  } else if (target === "codex") {
    // codex exec "<prompt>" --json
    args = ["exec", prompt, "--json"];
  } else {
    return { target, cli, status: "skipped", reason: `no invocation shape for "${target}"` };
  }

  try {
    const out = execFileSync(cli, args, {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { target, cli, status: "ok", output: truncate(out) };
  } catch (e) {
    // Includes ENOENT (race), non-zero exit, or timeout. Behavioral failures are
    // reported, NOT thrown, so the harness stays advisory and CI never breaks on
    // a flaky external CLI.
    const err = e as { message?: string; status?: number };
    return { target, cli, status: "error", reason: err.message ?? `exit ${err.status ?? "?"}` };
  }
}

/** Probe every target. Always returns a result per target; never throws. */
export function runBehavioralProbes(targets: TargetId[], prompt?: string): ProbeResult[] {
  return targets.map((t) => {
    try {
      return probeTarget(t, prompt);
    } catch (e) {
      return { target: t, cli: TARGET_CLI[t] ?? null, status: "skipped", reason: `probe threw: ${(e as Error).message}` };
    }
  });
}
