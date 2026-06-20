---
name: dependency-bump-checker
description: Audits a project's dependencies for outdated and vulnerable packages, then proposes a safe, staged upgrade plan. Use when the user asks what is out of date, wants to bump dependencies, or asks if any packages have known CVEs.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [dependencies, security, maintenance, npm, pip, cargo]
tools:
  filesystem: read
  shell:
    - "npm "
    - "pnpm "
    - "yarn "
    - "pip "
    - "cargo "
  network:
    - "registry.npmjs.org"
    - "pypi.org"
    - "crates.io"
---

# Dependency Bump Checker

Find outdated and vulnerable dependencies and propose an upgrade plan that minimizes breakage.

## Steps
1. Detect the ecosystem from the lockfile/manifest: `package.json`, `requirements.txt`/`pyproject.toml`, or `Cargo.toml`. Handle one ecosystem at a time.
2. List outdated packages:
   - npm/pnpm/yarn: `npm outdated --json` (or the pnpm/yarn equivalent).
   - pip: `pip list --outdated --format=json`.
   - cargo: `cargo outdated` if available, else parse `Cargo.lock`.
3. Check advisories: `npm audit --json`, `pip-audit`, or `cargo audit`. Record severity per package.
4. Classify each bump as **patch**, **minor**, or **major** (semver). Read changelogs/release notes for any major bump before recommending it.
5. Propose a staged plan: (a) security patches first, (b) safe patch/minor bumps batched, (c) each major bump isolated with a migration note and a "run the tests" checkpoint.

## Output
A table of `package | current | latest | type | CVE? | risk` and a numbered upgrade plan. Do not edit manifests or run installs without explicit approval.
