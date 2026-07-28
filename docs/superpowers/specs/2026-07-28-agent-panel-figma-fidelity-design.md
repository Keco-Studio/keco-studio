# Agent Panel Figma Fidelity Design

## Goal

Match the Agent UI shown on the Figma `agent` page while preserving the rest of
Keco Studio. The dashboard, table, sidebar, version history, and other product
surfaces remain unchanged.

The implemented Agent states are:

- launcher / get started;
- empty new chat;
- streaming and thinking;
- Confirm mode and confirmation cards;
- Auto mode;
- conversation history.

The second Confirm-mode reference image (`2567:13676`) is explicitly excluded.

## Approach

Refine the existing Agent component tree instead of introducing a parallel
panel. `ChatPanel` remains the state coordinator and `useAgentChat` remains the
runtime boundary. Existing API requests, persistence, scope locking,
confirmation decisions, streaming, and navigation-close behavior are retained.

The visual implementation will update the markup and CSS of the existing
presentation components:

- `ChatPanel` for launcher, shell, header, mode switch, and layout;
- `ChatInput` for attachments, textarea, and send controls;
- `ConversationList` for the history view;
- `AgentActivityBar` for thinking/streaming feedback;
- `ConfirmationCard` for Confirm-mode actions;
- shared chat message styles where needed for consistent spacing.

No new UI framework or icon dependency will be added. Existing Ant Design icons
and project components are reused where their glyphs match the design.

## Responsive Behavior

On desktop, the Agent is a fixed right-side panel with stable width and full
viewport height. It overlays the existing dashboard, matching the Figma states
without resizing the main application.

On narrow screens, the panel becomes a full-width overlay. Header actions wrap
or compact without clipping, the message area remains scrollable, the input
stays pinned to the bottom, and touch targets remain usable. The launcher keeps
safe spacing from viewport edges.

## Interaction States

- Opening the launcher shows a fresh or restored conversation using existing
  runtime state.
- New chat clears the current conversation through the existing action.
- History opens inside the Agent surface and keeps selection/deletion behavior.
- Confirm/Auto uses the existing persisted `autoExecute` value and is disabled
  during streaming as today.
- Thinking feedback derives from existing `streamActivity` and timing values.
- Confirmation cards continue to call the existing approve/reject handler.
- Disabled, hover, focus-visible, loading, empty, and error states receive
  explicit visual treatment without changing their data flow.

## Accessibility

Icon-only controls receive accessible names and tooltips. Keyboard focus is
visible. Buttons retain native semantics. Motion is limited to short UI
transitions and disabled under `prefers-reduced-motion`.

## Testing

Focused component tests will cover the Agent shell states and accessible
controls. Existing unit tests for messages and confirmations remain in place.
The Agent Playwright flow will verify launcher, empty chat, mode switching,
streaming, confirmation, and history behavior. TypeScript and focused Jest tests
must pass before visual validation at desktop and mobile viewport sizes.
