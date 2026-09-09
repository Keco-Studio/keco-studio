# GDD Map Image Polling Fix Plan

**Goal:** Stop generated GDD map images from repeatedly returning to a loading state after they are available.

1. Give each GDD map artifact an independent query so only missing, `queued`, or `running` artifacts poll every 15 seconds. Terminal artifacts stop timed polling, remain visible during background refreshes, and can still renew signed URLs through normal focus or mount refetches.
2. Add focused provider tests for initial loading, mixed ready/running artifacts, terminal polling shutdown, and image retention during background refresh.
3. Run focused tests, document tests, type checking, lint, the migration-change gate, and the repository Chinese-character gate; then review the final diff, commit, push, open a PR, wait for required checks, and merge after they pass.

No database migration is required because the defect is confined to client-side polling and render state.
