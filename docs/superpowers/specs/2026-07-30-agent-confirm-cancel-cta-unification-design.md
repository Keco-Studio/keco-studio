# Agent Confirm/Cancel CTA Unification Design

## Goal

In Confirm mode, every action confirmation card exposes the same primary
actions: **Confirm** and **Cancel**. Greeting and inquiry assistant replies stay
button-free.

## Scope

Unify CTAs on existing confirmation / preview cards only:

- `ConfirmationCard`
- `ScriptPreviewCard`
- `SetupLibraryPreviewCard`

Out of scope:

- Persisting or restoring provider reasoning
- Adding Confirm/Cancel to assistant text bubbles (including greetings)
- Changing approve/reject API, resume, or `autoExecute` gating
- Removing ScriptPreview's "Edit in Import Modal" tertiary action

## Confirmed Approach

Align preview-card buttons with `ConfirmationCard` pills while keeping
card-specific titles and preview bodies.

| Card | Primary | Secondary | Extra |
|------|---------|-----------|-------|
| ConfirmationCard variants | `✓ Confirm` | `Cancel` | — |
| SetupLibraryPreviewCard | `Create library` → `✓ Confirm` | `Cancel` | — |
| ScriptPreviewCard | `Import Directly` → `✓ Confirm` | `Cancel` | Keep `Edit in Import Modal` (still rejects the agent action and opens the modal) |

Shared button contract for unresolved cards:

- Styles: `btnPillPrimary` (Confirm), `btnPillGhost` (Cancel)
- Test ids: `agent-confirm`, `agent-reject`
- A11y: `aria-label="Approve action"` / `aria-label="Reject action"`
- Handlers unchanged: `onDecision(actionId, 'approve' | 'reject')`

## ConfirmationCard polish

- Insert-reference Cancel currently uses non-existent `btnPill`; switch to
  `btnPillGhost` and keep `✓ Confirm` / `Cancel` (or `✕ Cancel` only if already
  present on that variant—prefer plain `Cancel` for consistency with the other
  variants).
- Ensure every Confirm-mode action variant exposes `agent-reject` where missing.

## Non-goals for assistant replies

Assistant markdown bubbles never gain Confirm/Cancel. Inquiry and greeting
replies remain ordinary assistant messages. Action approval continues to require
a `confirmation` item with an `actionId`.

## Testing

Extend `tests/unit/agent/document-confirmation-ui.test.tsx` (or a sibling) so
that:

1. Setup-library preview markup contains `✓ Confirm`, `Cancel`, `agent-confirm`,
   `agent-reject`, and the Approve/Reject aria-labels.
2. Script import preview markup contains the same Confirm/Cancel contract and
   still includes `Edit in Import Modal`.
3. Existing ConfirmationCard assertions keep passing.

No new e2e flow is required if unit coverage asserts the shared CTA contract;
existing agent-chat Confirm e2e continues to click `agent-confirm`.

## Acceptance

- Confirm-mode action cards show Confirm + Cancel with consistent styling.
- Import preview still offers Edit in Import Modal.
- Greetings / inquiry assistant replies have no Confirm/Cancel.
- Approve and reject still resume through the existing confirm API.
