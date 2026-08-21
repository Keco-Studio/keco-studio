# MCP Review Remediation Design

## Goal

Close the nine review findings without weakening the existing account/project
authorization model or allowing any provider submission without a fresh,
purpose-bound paid confirmation.

## Map Generation State Flow

All provider submissions use one path:

1. `prepare_map_generation` freezes or recovers the exact revision, creates the
   asset plan atomically, and returns a fee notice plus a short-lived token.
2. The client shows the fee notice and obtains later explicit confirmation.
3. `start_map_generation` verifies the token against the immutable map,
   revision, asset, generation, fingerprint, actor, and purpose before submit.

Failed, rate-limited, quota-blocked, and unknown-outcome replacements also
return to prepare. `retry_map_generation` is removed because its only current
implementation calls `submitAsset` and therefore cannot be a safe unconfirmed
operation.

`get_map_generation` becomes a database-only read and remains available to
viewers. A new writer-only `advance_map_generation` performs only non-submit
state advancement: it resolves an old queued/unknown boundary, polls an
existing provider job, and validates a completed result. It never creates a
new provider job. An old queued submission becomes blocked with
`pixellab_submit_outcome_unknown`; a subsequent prepare returns a
`replace-unknown` fee notice and confirmation.

## Transaction Boundaries

Draft creation claims `(actor_id, idempotency_key, normalized_intent_hash)`
before invoking the planner. A completed claim replays the saved map without
calling the planner. A conflicting hash fails immediately. An active claim
returns a stable in-progress error, and a failed planner releases its claim so
the same intent can be attempted again. Completion creates the map and attaches
the result to the claim in one transaction.

Generation preparation uses one RPC for revision validation, freeze/next-draft
creation, and asset-plan creation. The RPC also recognizes a legacy revision
that is already frozen but lacks its asset and creates the missing asset in the
same transaction. No committed state can contain a newly frozen revision
without the corresponding asset plan.

## GDS Boundary

The App API returns stable public codes for missing systems/jobs and stale
versions. The MCP error registry accepts `VERSION_STALE`, so the bridge does not
collapse it into `IDEMPOTENCY_CONFLICT`. MCP job responses never return the
stored worker exception; failed jobs expose a fixed public error object.

GDS list pagination is performed by the App API and database query. MCP cursors
carry the next offset, and each bridge request asks only for `limit + 1` rows to
derive `hasMore`. Version history remains capped before crossing the bridge.

## Folder State

All folder-create entry points set `pendingFolderParentId`. Content placement
continues to use `selectedFolderId`, keeping the two behaviors independent.

## Verification

Each finding receives a regression test that fails before its implementation.
Focused Jest and Deno suites run after every boundary change. Final verification
includes full Jest, Deno MCP tests, typechecks, MCP checks, lint, build, plugin
validation, and the nested-folder Playwright test. No paid PixelLab request is
used for acceptance.
