# Create Map V3 Real Chain Repair Design

## Goal

Repair the Create Map V3 planner and database compatibility failures, then generate a real map from `Create Map Short-Form Real-Chain Test 2026-08-10` whose saved draft and ready image remain visible in the `test` Keco project.

## Database Compatibility

Add a forward-only repair migration. It must tolerate a database where the V3 tables and RPCs already exist while the migration history is incomplete. The migration replaces the V3 payload validator with a collision-grid-aware definition and invalidates dependent RPC call plans. It must not reset, delete, or recreate retained map records.

## Planner Repair

Keep the strict V3 schema as the durable contract. Normalize only provider-owned invariants after each DeepSeek tool response: schema version, authorized references, fixed PixelLab operation fields, nullable seed, and a supported width-height pair. Invalid descriptive content remains a model error and uses the existing correction attempt.

## Real Acceptance Flow

Use the authenticated owner of project `test` and the existing document `Create Map Short-Form Real-Chain Test 2026-08-10`. Create the plan through the real Next.js route, persist it through V3 RPCs, publish one generation revision, create one direct-image asset, and invoke the real PixelLab Edge Function. Poll and validate the provider job, bind the ready image into the next draft Scene, save it, and verify private storage SHA-256, image dimensions, opacity, and nonblank pixels.

The created `map_projects` row must retain the source project and document IDs. Its current V3 draft must contain a locked `mapImage` binding to the ready generation revision so the existing Saved Maps UI can list and restore it.

## Error Handling

Preserve stable sanitized codes. PixelLab quota exhaustion remains distinct from temporary rate or concurrency limiting. A rejected submission remains safely retryable only when the provider did not create a job.

## Verification

Add focused regression tests for planner normalization and repair migration structure. Run the Create Map V3 Jest gate, Edge Function tests, TypeScript checks, and migration checks. The final real-chain report must include the project ID, map ID, current draft revision ID, generation revision ID, ready asset ID, provider job ID, storage SHA prefix, and Saved Maps restore evidence.
