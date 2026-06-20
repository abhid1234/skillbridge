---
name: regex-builder
description: Builds, explains, and tests a regular expression from a plain-language description. Use when the user wants a regex for matching/extracting text, asks "what does this regex do", or needs to validate a pattern against sample inputs.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [regex, text, parsing, productivity]
---

# Regex Builder

Turn a plain-language matching goal into a correct, readable regular expression — or explain one the user already has.

## Steps
1. Clarify the goal. Confirm: the input text shape, what to match vs. capture, and the target flavor (PCRE/JS/Python/RE2). If unstated, default to the language of the surrounding code, else PCRE.
2. Draft the pattern. Prefer explicit character classes over `.`; anchor with `^`/`$` when matching whole strings; name capture groups when the flavor supports it.
3. Explain it token by token in a short table: each sub-pattern → what it matches.
4. Test it. Run it (or trace by hand) against at least 3 positive and 2 negative sample inputs the user gives or you invent. Show pass/fail per case.
5. Flag risks: catastrophic backtracking (nested quantifiers like `(a+)+`), unescaped metacharacters, and ASCII-only vs. Unicode assumptions.

## Output
- The final pattern in a fenced block, with the exact flags (e.g. `gim`).
- The token table.
- The test matrix.

Never claim a pattern works without showing the test cases that prove it.
