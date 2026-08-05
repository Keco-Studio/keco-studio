# Script Agent Launcher Design

## Goal

Show the existing Keco Assistant launcher and chat panel on Keco Script routes with the same appearance and behavior used on Studio library routes.

## Design

`DashboardLayout` remains the single owner of `ChatPanel`. Script routes will no longer be included in the `hideChatPanel` condition, while Simulation routes will continue to hide it.

No Script-specific launcher, panel, icon, state, or CSS will be introduced. The existing fixed draggable launcher will appear at the bottom-right. Opening it will render the existing side panel inside the shared workspace.

## Context

The existing `ChatPanel` reads project, document, folder, and library identifiers from `NavigationContext`. Script routes already populate the relevant project, document, and library context, so the Agent will bind new conversations to the active Script resource without a new integration layer.

## Behavior

- Studio library routes remain unchanged.
- Script routes show the same Agent launcher and full chat panel as Studio library routes.
- The launcher remains draggable and retains its saved position.
- Opening and closing the panel uses the existing interaction.
- Simulation routes continue to hide Agent chat.
- Routes without a current project continue to render no launcher through the existing `ChatPanel` guard.

## Testing

Update the Script layout wiring test to assert that only Simulation controls `hideChatPanel`. Run the focused Script layout tests, Agent static tests, TypeScript type checking, and targeted lint.
