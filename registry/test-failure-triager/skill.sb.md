---
name: test-failure-triager
description: Runs the test suite, groups failures by likely root cause, and separates real regressions from flaky or environmental failures. Use when tests are failing, CI is red, or the user asks why the build broke and what to fix first.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [testing, ci, triage, debugging]
tools:
  filesystem: read
  shell:
    - "npm test"
    - "pytest"
    - "go test"
    - "cargo test"
    - "git "
---

# Test Failure Triager

Turn a red test run into a prioritized fix list, distinguishing genuine breakage from noise.

## Steps
1. Run the suite (or read provided output). Use the project's configured runner — `npm test`, `pytest`, `go test ./...`, or `cargo test`.
2. Parse results into individual failures with: test name, file, assertion message, and the failing line.
3. Cluster by root cause. Failures sharing the same exception, the same changed module, or the same fixture almost always have one fix. Report the cluster, not each leaf.
4. Separate signal from noise:
   - **Real regression** — deterministic, tied to a recent diff (`git log -p` on the touched files).
   - **Flaky** — timing/order-dependent, network, random seeds, time-of-day. Re-run once to confirm.
   - **Environmental** — missing fixture, wrong env var, version skew (not a code bug).
5. Rank clusters by blast radius (how many tests each fix unblocks) and confidence.

## Output
A ranked list: each cluster → suspected cause → the one file to look at → fix-first/defer recommendation. Then a one-line "start here". Propose fixes; don't apply them without approval.
