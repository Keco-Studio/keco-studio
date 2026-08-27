# Persistent Slice Documents

Every Keco-driven Godot slice owns a dated document set in a discovered folder inside the matching Keco Project. The Keco documents are authoritative:

```text
<Keco Project>/<discovered folder>/
  <roadmap-id> roadmap
  <slice-id> spec
  <slice-id> plan
  <slice-id> status
  <slice-id> eval-report   # required once status is completed
```

## Folder Discovery

At `BASELINE`, read the matching Keco Project structure and select a compatible folder by semantic purpose, not by a fixed folder name. Use the returned `projectId` and `folderId` for every roadmap and Slice document operation. Never use a folder from another project.

If multiple folders are equally plausible, set `sliceDecision: awaiting_user_confirmation`, keep `writeToken: null`, and ask one focused question. If no compatible folder exists and the live Keco MCP exposes no folder-creation operation, stop before writes and report `blocked_before_write`.

## Keco Document Writes

Create the roadmap first with `create_document(projectId, folderId, name, markdown)`, then read it back with `read_document`. Only after that read-back succeeds may the workflow create each Slice's `spec`, `plan`, and `status` documents. Retain every returned document ID, revision/state token, folder ID, and content hash in `RunContext.documents`.

The `spec` and `plan` Markdown start with frontmatter containing `sliceId`, `documentType`, `createdDate`, `updatedDate`, `status`, and `latest`. Dates use `YYYY-MM-DD`, and `updatedDate` changes whenever content changes. The status and evaluation documents contain the same stable JSON payload required by the local validator, represented as Markdown when required by the Keco document API.

Persist status at durable checkpoints instead of after every in-memory ledger stage. Update the Keco status document with `update_document` and its latest state token at plan confirmation, immediately before development writes, whenever `taskTransition` is created, changed, or cleared after the return task, on `blocked_before_write` or `partial`, and on Slice completion. Coalesce ordinary task progress since the previous checkpoint into one update. Update spec or plan only when its accepted content revision changes. Update and read back the roadmap only when Slice selection, dependency state, pause state, or completion changes. A completed Slice has all tasks completed and a read-back `eval-report` document. A new revision references the superseded Slice documents and marks older documents `latest: false`.

After every checkpoint create/update, read the complete document back once and verify the project ID, folder ID, document ID, revision, content hash, `runId`, and `sliceId`. Reuse that verified read-back until a relevant document revision changes. A write response without read-back is not success.

## Plan And Status Ownership

`plan.md` is the approved static scope and does not own task progress. Its lifecycle frontmatter remains for legacy document compatibility and describes the accepted document revision, not the mutable Slice run state. Task state and dates are read from `status.json`. A changed scope or acceptance rule creates a new plan revision instead of writing runtime details into the accepted plan.

`TaskResult` records per-task execution evidence. `EvalReport` records final verification evidence. Command output, read-back values, hashes, screenshots, and repair history belong there or in `status.json`, never in `plan.md`.

## Local Mirror

Only after Keco read-back succeeds, materialize the accepted content into:

```text
docs/keco-godot-slices/<roadmap-id>/roadmap.md
docs/keco-godot-slices/<slice-id>/
  spec.md
  plan.md
  status.json
  eval-report.json        # required once status is completed
```

The local folder is part of `SlicePlan.allowedFiles` and exists for repository review, diffs, and validation. It is never the authoritative or only copy. Do not consume an edited local mirror until the same revision has been written to Keco and read back.

Only the `export_slice_mirrors` manifest may materialize local mirrors. Run `scripts/materialize_slice_mirrors.py --manifest <path> --repository-root <root> --run-context <run-context> --output <mirror-verification.json>` after export. It requires every repository path in `allowedFiles`, rejects parent traversal and symlinks, atomically writes and reads back every byte, and binds `MirrorVerification` to the manifest SHA-256 digest. A mismatch emits no verification artifact.

For current completed artifacts, `status.json` carries all four derived dimensions (`implementationStatus`, `runtimeVerificationStatus`, `acceptanceStatus`, `releaseReadiness`) and current `MirrorVerification` provenance. Run `scripts/validate_slice_documents.py --slice-dir <path>` before `PLAN_REVIEW` and `FINAL_VERIFY`, then compare local hashes with authoritative Keco document hashes.
