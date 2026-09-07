# Slice Decision Contract

Source selection precedes Slice decomposition. Record one of
`sourceDecision: consistent|awaiting_user_confirmation|confirmed` with source
candidates, selected ID, question, answer, and evidence. Automatically select
only one clearly dominant semantic source; tied candidates require one focused
question and zero writes. Never select by fixed name or recency alone.

Record one of `sliceDecision: consistent|awaiting_user_confirmation|confirmed`
with candidate Slices containing ID, objective, evidence, scope, dependencies,
priority, risks, and status, plus selected ID, question, and answer.

`consistent` means the accepted source supports one defensible decomposition
and acceptance contract and continues without confirmation. Multiple unambiguous
Slices are not ambiguity: write them to the roadmap and schedule completed
dependencies, priority, then stable ID. `awaiting_user_confirmation` is
mandatory for unresolved source, dependency, design, acceptance, or allowed-file
ambiguity and is zero-write; ask one question with at most three candidates and
state the scope/evidence change for each. `confirmed` is recorded only after the
user selects or rejects alternatives. Later source revision or dirty-path change
invalidates the decision and returns to the earliest affected discovery stage.
