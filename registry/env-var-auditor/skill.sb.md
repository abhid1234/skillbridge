---
name: env-var-auditor
description: Audits a repository for environment-variable hygiene — undocumented vars, missing .env.example entries, and secrets accidentally committed. Use when the user asks to check env vars, verify .env.example is complete, or scan for leaked secrets in config.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [env, secrets, configuration, security, audit]
tools:
  filesystem: read
  shell:
    - "git "
    - "grep "
    - "rg "
---

# Env Var Auditor

Cross-check the environment variables the code reads against what is documented, and surface any committed secrets.

## Steps
1. Find every var the code references. Search for `process.env.X`, `os.environ[...]` / `os.getenv`, `std::env::var`, `${VAR}` in configs, and `System.getenv`. Build the **referenced** set.
2. Find the **documented** set: parse `.env.example` / `.env.sample` / `env.template` and any README env table.
3. Diff the two:
   - Referenced but undocumented → must be added to `.env.example` (with a placeholder, never a real value).
   - Documented but unreferenced → likely dead; flag for removal.
4. Scan for committed secrets: look for real-looking values in `.env`, config files, and the git history (`git log -p -- .env`). Treat anything matching common key shapes (long base64/hex, `AKIA…`, `sk-…`, `-----BEGIN … KEY-----`) as a finding.
5. Confirm `.env`, `.env.local`, and key files are in `.gitignore`.

## Output
Three sections — **Missing from .env.example**, **Unused / dead**, **Potential committed secrets** (with file:line). For any real secret, recommend rotating it, not just deleting the line. Never print full secret values back — mask the middle.
