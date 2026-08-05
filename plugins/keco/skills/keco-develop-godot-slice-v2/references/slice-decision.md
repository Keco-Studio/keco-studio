# Slice Decision Contract

The decision record is:

```yaml
sliceDecision: consistent|awaiting_user_confirmation|confirmed
candidateSlices:
  - id: lower-case-hyphen-key
    objective: one sentence
    evidence: []
    scope: []
    risks: []
selectedSliceId: null
question: null
answer: null
```

`consistent` means the source precedence rules and the user's request leave one defensible slice and acceptance contract; it continues without asking for confirmation. `awaiting_user_confirmation` is mandatory for unresolved design ambiguity and is a zero-write state. Ask only one question at a time; provide at most three candidates and say what changes in scope or evidence for each. `confirmed` is recorded only after the user selects or rejects the alternatives. A later source revision or dirty-path change invalidates the decision and returns to `RESOLVE_SOURCES`.
