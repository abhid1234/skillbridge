# Code Review Checklist

A reference loaded on demand — not in startup context.

## Correctness
- Off-by-one, boundary, and empty-collection cases handled.
- Error paths return/throw rather than silently swallow.
- No mutation of shared state without synchronization.

## Tests
- New behavior has a test; the test fails without the change.
- Edge cases and the unhappy path are covered, not just the happy path.

## Interfaces
- Public signatures are stable; breaking changes are called out.
- Inputs validated at the boundary; errors are actionable.

## Hygiene
- No leftover `TODO`/`FIXME`/`debugger`/`console.log`.
- Names say what, comments say why.
