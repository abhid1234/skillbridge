---
name: markdown-table-formatter
description: Cleans up and aligns messy Markdown tables, or converts CSV/TSV/loose text into a well-formed Markdown table. Use when the user has a broken, ragged, or unaligned table, or wants tabular data turned into Markdown.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [markdown, tables, formatting, docs]
---

# Markdown Table Formatter

Produce a clean, column-aligned GitHub-Flavored Markdown table from whatever the user gives you.

## Steps
1. Identify the source format: existing MD table, CSV, TSV, or free text with a consistent delimiter. If the delimiter is ambiguous, ask.
2. Parse into rows and columns. Treat the first row as the header unless the user says otherwise. Pad short rows and trim extra cells so every row has the same column count.
3. Normalize cells: trim whitespace, collapse internal runs of spaces, and escape literal pipes as `\|`.
4. Choose column alignment from the data: right-align purely numeric columns (`---:`), left-align text (`:---`), center short enums if asked. Set the separator row accordingly.
5. Pad each column to the width of its widest cell so the raw Markdown is readable in source, not just rendered.

## Rules
- Output only the table in a fenced ```` ```markdown ```` block unless the user wants it inline.
- Never invent data to fill gaps — leave empty cells empty.
- If a table exceeds ~8 columns, suggest splitting or transposing rather than producing an unreadable wide table.
