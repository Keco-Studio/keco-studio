# GDD to Game Script Fidelity

## Goal

Keep the player-visible text from a GDD Script unchanged when the Script is
converted into a game. Existing source text must appear verbatim and in source
order; generated extensions are allowed but cannot replace or rewrite it.

## Scope

The contract covers player-visible speaker names, dialogue, narration, and
choice text. It excludes chapter and scene headings, stage directions, author
notes, branch markers, and command metadata when the source parser classifies
them as structural. Matching is exact at the string level. UI wrapping is not
part of the comparison because it does not change the rendered string.

## Design

`buildVisibleTextManifest` derives an ordered manifest from the existing story
source segments. Each item carries a stable segment ID, source unit ID, kind,
text, and source offsets. `auditVisibleText` checks the manifest as an ordered
subsequence of the game text stream, so additional text is valid while missing
or altered source text fails.

The GDD-to-Script conversion path enables `enforceVisibleTextContract` during
Story IR materialization. A failed audit raises a
`visible_text_mismatch` validation issue before database writes. The extraction
and plan auditor prompts receive the same manifest and explicitly prohibit
paraphrase, punctuation changes, whitespace changes, case changes, translation,
or merging of required strings.

The V2 GDD coverage contract binds the same manifest to GDD-driven Slice
planning. A Slice EvalSpec must assert the complete manifest, and runtime
evidence must provide the rendered player-visible text stream used by the
comparison.

## Verification

- Unit tests prove structural metadata is excluded and visible text is kept
  exact.
- Unit tests prove extensions pass while omissions and punctuation mutations
  fail.
- Materializer tests prove strict conversion rejects a changed visible string.
- Story-plan and story-extraction test suites cover the existing import flow.
