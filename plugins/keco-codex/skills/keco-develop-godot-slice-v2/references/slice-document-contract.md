# Slice Planning Document Contract

The repository follows the existing Superpowers convention. The user-facing
documents for one Slice are exactly:

```text
docs/superpowers/specs/<slice-id>-design.md
docs/superpowers/plans/<slice-id>.md
```

Use the same `<slice-id>` in both names. The spec is the stable product and
acceptance description. The plan is the ordered implementation checklist and is
the only user-facing progress record.

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

For more than one Slice, the roadmap is another ordinary plan in:

```text
docs/superpowers/plans/<roadmap-id>.md
```

It contains one checkbox per Slice and links each item to its paired spec and
plan. Mark a Slice checked only after its plan is complete and internal runtime
verification succeeds.

## Internal Evidence

`RunContext`, `TaskResult`, `TaskReview`, `EvalReport`, `MirrorVerification`,
`status.json`, state tokens, and hashes remain internal machine evidence. They
support validation, collaboration, and release gates; they are not additional
planning documents and do not compete with the plan checkbox as the progress
source.

The internal validator may continue to validate legacy status/eval-report
artifacts for compatibility. That compatibility does not change the new
user-facing layout.
