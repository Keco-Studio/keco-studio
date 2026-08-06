# Persistent Slice Documents

Every Keco-driven Godot slice owns a dated document set in a discovered folder inside the matching Keco Project. The Keco documents are authoritative:

```text
<Keco Project>/<discovered folder>/
  <slice-id> spec
  <slice-id> plan
  <slice-id> status
  <slice-id> eval-report   # required once status is completed
```

## Folder Discovery

At `BASELINE`, read the matching Keco Project structure and select a compatible folder by semantic purpose, not by a fixed folder name. Use the returned `projectId` and `folderId` for every document operation. Never use a folder from another project.

If multiple folders are equally plausible, set `sliceDecision: awaiting_user_confirmation`, keep `writeToken: null`, and ask one focused question. If no compatible folder exists and the live Keco MCP exposes no folder-creation operation, stop before writes and report `blocked_before_write`.

## Keco Document Writes

Create the Keco documents with `create_document(projectId, folderId, name, markdown)`, then read each one back with `read_document`. Retain every returned document ID, revision/state token, folder ID, and content hash in `RunContext.documents`.

The `spec` and `plan` Markdown start with frontmatter containing `sliceId`, `documentType`, `createdDate`, `updatedDate`, `status`, and `latest`. Dates use `YYYY-MM-DD`, and `updatedDate` changes whenever content changes. The status and evaluation documents contain the same stable JSON payload required by the local validator, represented as Markdown when required by the Keco document API.

After every ledger stage, update the Keco status document with `update_document` and its latest state token. Update spec or plan the same way when an accepted revision changes. A completed slice has all tasks completed and a read-back `eval-report` document. A new revision references the superseded slice documents and marks older documents `latest: false`.

After every create/update, read the complete document back and verify the project ID, folder ID, document ID, revision, content hash, `runId`, and `sliceId`. A write response without read-back is not success.

## Local Mirror

Only after Keco read-back succeeds, materialize the accepted content into:

```text
docs/keco-godot-slices/<slice-id>/
  spec.md
  plan.md
  status.json
  eval-report.json        # required once status is completed
```

The local folder is part of `SlicePlan.allowedFiles` and exists for repository review, diffs, and validation. It is never the authoritative or only copy. Do not consume an edited local mirror until the same revision has been written to Keco and read back.

Run `scripts/validate_slice_documents.py --slice-dir <path>` before `PLAN_REVIEW` and `FINAL_VERIFY`, then compare the local hashes with the authoritative Keco document hashes.
