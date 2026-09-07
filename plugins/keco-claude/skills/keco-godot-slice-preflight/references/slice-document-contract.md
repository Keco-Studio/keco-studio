# Slice Planning Document Contract

Keco owns the canonical user-facing planning documents. Under one planning
root, create `roadmap`, literal child folders `spec` and `plan`, and bare
`<slice-id>` documents in each child. A flat `spec/<slice-id>` or
`plan/<slice-id>` name is invalid. The spec is the stable product and
acceptance description; the plan is the ordered implementation checklist and
the only user-facing progress record.

Mirror exactly the accepted roadmap, spec, and plan at:

```text
docs/superpowers/roadmap.md
docs/superpowers/specs/<slice-id>-design.md
docs/superpowers/plans/<slice-id>.md
```

Repository paths are mirrors, not a substitute for the Keco folder hierarchy.
For every new or materially updated pair, use canonical `spec-template.md` and
`plan-template.md`; their technical tables are normative and must match the
JSON artifacts exactly. Keco is authoritative and repository Markdown is a
validated byte-for-byte mirror.

## Substantive and folder rules

For a multi-Slice decomposition, each pair has its own objective, bounded
scope, acceptance behavior, concrete task/file list, and RED/GREEN verification.
Run `scripts/validate_slice_decomposition.py` before the first spec write and at
`PLAN_REVIEW`; template-only siblings, generic `Implement tasks` checklists, or
plans without concrete files/commands are rejected.

1. Read `list_project_structure` and resolve one planning root by stable ID.
2. Reuse only exact direct child folders named `spec` and `plan`; create missing
   children with `parentFolderId` set to the root ID.
3. Read back and stop on duplicates, wrong parents, or ambiguous roots; create
   bare `<slice-id>` documents with matching child `folderId` values.
4. Read back again; every folder ID must match and no generated name may contain `/`.

## Versioning and progress

Spec and plan metadata contain `sliceId`, dates, visible revision, and
SourceProfile identity. Plan tasks stay in dependency order; after
implementation and verification change only the checkbox marker. Do not create
a separate user-maintained `status` document. A changed goal, scope,
acceptance, source, or allowed-file set creates a successor run with optimistic
epoch/revision checks, updates the same stable document identities, and preserves
prior bytes in Keco history and Git; checkbox updates do not create a revision,
and dated duplicate documents are forbidden.

## Roadmap, mirrors, and evidence

The roadmap is directly in the planning root, mirrored at
`docs/superpowers/roadmap.md`, with one checkbox per Slice linking spec and plan.
Only `prepare_delivery` checks it after implementation, runtime, acceptance,
manual-review, and package gates pass. Then export exactly the three files, stage
and fsync bytes, persist recovery journal, replace targets, and read them back
before `MirrorVerification`. Recovery restores every pre-run hash; failed restore
returns `SLICE_MIRROR_RECOVERY_REQUIRED`. Delivery seal never edits these documents.

`RunContext`, `TaskResult`, `TaskReview`, `EvalReport`, `MirrorVerification`,
`status.json`, state tokens, and hashes remain internal machine evidence, not
planning documents. Validators consume this evidence for release gates; it does
not replace the plan checkbox.
