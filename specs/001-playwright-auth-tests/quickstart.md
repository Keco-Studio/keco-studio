# Quickstart – Playwright authentication and workspace state tests

## Prerequisites
- Node 18+ installed.
- Supabase local instance seeded via `supabase/seed.sql` (run your usual local seed workflow).
- Dependencies installed: `npm install` (or your package manager), then `npx playwright install` to fetch browsers.
- App running locally at `http://localhost:3000` (`npm run dev` or equivalent) before executing tests.

## Running the tests
- Default command: `npx playwright test` (runs all specs under `tests/`).
- Filter by file: `npx playwright test tests/e2e/<spec>.spec.ts`.
- Use headed/debug: `npx playwright test --headed --debug`.

## Test data
- Seeded personas (password `Password123!`):
  - `seed-empty@example.com`
  - `seed-project@example.com`
  - `seed-library@example.com`
- New registrations use timestamped emails to avoid collisions.
- Created projects/libraries use unique names per test; deletions exercised via confirmation modals.

## Environment configuration
- Base URL: `http://localhost:3000` (override via Playwright config `baseURL` if needed).
- Ensure env vars for Supabase match app defaults; tests rely on UI flows, not direct API calls.

## Troubleshooting
- If auth fails, verify seeds were applied and the dev server uses the same Supabase instance.
- If selectors change, update shared helper selectors in the new e2e specs to keep tests stable.
- Flaky state? Rerun seeds and restart the app to reset projects/libraries.
