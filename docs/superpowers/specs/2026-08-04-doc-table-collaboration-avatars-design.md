# Doc and Table Collaboration Avatars

## Goal

Hide collaboration avatars when the current user is the only person viewing a table or document, and show the current user together with remote users whenever another person is present.

## Scope

- Library and asset headers keep using the existing Supabase presence protocol, which already exposes remote users and adds the local user for display.
- Document collaboration keeps using Lexical/Yjs Awareness, which exposes remote users and intentionally excludes the local user from the remote collaborator list.
- No presence or Awareness protocol changes are needed.

## Design

### Table and asset headers

Treat `presenceUsers` as the remote-user list. Build the existing display list with the local user only when at least one remote user is present. When the remote list is empty, render no avatar stack or members indicator, while keeping the existing members panel behavior available for an actual collaboration session.

The existing ordering remains unchanged: the local user is first, followed by remote users sorted by recent activity. Existing overflow behavior and member-panel content remain intact.

### Document editor

Extend the document collaboration presentation with a display-only avatar list. The list is empty when `collaborators` has no remote entries. Otherwise, prepend the current user using the same profile name and deterministic cursor/avatar color already passed to the session, then append the remote collaborators in Awareness order. Render at most five avatars and preserve the existing `+N` overflow treatment and editing tooltips.

The existing `collaboration.collaborators` contract remains remote-only so cursor and collaboration logic are unaffected. Only `DocumentEditor` derives the display list.

### Accessibility and visual behavior

- The avatar stack is omitted from the DOM for a single-user session.
- In a multi-user session, the stack has an accessible label and each avatar retains a tooltip/title naming the person.
- Existing dimensions, colors, ordering, and overflow styling are preserved.

## Testing

- Add unit coverage for table/asset display-list helpers or wiring that proves a local-only session returns no displayed avatars and a remote session prepends the local user.
- Add unit coverage for document display-list derivation with the same two cases and the five-avatar overflow limit.
- Keep the existing E2E document collaboration assertions for remote avatars passing.

## Alternatives considered

1. Extract a shared `CollaborationAvatars` component. This would improve visual centralization but requires wider styling and interaction changes than this bug fix needs.
2. Add the local user to every presence/Awareness payload. This would simplify consumers but changes the realtime protocol and increases the regression surface.

The selected design keeps protocol boundaries stable and limits changes to display derivation and render conditions.
