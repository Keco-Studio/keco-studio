# Agent Selection Context Design

**Date**: 2026-07-03
**Status**: Draft reviewed
**Scope**: `keco-studio` in-app agent and library table selection

## Goals

- Let users select cells or rows in a library table, press `Ctrl+L`, and open the agent with that selection attached to the next message.
- Keep normal agent opening behavior unchanged. Clicking the launcher or opening history must not attach selected table data.
- Show a Cursor-style compact attachment label so the user knows the next message will include selected data.
- Send the selected data to the agent as complete structured context, including both human-readable values and precise `assetId` / `fieldId` identifiers.
- Treat the selection attachment as one-time message context. Sending the message, removing the attachment, starting a new conversation, or opening normally clears it.

## Non-Goals

- Do not make the agent read DOM state directly.
- Do not attach table selection to every message through permanent page context.
- Do not auto-send a prompt when `Ctrl+L` is pressed.
- Do not truncate the selected data sent to the agent.
- Do not override browser `Ctrl+L` when there is no active table selection.

## Current Context

The agent already receives page context through `ChatPanel`, `useAgentChat`, and `/api/agent-chat`. That context includes project, folder, active library, and active section. The library table already tracks selection through `selectedCells` and `selectedRowIds` in `useCellSelection`.

The new selection feature should follow the existing architecture rule: frontend captures UI state and sends a serializable payload to the API; the agent core does not inspect the DOM.

## User Experience

When the user has selected one or more table cells or rows and presses `Ctrl+L`:

1. The table prevents the browser address-bar shortcut.
2. The agent panel opens.
3. The input composer shows a compact selection attachment label.
4. The input remains focused so the user can type a prompt.
5. The selected data is sent only with the next message.

Example labels:

- `角色表 · 第 12-18 行 · 4 列`
- `角色表 · 选中 8 个单元格`
- `道具表 · 第 3-15 行`

The label represents where the data came from, not the full data. The full structured selection is carried in the request payload. The user can remove the attachment before sending.

If the user opens the agent without `Ctrl+L`, the panel behaves exactly as it does today and no selected data is attached.

If the user presses `Ctrl+L` without a selected table range or selected rows, the app does not intercept the shortcut.

## Data Model

Add a shared selection context shape for frontend request payloads and backend LLM augmentation:

```ts
export type AgentSelectionContext = {
  source: 'library_table';
  libraryId: string;
  libraryName?: string;
  sectionName?: string;
  selectionLabel: string;
  mode: 'cells' | 'rows';
  selectedCellCount: number;
  selectedRowCount: number;
  rows: Array<{
    assetId: string;
    rowIndex?: number;
    name: string;
    cells: Array<{
      fieldId: string;
      fieldKey: string;
      fieldName: string;
      dataType?: string;
      value: unknown;
      displayValue: string;
    }>;
  }>;
};
```

`displayValue` is for model readability. `assetId`, `fieldId`, and `fieldKey` are for exact tool targeting, so updates do not depend on the model guessing rows or columns from text.

Rows selected through checkboxes should serialize all visible active-section cells for those rows. Cell selections should serialize only the selected cells. Existing row order and field order should be preserved in `rows` and `cells`.

## Frontend Design

`LibraryAssetsTable` owns the table selection and should build the `AgentSelectionContext` when `Ctrl+L` is pressed. It should dispatch a browser event such as `agent:open-with-selection` with the serialized context.

`ChatPanel` listens for that event, opens the panel, stores the selection as pending composer context, and passes it to `ChatInput`.

`ChatInput` renders the compact attachment label above or inside the composer area and exposes a remove action. It does not render the full data by default.

`useAgentChat.send` accepts an optional `selectionContext`. When present, it includes it in the `/api/agent-chat` request body and displays the user bubble with an attachment-style indicator using `selectionLabel`.

Pending selection context is cleared when:

- The message is sent successfully.
- The user removes the attachment.
- A new conversation is started.
- Another conversation is loaded.
- The panel is opened normally without the event.

## API And Agent Core

`/api/agent-chat` accepts `selectionContext` in the POST body. It validates the payload shape enough to reject unrelated sources or malformed rows, then forwards it into `runAgentTurn`.

`AgentTurnInput` gains an optional `selectionContext`. The context is not persisted as a normal user message prefix. The persisted user message remains the user's raw text plus a lightweight attachment display marker if needed for history rendering.

The LLM message augmentation should include both the compact label and structured selected rows for the current turn only. It should clearly say that the selected data was explicitly attached by the user and should be preferred over generic page context when answering or selecting tool targets.

Example augmentation:

```text
[User attached selected table data for this message: 角色表 · 第 12-18 行 · 4 列.
Use the assetId and fieldId values below for exact tool calls. Do not guess target rows from display text.]
...
```

Confirmation resume should keep using the same suspended message state. Because the selected context is baked into the in-memory LLM message for that turn, approval or rejection of a tool call does not need to re-read the UI selection.

## Edge Cases

- If a selection references rows or fields that are no longer present by the time the user sends, the backend should still pass the attached snapshot to the model. Mutating tools must rely on their normal validation and return errors for deleted assets or fields.
- If the user changes the table selection after `Ctrl+L`, the pending attachment should not silently change. Pressing `Ctrl+L` again replaces it with a new snapshot.
- If both rows and cells are selected, row selection takes priority because existing table behavior treats row selection as a broader batch operation.
- For formula, reference, media, file, and array values, `value` keeps the structured value while `displayValue` contains a concise readable rendering.

## Testing

Unit tests should cover:

- Building selection context for selected cells.
- Building selection context for selected rows.
- Selection label generation for contiguous rows, contiguous ranges, and non-contiguous cells.
- LLM message augmentation includes selected context only when `selectionContext` is present.
- The raw persisted user text does not permanently include selected context.

Focused integration coverage should verify:

- `Ctrl+L` with selection opens the agent and shows the attachment label.
- Normal launcher open does not show an attachment.
- Sending clears the attachment.
- Removing the attachment sends no selection context.
- `Ctrl+L` without selection is not intercepted.

## Self-Review

- Scope is limited to the library table and in-app agent composer.
- The design preserves current page context behavior and only adds explicit one-time selected data.
- The UI does not truncate or summarize the actual context sent to the agent; only the visible attachment label is compact.
- Exact identifiers are included alongside display values so tool calls can target data reliably.
- No unresolved placeholders or implementation-only assumptions remain.
