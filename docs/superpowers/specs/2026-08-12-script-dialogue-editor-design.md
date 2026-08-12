# Script Dialogue Editor Design

## Goal

Complete the partially implemented visual-novel dialogue editor in the Script workspace. Users can insert, edit, delete, and reorder dialogue blocks while preserving changes in the script library. This work does not write changes back to the source document.

## Scope

- Show a light-blue highlight when a dialogue block is hovered.
- Show a blue circular add button below the hovered block.
- Insert a new dialogue block after the selected block using any named character found across the complete script library.
- Let existing dialogue enter edit mode by clicking its avatar, action text, or dialogue bubble.
- Edit the action and dialogue text inline and save automatically.
- Delete a complete dialogue block after confirmation.
- Reorder dialogue blocks in the current branch with a drag handle and persist the new order immediately.
- Keep undo and redo controls for insert, edit, delete, and reorder operations.

Source-document synchronization is explicitly out of scope. The library has a `source_document_id`, but the import pipeline does not retain a reversible mapping from compiled rows to source-document blocks.

## Data Model

An editable dialogue block maps to one or two adjacent library rows:

- An optional type `3` action row with the speaker name and action content.
- An optional type `1` or `2` speech row with the same speaker and dialogue content.

When both rows are present and adjacent, they render and move as one block. A newly inserted block creates both rows with empty content. Existing action-only or speech-only blocks remain editable; the missing companion row is created when the corresponding field is first saved.

Character choices are deduplicated by trimmed speaker name across the complete library. The current protagonist/type mapping and stable accent derivation remain authoritative.

## Component Boundaries

### `VisualNovelScriptView`

- Retains responsibility for branch row ordering and static script rendering.
- Renders editable dialogue blocks in plot-node mode.
- Owns the sortable context for dialogue blocks in the current branch.
- Leaves scene headings, labels, choices, and other non-dialogue rows in their existing relative positions.

### `ScriptEditableDialogBlock`

- Owns local hover, picker, edit-draft, focus, and deletion-confirmation UI state.
- Exposes explicit actions for begin edit, save, insert, delete, and drag activation.
- Does not directly access Supabase or query caches.

### `useScriptDialogueEditor`

- Builds dialogue blocks for the selected branch and characters for the complete library.
- Serializes mutations so overlapping saves, deletes, and reorders cannot race.
- Persists insert, update, delete, and reorder operations.
- Maintains undo and redo history.
- Refreshes library rows after each completed operation.

### Dialogue Mutation Helpers

- Keep database operations independent of React.
- Preserve action/speech adjacency during insertion and reordering.
- Return snapshots needed for undo and error recovery.

## Interaction States

### Default And Hover

The default block retains the current dialogue presentation. Hovering anywhere over the block adds a light-blue background and shows a blue circular add button centered below the block. Leaving the block closes the hover chrome unless the character picker is open.

Clicking unused space in the highlighted block does not enter edit mode. Clicking the avatar, action text, or dialogue bubble does.

### Insert

Clicking the add button opens a menu below it. The menu lists every named character in the complete script library with the character's existing avatar accent. Selecting a character:

1. Closes the menu.
2. Inserts adjacent empty action and speech rows after the current block.
3. Refreshes the library query.
4. Opens the new block in edit mode and focuses its action input.

Clicking outside the picker or pressing Escape closes it without inserting.

### Edit And Autosave

Only one block is edited at a time. Edit mode shows a drag handle and red delete control beside the avatar, plus action and dialogue inputs.

- Action `Enter` submits the action value.
- Dialogue `Ctrl+Enter` or `Cmd+Enter` submits the dialogue and exits edit mode.
- Plain `Enter` in the dialogue input inserts a newline.
- Blurring either input saves its changed draft.
- Clicking outside the edited block, selecting another block, opening an add menu, starting a drag, or otherwise leaving edit mode flushes changed drafts before the next action proceeds.
- Unchanged drafts do not create database writes or history entries.

If a save fails, the block stays in edit mode with its draft intact and an error message is shown.

### Delete

Clicking the red delete control opens the project's standard Ant Design confirmation dialog. Confirming removes both action and speech rows belonging to the block and refreshes the library. Cancelling leaves the block and edit state unchanged.

### Reorder

The existing `dnd-kit` dependency provides pointer and keyboard sorting. Only dialogue blocks in the current branch participate. Dragging shows a clear active and drop-target state. Dropping persists the new order immediately while preserving:

- Action/speech row adjacency within every dialogue block.
- The relative order of non-dialogue rows.
- Rows outside the current branch.

While a mutation is pending, controls that could start a conflicting mutation are disabled. On failure, the query is refreshed to restore database order and an error message is shown.

### Undo And Redo

The left-aligned toolbar remains visible in plot-node editing mode. Undo and redo cover insert, content update, delete, and reorder. Buttons use the project's icon set, include accessible labels/tooltips, and are disabled when unavailable or while a mutation is pending.

## Persistence And Consistency

Every completed interaction writes to the script library through the existing library asset service. Query invalidation then reloads authoritative rows. Mutations are serialized to avoid losing a blur save when another action begins.

Reorder calculates a full library row order from the current authoritative rows. It moves only the row IDs owned by dialogue blocks while keeping all unowned rows in place. The resulting row indexes are persisted as one ordered operation using the existing normalization helpers.

No change in this feature updates the linked source document.

## Accessibility And Responsive Behavior

- Icon buttons have accessible names and tooltips where their meaning is not obvious.
- The character picker uses menu semantics and supports Escape and keyboard focus.
- Dragging supports both pointer and keyboard sensors.
- Controls have stable dimensions and do not shift dialogue layout when shown.
- Inputs and the picker remain within the available split-pane width on narrow screens.

## Error Handling

- Insert, save, delete, reorder, undo, and redo errors display the existing project error toast.
- Failed edits retain local drafts.
- Failed structural changes invalidate and reload library rows.
- Duplicate commands are ignored while a mutation is active.
- Empty character lists render a disabled menu message rather than an empty popup.

## Testing

Focused unit and component tests will cover:

- Character discovery across the complete library.
- Action/speech block grouping, including empty and one-sided blocks.
- Hover chrome and edit entry only from avatar/action/dialogue targets.
- Character menu selection and Escape/outside dismissal.
- Autosave on blur and before switching blocks.
- Dialogue keyboard behavior.
- Delete confirmation and cancel behavior.
- Pointer/keyboard reorder callbacks and preservation of non-dialogue row positions.
- Mutation success, failure recovery, serialization, and undo/redo state.

Verification includes the focused Jest tests, TypeScript checking, ESLint for touched files, and browser screenshots at desktop and narrow split-pane widths when a runnable authenticated fixture is available.
