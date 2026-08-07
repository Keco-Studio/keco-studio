# Slice Decision Contract

Source selection precedes Slice decomposition:

```yaml
sourceDecision: consistent|awaiting_user_confirmation|confirmed
sourceCandidates:
  - documentId: uuid
    title: arbitrary display name
    revision: stable revision
    evidence: []
selectedDocumentId: null
question: null
answer: null
```

Automatically select only one clearly dominant semantic source. Tied source candidates require one focused question and zero writes. Do not select by a fixed name or recency alone.

The Slice decision record is:

```yaml
sliceDecision: consistent|awaiting_user_confirmation|confirmed
candidateSlices:
  - id: lower-case-hyphen-key
    objective: one sentence
    evidence: []
    scope: []
    dependencies: []
    priority: 1
    risks: []
    status: planned
selectedSliceId: null
question: null
answer: null
```

`consistent` means the accepted source supports one defensible decomposition and acceptance contract; it continues without asking for confirmation. Multiple unambiguous Slices are not ambiguity: write all of them to the roadmap and schedule them by completed dependencies, priority, then stable ID. `awaiting_user_confirmation` is mandatory for unresolved source, dependency, design, acceptance, or allowed-file ambiguity and is a zero-write state. Ask only one question at a time; provide at most three candidates and say what changes in scope or evidence for each. `confirmed` is recorded only after the user selects or rejects the alternatives. A later source revision or dirty-path change invalidates the decision and returns to the earliest affected discovery stage.
