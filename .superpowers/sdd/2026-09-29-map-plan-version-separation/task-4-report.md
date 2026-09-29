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
