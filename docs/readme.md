# Documentation

Start here. The product/roadmap spec is [PLAN.md](../PLAN.md); these docs describe what the
implementation actually does and how to operate it.

| Doc                                  | What it covers                                                            |
| ------------------------------------ | ------------------------------------------------------------------------- |
| [architecture.md](./architecture.md) | Request lifecycle, tenancy, data flow, search, MCP, deployment topology   |
| [api.md](./api.md)                   | Endpoint reference, auth, errors, examples, MCP JSON-RPC                  |
| [connectors.md](./connectors.md)     | App Store lifecycle, provider setup, import formats, adding a connector   |
| [development.md](./development.md)   | Local setup, Bun commands, tests, formatting/linting, common issues       |
| [security.md](./security.md)         | Threat model, token encryption, SSRF, prompt injection, GDPR              |
| [operations.md](./operations.md)     | Environment variables, first deploy, rollback, cleanup, incident runbooks |
| [design.md](./design.md)             | Design tokens, Atlas, Recall, accessibility and performance budgets       |
| [decisions.md](./decisions.md)       | ADRs for deliberate deviations from the plan                              |

## Reading order

New to the codebase: ARCHITECTURE → DEVELOPMENT → SECURITY.

Shipping a deploy: OPERATIONS → SECURITY → API.

Building an integration: CONNECTORS → API → DESIGN.

## Documentation rules

- Update the closest doc in the same PR as the code. A stale doc is a bug.
- Prefer concrete commands, filenames and status codes over prose.
- Mark deferred work explicitly. "Not implemented" is useful; a placeholder card is not.
- No secrets, account ids, or customer data in examples.
