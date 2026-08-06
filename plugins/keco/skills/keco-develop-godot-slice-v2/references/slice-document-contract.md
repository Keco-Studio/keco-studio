# Persistent Slice Documents

Every Keco-driven Godot slice owns a dated document folder in the target Godot project:

```text
docs/keco-godot-slices/<slice-id>/
  spec.md
  plan.md
  status.json
  eval-report.json        # required once status is completed
```

The folder is part of `SlicePlan.allowedFiles`. Do not store the only copy in conversation state. The Markdown files start with frontmatter containing `sliceId`, `documentType` (`spec` or `plan`), `createdDate`, `updatedDate`, `status`, and `latest`. Dates use `YYYY-MM-DD` and `updatedDate` must change whenever the document changes.

`status.json` contains `version: 1`, the same `sliceId`, dates, `status` (`planned`, `in_progress`, `blocked`, `completed`, or `superseded`), `latest`, `completed`, `supersedes`, and task entries with stable IDs and statuses. A completed slice has all tasks completed and an `eval-report.json`; a superseded slice is never marked latest. A new revision points to the older slice folder in `supersedes` and marks the older document `latest: false`.

Write the files at `WRITE_SPEC` and `WRITE_PLAN`, update status after each ledger stage, and write the final evaluation report before reporting completion. Run `scripts/validate_slice_documents.py --slice-dir <path>` before `PLAN_REVIEW` and `FINAL_VERIFY`.
