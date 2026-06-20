---
name: api-endpoint-scaffolder
description: Scaffolds a new REST/HTTP API endpoint following the project's existing conventions — route, handler, validation, types, and a test. Use when the user asks to add an endpoint, create a new route, or stub out an API handler.
spec_version: "0.1"
version: "1.0.0"
license: Apache-2.0
keywords: [api, rest, scaffolding, backend, codegen]
---

# API Endpoint Scaffolder

Add a new endpoint that matches the codebase's existing patterns — never impose a foreign style.

## Steps
1. Learn the conventions first. Find one or two existing endpoints and read how the project does: routing (framework + file layout), request validation, the handler/controller shape, error responses, and where types/DTOs live.
2. Confirm the contract with the user: method + path, path/query/body params, the success response shape, auth requirement, and the error cases.
3. Generate the pieces, mirroring the existing style:
   - **Route** wiring (registered the same way as neighbors).
   - **Validation/schema** for inputs (reuse the project's validator — zod, pydantic, etc.).
   - **Handler** with the happy path plus explicit error handling and correct status codes.
   - **Types/DTOs** for request and response.
   - **Test** covering one success case and one validation-failure case.
4. Wire it in: register the route, export what needs exporting, add the import.
5. Keep the handler thin — delegate business logic to the existing service layer if the project has one; don't inline DB calls if peers don't.

## Output
The new files/edits, each labeled with its path, plus a one-line note on how to call the endpoint (sample request). Follow REST conventions: nouns for resources, correct verbs, `2xx`/`4xx`/`5xx` used precisely. Show before applying.
