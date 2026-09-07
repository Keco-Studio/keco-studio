# GDD Coverage And Change Contract

Use this contract only when `SourceProfile.kind` is `gdd`. The bound document
ID, epoch, revision, and content hash establish identity; display names do not.
Before decomposition create a versioned Requirement Inventory with stable
`requirementId`, exact source location and quote, classification, and
authorization. `normative` means behavior to implement or explicitly defer;
`descriptive` is narrative/context; `tentative` is explicitly open for tuning.

Every formal Slice plan, Task, and EvalSpec references the same requirement IDs.
Run `scripts/validate_gdd_coverage.py` before `WRITE_SPEC` and finalization.
Record the canonical `inventoryHash`, the exact source snapshot/read-back,
reviewed sections, and review method. Each normative requirement maps to Slice,
Task, and Eval, or is `deferred` to an existing roadmap Slice, `blocked` with a
reason, or `awaiting_user_confirmation` with a reason; `not included` alone is
invalid. Slice implementation status and GDD coverage status remain separate.

GDD plans and EvalSpecs set `coverageMode: gdd`, bind the same `inventoryHash`,
and contain equal `requirementIds`. Non-GDD profiles bind `sourceProfileHash`
and `nonGddRationale` instead of GDD fields.

## New design proposals

An AI may propose a feature absent from the GDD, but cannot put it in a formal
Slice, Task, Eval, or code. Draft an amendment or patch with target, proposed
text, rationale, and affected requirements; after user approval, merge it into
the bound GDD or add an explicit accepted-patch reference, then reread and
refresh revision, content hash, and inventory. An unreferenced patch is not
authoritative. `accepted_patch` records `patchReference.patchId`, GDD reference
location, and exact acceptance quote; self-declared authorization is not
evidence. Unauthorized proposals remain `authorization: proposal`, `status:
proposal`, and unmapped.
