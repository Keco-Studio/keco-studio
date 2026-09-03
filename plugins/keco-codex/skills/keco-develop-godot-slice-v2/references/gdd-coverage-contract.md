# GDD Coverage And Change Contract

Use this contract only when `SourceProfile.kind` is `gdd`. Its bound document
ID, epoch, revision, and content hash identify the authoritative design source;
display names never establish identity. Before decomposition, create a
versioned Requirement Inventory with a stable
`requirementId`, exact source location, source quote, classification, and
authorization. Use `normative` for behavior that must be implemented or
explicitly deferred, `descriptive` for narrative or context, and `tentative`
for values explicitly left open for tuning.

Every formal Slice plan, Task, and EvalSpec references the same requirement IDs.
Run `scripts/validate_gdd_coverage.py` before `WRITE_SPEC` and again before
finalization. The inventory must include a canonical `inventoryHash` and
completeness evidence: the exact source snapshot/read-back used, the reviewed
section list, and the review method. The offline validator cannot fetch a
remote Keco document itself, so this is an auditable source-read backstop. A
normative requirement must be mapped to Slice, Task, and Eval,
or be `deferred` to an existing roadmap Slice, `blocked` with a reason, or
`awaiting_user_confirmation` with a reason. `not included` without a destination
is not a valid state. Slice implementation status and GDD coverage status are
separate; a completed Slice may still have partial GDD coverage.

GDD plans and EvalSpecs must set `coverageMode: gdd`, bind the same
`inventoryHash`, and contain equal `requirementIds`. Non-GDD profiles instead
bind `sourceProfileHash` and `nonGddRationale`; they do not supply GDD fields.

## New design proposals

An AI may propose a feature absent from the GDD, but it may not put that feature
in a formal Slice, Task, Eval, or code. First draft a GDD amendment or patch
with a target, proposed text, rationale, and affected requirements. After user
approval, merge it into the bound GDD or add an explicit accepted-patch
reference in that GDD, then re-read the document and refresh its revision,
content hash, and Requirement Inventory. An unreferenced patch is not an
authoritative source. An `accepted_patch` entry must include
`patchReference.patchId`, its GDD reference location, and the exact acceptance
quote; a self-declared authorization is not evidence of acceptance. An
unauthorized proposal must remain `authorization: proposal`, `status:
proposal`, and unmapped.
