# Research – Playwright authentication and workspace state tests

## Decisions

### Base URL for Playwright runs
- **Decision**: Use `http://localhost:3000` as the Playwright base URL. Set via `baseURL` in config or per-test `page.goto`.
- **Rationale**: Matches default Next.js dev server and existing project conventions; avoids hard-coding environment-specific hosts in specs.
- **Alternatives considered**: Environment-specific URL per run (adds config overhead); deriving from env at runtime (kept as optional override, not default).

### Test personas and data setup
- **Decision**: Rely on Supabase seeds for three deterministic personas (`seed-empty@example.com`, `seed-project@example.com`, `seed-library@example.com` with `Password123!`). Use UI-driven flows for CRUD; generate unique names per run for created entities.
- **Rationale**: Seeds provide predictable fixtures; UI-driven actions mirror user behavior; unique naming prevents collisions across runs.
- **Alternatives considered**: Direct DB mutations (would bypass RLS and diverge from user flows); fixture re-use without unique names (risk of collisions and flaky deletes).

### Registration flow coverage
- **Decision**: Create new accounts during tests using generated email aliases (timestamp-based) to avoid seed collisions; no reliance on email confirmation flows.
- **Rationale**: Keeps tests isolated per run without altering seeds; avoids external email dependency.
- **Alternatives considered**: Reusing a static test account (would require cleanup/reset each run and risk state leakage).

### Destructive actions confirmation
- **Decision**: Require confirmation modal with explicit confirm/cancel buttons for deleting projects or libraries; assert modal presence and action results.
- **Rationale**: Aligns with clarified requirement and minimizes accidental deletion risk; ensures deterministic selectors for tests.
- **Alternatives considered**: Native `window.confirm` (less controllable/stylable); immediate delete (higher risk, harder to assert).

### Test isolation & resilience
- **Decision**: Avoid shared storage state between tests; keep each test independent (no global storageState). Handle network/API failures with visible error assertions where applicable (auth errors, validation errors).
- **Rationale**: Reduces coupling and flakiness; aligns with constitution’s resilience principle.
- **Alternatives considered**: Shared signed-in storageState (faster but risks cross-test contamination and stale sessions).
