# Task 4 Report: Bound Map and Plan Version History

## Delivered

- History now lists explicit `MAP Vn` and independently bound `Plan Vm` labels.
- Selecting a history entry loads its exact `loadMapVersionV3` workspace and displays its image, scene, and immutable Plan snapshot.
- Historical workspaces disable plan editing and saving, references, collision editing and analysis, and generation controls.
- Historical state overlays the active Draft and is cleared without persistence when leaving the selection, preserving the existing Draft and saved-Plan selection flow.

## Verification

- `npx jest --runInBand tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx`
  - 2 suites passed, 17 tests passed.
- `npx tsc --noEmit --pretty false`
  - exited successfully.
- `git diff --check`
  - exited successfully.

## Follow-up Review Fixes

- Centralized history invalidation increments the selection epoch before clearing or replacing a historical workspace, so a late `loadMapVersionV3` result cannot reopen it.
- `MapSourcePanel` now receives effective historical read-only state.
- Collision analysis invalidates its request epoch whenever analysis is disabled or re-enabled, and resets its attempted key so the restored active Draft starts a fresh analysis.

### Follow-up Verification

- `npx jest --runInBand tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/direct-map-collision-history-cancellation.test.tsx`
  - 3 suites passed, 18 tests passed.
- `npx tsc --noEmit --pretty false`
  - exited successfully.
