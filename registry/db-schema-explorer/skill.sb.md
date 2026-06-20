---
name: db-schema-explorer
description: Explores a live Postgres database — lists tables, inspects columns and indexes, and answers schema questions — via a read-only Postgres MCP server. Use when the user asks what tables exist, how a table is structured, or wants to understand a database before writing a query.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [database, postgres, schema, mcp]
tools:
  filesystem: none
  mcp:
    - "postgres"
mcp:
  postgres:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"]
    env:
      DATABASE_URL: "${DATABASE_URL}"
---

# DB Schema Explorer

Map and explain a Postgres schema using the read-only `postgres` MCP server. Never mutate data.

## Steps
1. List tables and views via the MCP server's resource listing (it exposes schema as resources). If asked broadly, summarize the table inventory first.
2. For a named table, report columns with types, nullability, defaults, primary key, foreign keys, and indexes.
3. Trace relationships: follow foreign keys to describe how tables connect, and call out junction/join tables.
4. When the user wants data shape (not just structure), issue a bounded read-only query through the MCP (`SELECT … LIMIT 20`). Never run `INSERT`/`UPDATE`/`DELETE`/`DROP` — this server is read-only by design and the skill must keep it that way.
5. When the user is about to write their own query, surface the relevant indexes so they can write a fast one.

## Output
A concise schema description (tables → columns → relationships) and, when asked, a small sample. State explicitly that all access was read-only.

## Notes
- The `mcp` capability hint gates this skill to the `postgres` server. The `postgres` server is stdio (npx) and takes the connection string from `${DATABASE_URL}`.
