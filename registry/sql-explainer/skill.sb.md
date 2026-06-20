---
name: sql-explainer
description: Explains what a SQL query does in plain English and flags correctness, performance, and safety issues. Use when the user pastes a SQL statement and asks what it does, why it is slow, or whether it is safe to run.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [sql, database, review, productivity]
---

# SQL Explainer

Read a SQL statement and produce a clear, structured explanation plus a risk review.

## Steps
1. Restate the query's intent in one sentence ("This returns the 10 most recent orders per customer").
2. Walk the execution order — not the written order — for SELECTs: `FROM`/joins → `WHERE` → `GROUP BY` → `HAVING` → window functions → `SELECT` → `ORDER BY` → `LIMIT`.
3. Decompose joins and subqueries: name each table, the join keys, and the join type's effect (inner drops unmatched rows; left keeps them).
4. Flag performance smells: leading-wildcard `LIKE '%x'`, functions on indexed columns in `WHERE`, `SELECT *` in hot paths, implicit cross joins, `OR` across columns, missing `LIMIT` on exploratory queries.
5. Flag safety: any `UPDATE`/`DELETE` without a `WHERE`, unparameterized literals that look like injected input, and dialect-specific syntax (Postgres vs MySQL vs BigQuery) that won't port.

## Output
A short summary line, then sections: **What it does**, **Step-by-step**, **Performance notes**, **Safety notes**. Keep it dialect-aware — name the dialect you assumed.
