# Map assistant rail and Map chat restoration

Date: 2026-09-28

## Scope

Restore the Create Map V3 left conversation UI and interaction that existed before PR #469, while moving the unified Keco Assistant launcher into the bottom of the product rail. This is the UI stage only. Assistant tool parity is a separate follow-up stage after this UI is verified.

The assistant remains available on Projects, Studio project pages, Script, Create Map, and Game Design Systems. Simulation, account, billing, MCP, admin, and Keco 101 remain outside assistant scope.

## Map workbench

- Restore `MapChatPanel` in the Map source column, including prompt entry, attachment menu, message search, generation history, map-plan card, and generated-image card.
- Restore the associated local conversation state and callbacks in `DirectMapWorkbench`. Sending a Map prompt continues to call the existing Create Map V3 plan service, not the global assistant conversation endpoint.
- Retain Create Map's saved draft, generation, collision, and source APIs. Keep the assistant-to-Map refresh bridge introduced by PR #469 so global assistant actions still update the visible workbench.
- Keep the Map chat and global assistant as distinct surfaces. The Map chat is the direct Map creation workflow; the rail launcher opens the cross-workspace assistant panel.

## Global assistant entry

- Render the existing 60px product rail on every assistant-supported route, not just Create Map and Game Design Systems. Do not add the assistant to excluded routes.
- Place one bot-icon button at the bottom of the rail, directly above the collapse control. Use the existing `bot.svg` identity at rail-icon scale, with an accessible name and active state while the assistant panel is open.
- Remove the floating, draggable bottom-right assistant launcher on supported routes. The rail button controls the existing assistant panel; route and scope changes close the panel while preserving scoped conversation state.
- Use one parent-owned open state shared by the rail and assistant host. The rail is the only launcher, preventing duplicate buttons. When the rail is collapsed, the existing expand control reveals the launcher.
- On mobile, keep the rail usable and the existing full-width assistant panel behavior. The launcher must remain reachable without covering Map controls.

## Error handling and compatibility

- If a route has no valid assistant workspace context, the rail omits the bot button and the assistant host renders no panel.
- Map attachment, plan-creation, generation, and saved-map errors continue to appear in the restored Map chat as before.
- Persisted positions for the former draggable launcher are ignored; no migration is needed because the position is presentation-only browser storage.
- No database schema or server API changes are required for this UI stage.

## Verification

- Unit tests cover route visibility, a single rail launcher, open/close and navigation resets, and restored Map chat wiring.
- Create Map browser tests cover prompt-to-plan, attachments, saved-map reopening, generation history/cards, mobile interaction, and the separate rail assistant panel.
- Review desktop and mobile screenshots for rail alignment, Map canvas width, panel overlap, and accessibility focus states.
- Run typecheck, relevant unit tests, and the full Create Map browser suite. Complete a unified review after implementation, per the user's request not to use TDD.

## Follow-up stage: tool parity

After UI verification, inventory every user-facing operation in Projects, Studio, Script, Create Map, and Game Design Systems against assistant tools. Implement missing actions through the existing domain services with the same authorization as the UI. Require explicit confirmation for deletion, overwriting existing content, and billable generation; ordinary create/edit actions may execute directly. This follow-up gets its own design and implementation plan because it spans multiple independent product areas.
