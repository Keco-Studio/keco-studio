# Task 5 Report: Create Map Version Lifecycle Browser Coverage

## Delivered

- Added the lifecycle scenario `keeps Map V1 bound to Plan V1 after later saved plans`.
- Extended the E2E mock backend to mirror the V3 production contracts:
  - `save_map_plan_v3` persists immutable, idempotent Plan snapshots without creating an image.
  - generation preparation requires the current matching Plan snapshot and binds it to the generated revision.
  - Map version numbers remain unset while generating and are allocated when the image reaches `ready`.
  - map-version history reads the stored Map-to-Plan binding.
- Updated shared generation setup to save a Plan before generation, and saves a new Plan before a regeneration from the successor Draft.

## Verification

- `git diff --check`: passed.
- `npm run test:e2e:create-map-v3 -- --grep "keeps Map V1 bound to Plan V1"`: blocked before the test body executes. Playwright Chromium cannot start because `libnspr4.so` is missing from the environment.
- `npm run test:create-map-v3`: 37 suites and 393 tests passed; one unrelated existing assertion failed in `tests/unit/create-map/create-map-shell.test.ts`, which expects `Version3` in browse-mode markup.

The browser dependency must be restored before the focused lifecycle test or complete Create Map E2E suite can execute.
