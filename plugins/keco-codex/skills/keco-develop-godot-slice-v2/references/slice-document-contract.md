# Slice Planning Document Contract

The Keco Project owns the canonical user-facing planning documents. Put them
under one planning root using actual folders:

```text
<planning-root>/
|-- roadmap                  document
|-- spec/                    folder
|   `-- <slice-id>           document
`-- plan/                    folder
    `-- <slice-id>           document
```

`spec` and `plan` are literal Keco child folders whose `parentFolderId` is the
planning root ID. They are not prefixes in a document name. A document named
`spec/<slice-id>` or `plan/<slice-id>` directly under the planning root is an
invalid flat layout and must never be created. Use the same bare `<slice-id>`
document name in both folders. The spec is the stable product and acceptance
description. The plan is the ordered implementation checklist and the only user-facing progress record.

Mirror exactly the accepted canonical roadmap, spec, and plan into the
repository's Superpowers layout:

```text
docs/superpowers/roadmap.md
docs/superpowers/specs/<slice-id>-design.md
docs/superpowers/plans/<slice-id>.md
```

The repository paths are mirrors, not a substitute for the Keco folder
hierarchy.

## Substantive content

For a multi-Slice decomposition, each paired spec and plan must carry its own
objective, bounded scope, acceptance behavior, concrete task/file list, and
RED/GREEN verification. Shared metadata and coverage IDs are not sufficient.
Before the first spec write and again at `PLAN_REVIEW`, package the pairs in a
decomposition bundle and run `scripts/validate_slice_decomposition.py`. The
validator normalizes IDs and dates and rejects template-only siblings, generic
`Implement tasks` checklists, and plans without concrete files or commands.

## Folder And Write Rules

1. Read `list_project_structure` and resolve one planning root by stable ID.
2. Reuse only exact direct child folders named `spec` and `plan`. If either is
   missing, create it with `create_folder` and the planning root ID as
   `parentFolderId`.
3. Read `list_project_structure` again and record the returned root, spec, and
   plan folder IDs. Stop on duplicates, wrong parents, or an ambiguous root.
4. Create each bare `<slice-id>` spec with `folderId` set to the spec folder ID,
   and each same-named plan with `folderId` set to the plan folder ID.
5. Read the structure back again. Continue only when every document's
   `folderId` matches its intended folder and no generated document name
   contains `/`.

## Document Rules

The spec and plan start with lightweight metadata containing `sliceId`, dates,
and a revision. The plan contains tasks in dependency order:

```markdown
- [ ] task-001: Add the data
- [ ] task-002: Integrate the scene
  - Depends on: task-001
```

After the task's implementation and verification pass, change only its marker:

```markdown
- [x] task-001: Add the data
```

Do not create or edit a separate user-maintained `status` document. A changed
goal, scope, or acceptance rule creates a new paired spec/plan revision; normal
task progress only changes checkboxes in the accepted plan.

## Versioning

Put the visible plan revision and SourceProfile identity in spec/plan metadata.
Checkbox updates do not create a new plan revision. A changed goal, scope,
acceptance, source, or allowed-file set creates a successor run and updates the
same stable document identities with optimistic epoch/revision checks. Keco
document history and Git retain the prior bytes; do not create dated duplicate
documents.

## Multi-Slice Roadmap

Create or bind the `roadmap` document directly in the Keco planning root and
mirror it at:

```text
docs/superpowers/roadmap.md
```

It contains one checkbox per Slice and links each item to its paired spec and
plan. `prepare_delivery` is the only operation that marks the current Slice
checked, after implementation, runtime, acceptance, manual-review policy, and
package gates pass. Do not place `roadmap` inside either child folder.

## Mirror And Seal

After `prepare_delivery`, export exactly roadmap, spec, and plan. Fully preflight
the batch, stage and fsync all bytes, persist the recovery journal, replace all
targets, and read all targets back before producing `MirrorVerification`. A
handled failure restores and verifies every pre-run hash. A failed restore
returns `SLICE_MIRROR_RECOVERY_REQUIRED` with the durable journal; the next run
recovers it before accepting another manifest. Delivery seal never edits these
documents.

## Internal Evidence

`RunContext`, `TaskResult`, `TaskReview`, `EvalReport`, `MirrorVerification`,
`status.json`, state tokens, and hashes remain internal machine evidence. They
support validation, collaboration, and release gates; they are not additional
planning documents and do not compete with the plan checkbox as the progress
source.

The internal validator may continue to validate legacy status/eval-report
artifacts for compatibility. That compatibility does not change the new
user-facing layout.
