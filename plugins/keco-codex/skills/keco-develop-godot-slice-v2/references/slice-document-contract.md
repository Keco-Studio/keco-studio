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

Mirror the accepted canonical documents into the repository's existing
Superpowers layout:

```text
docs/superpowers/specs/<slice-id>-design.md
docs/superpowers/plans/<slice-id>.md
```

The repository paths are mirrors, not a substitute for the Keco folder
hierarchy.

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

Put the visible `revision` and source GDD revision in the spec/plan metadata.
Checkbox updates do not create a new revision. A changed goal, scope, or
acceptance creates a new dated spec/plan pair and leaves the previous pair as
history. Internal hashes may confirm exact bytes, but users only need the
paired revision and the Git change history.

## Multi-Slice Roadmap

For more than one Slice, create the `roadmap` document directly in the Keco
planning root and mirror it as an ordinary repository plan in:

```text
docs/superpowers/plans/<roadmap-id>.md
```

It contains one checkbox per Slice and links each item to its paired spec and
plan. Mark a Slice checked only after its plan is complete and internal runtime
verification succeeds. Do not place `roadmap` inside either child folder.

## Internal Evidence

`RunContext`, `TaskResult`, `TaskReview`, `EvalReport`, `MirrorVerification`,
`status.json`, state tokens, and hashes remain internal machine evidence. They
support validation, collaboration, and release gates; they are not additional
planning documents and do not compete with the plan checkbox as the progress
source.

The internal validator may continue to validate legacy status/eval-report
artifacts for compatibility. That compatibility does not change the new
user-facing layout.
