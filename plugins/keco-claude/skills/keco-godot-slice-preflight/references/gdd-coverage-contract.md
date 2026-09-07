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

## Player-visible script text fidelity

When the GDD source includes a Script or screenplay, create a
`visibleTextManifest` from the document's player-visible segments before
planning a Slice. The manifest is an ordered list of exact source strings for
speakers, dialogue, narration, and choice text. Each item retains its stable
source segment ID and source offsets. Chapter/scene headings, stage directions,
author notes, branch markers, and command metadata are excluded when the source
parser classifies them as structural.

The generated game must contain every manifest string verbatim and in source
order. Matching is byte-for-byte at the string level: do not normalize case,
punctuation, whitespace, quotes, or Unicode forms. Additional game text is
allowed only as an extension and cannot replace, merge, paraphrase, or split a
manifest item. A GDD-driven run fails before its write lease is issued when any
manifest item is missing or altered, and its EvalSpec includes an assertion for
the complete manifest. Runtime evidence reports the rendered player-visible
text stream used for this comparison.

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
