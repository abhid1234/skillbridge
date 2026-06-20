---
name: error-log-summarizer
description: Condenses a noisy error log or stack trace into the root cause, the failing call path, and the next action. Use when the user pastes a long traceback, a crash log, or CI output and asks what went wrong or what broke.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [logs, debugging, observability, triage]
---

# Error Log Summarizer

Turn a wall of log output into a tight, actionable summary. Optimize for "what actually broke and where".

## Steps
1. Find the real error. Scan for the deepest exception, the first error after the last successful step, and any `Caused by` / `from` chains. Distinguish the root cause from downstream noise (cascading retries, secondary failures).
2. Extract the failing location: file, line, function, and the specific call that threw. Quote the one or two most load-bearing log lines verbatim.
3. Group repeats. If the same error fires N times, say so once with a count instead of repeating it.
4. Classify: code bug, config/env issue, dependency/version mismatch, network/timeout, resource exhaustion (OOM, disk, connections), or permissions.
5. Pull correlation signals if present: timestamps, request/trace IDs, exit codes, hostnames.

## Output
- **Root cause:** one sentence.
- **Where:** file/line/function.
- **Evidence:** ≤3 quoted log lines.
- **Category** and **suggested next step** (the single most useful action).

Do not speculate beyond the log. If the trace is truncated and the root cause is missing, say which earlier lines are needed.
