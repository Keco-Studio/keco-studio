# Create Map Real-Data Repair Design

## Goal

Make the existing Create Map workflow complete successfully against a real Keco Document, the configured LLM, local Supabase persistence, and the real PixelLab provider. Preserve the retained Qinghe Ranch test data and use it for the final regression run.

## Scope

The repair covers the four failures reproduced during the 2026-08-10 real-data test:

1. Model plans fail validation because constrained numeric fields may arrive as strings and the correction request lacks enough context to repair the previous plan reliably.
2. The PixelLab Edge Function sends the bearer token twice while validating a user, causing the local Auth gateway to reject the request.
3. `transition_map_asset` uses an unqualified `status` reference that conflicts with its `RETURNS TABLE` output variable.
4. Deno 2.9 type checking rejects `Uint8Array<ArrayBufferLike>` at Web Crypto and Blob boundaries.

The repair does not add map history UI, automatic coordinate clamping, relaxed domain validation, new asset types, or a new generation provider.

## Design

### Map Plan Boundary

The tool schema will state explicit integer types for `schemaVersion`, map dimensions, and `tileSize`. A small server-side normalizer will convert only finite numeric strings on fields that are already numeric in the MapPlan contract. It will not clamp coordinates, invent missing resources, or otherwise alter map semantics.

When validation fails, the planner will retain the invalid model output in the conversation and send the full issue path, code, and message in the correction request. The second model call must revise that concrete plan instead of regenerating without seeing its previous output. The corrected response still passes through the unchanged strict MapPlan validator.

### Edge Authentication Boundary

Authentication and authorized data access will use separate Supabase clients:

- An auth client without a global bearer header validates the explicit JWT through `getUser(token)`.
- A user data client carries the validated bearer header for RLS-protected map queries.
- The existing service-role client remains limited to provider state transitions and private storage writes.

This preserves authorization behavior while ensuring only one bearer value reaches the Auth endpoint.

### Database Transition Boundary

The revision update in `transition_map_asset` will qualify both the target table and its `status` column. The original Create Map migration will contain the corrected function so fresh databases are valid. The already-running local database will receive the same `CREATE OR REPLACE FUNCTION` definition without deleting or recreating retained records.

All legal transition, retry, sibling completion, and revision settlement behavior remains unchanged.

### Binary Type Boundary

PNG hashing and Blob-based storage tests will copy incoming bytes into an owned `ArrayBuffer`-backed view before passing them to Web Crypto or Blob constructors. Runtime bytes and hashes must remain identical; this is only a type-safe ownership conversion for Deno 2.9.

## Error Handling

- Unsafe or non-finite numeric strings remain invalid and produce `map_plan_invalid_response`.
- Coordinates outside the map remain validation errors and must be corrected by the model.
- Invalid or unauthorized JWTs continue to return 401 or 403 without provider calls.
- Illegal asset transitions continue to fail atomically.
- Provider, PNG validation, and storage failures retain their existing persisted failure codes.

## Testing

Each repair follows a red-green cycle:

1. Planner tests reproduce numeric strings and verify that correction includes the prior invalid plan plus actionable issue details.
2. Edge authentication tests reproduce the duplicate-header failure and verify authenticated RLS reads with one JWT.
3. Live database tests execute `planned -> queued -> generating -> ready/failed` and verify revision settlement.
4. Deno tests run with type checking enabled under the repository-pinned Deno 2.9.3.

Final verification uses the retained source Document `d86baf8a-b461-412b-950b-7c1b791d2320` and map `bba3d1dc-d37e-4735-9999-a7ec6ac78ce4`. The workflow must create a valid plan, authorize generation, transition all four retained assets, poll PixelLab, validate and store PNGs, and leave the resulting database rows and private objects intact.

## Acceptance Criteria

- `/api/create-map/plan` returns 200 with a valid MapPlan for the retained Document.
- A valid editor JWT reaches PixelLab submission without an Auth gateway `Bad request`.
- `transition_map_asset` performs every legal transition without PostgreSQL `42702`.
- `deno test` passes with type checking enabled; `--no-check` is not required.
- Jest Create Map tests and live database behavior tests pass.
- The retained map reaches `ready`, all four assets reach `ready`, and their private storage paths remain in the database.
- No retained test Document, map, revision, asset row, or generated storage object is deleted.
