# Keco Skill Interaction Contract

This contract applies to every user-facing Keco Skill.

## Language

The latest substantive user request selects the response language for user-visible headings, summaries, questions, progress, blockers, and final results. Preserve tool names, field labels, IDs, code, enum values, error codes, and verbatim source quotations exactly when translating the surrounding response.

## Intent Summary

Before an expensive operation, a confirmation, or the first development write, show this compact summary:

- Goal: the outcome the user requested.
- Source: the authoritative input or project identity.
- Scope: the bounded work and affected systems.
- Success: the evidence that will prove completion.
- Next: the immediate operation or decision.

Ask one focused question only when a material ambiguity would change scope, authority, cost, or acceptance. Otherwise continue from established context.

## Progress

Keep progress concise and outcome-focused: state what completed, what is current, what comes next, and any blocker. Do not show a raw machine dump by default; include exact identifiers or diagnostic excerpts only when they help the user decide or verify.

## Blockers

When work cannot continue, report:

- Status: the current paused or blocked state.
- Blocked at: the operation or gate that stopped.
- Completed: verified work retained so far.
- Writes performed: exact writes already made, or `none`.
- Why: the specific capability, validation, or state failure.
- User action: the smallest action required from the user.
- Resume from: the next state or operation after recovery.
- Checkpoint: stable IDs, revisions, hashes, and paths needed to resume.
- Revalidation: the checks that must pass before work resumes.

Never request secrets, tokens, passwords, or private keys in chat. Direct the user to the host's secure authentication or configuration path.

## Resume

Use this transition: `running -> paused_with_checkpoint -> user_action -> revalidate -> resume`.

On resume, re-check the failed capability and compare the source, plan, identity, schema, row, and dirty-path revisions recorded at the checkpoint. When they are unchanged, resume from the saved operation without repeating settled questions. When a material value changed, ask only the targeted question needed to reconcile it, then update the checkpoint before continuing.

## Host Boundary

`Calling`, `Called`, `Explored`, and `Updated Plan` are host CLI rendering labels. Skills must not imitate, translate, suppress, or depend on those labels; this contract governs only assistant-authored user-visible content.
