# Agent Selection Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cursor-style `Ctrl+L` flow that opens the agent with selected library table data attached to the next user message only.

**Architecture:** Library table selection is captured on the frontend as a serializable `AgentSelectionContext` snapshot and dispatched through a browser event. `ChatPanel` stores that snapshot as a pending composer attachment, `useAgentChat.send` forwards it to `/api/agent-chat`, and the agent core injects the structured selection into the current LLM turn without making it permanent page context.

**Tech Stack:** Next.js 16 app router, React 18, TypeScript 5.9, Ant Design icons, Jest 30 with ts-jest.

## Global Constraints

- Normal agent launcher behavior must remain unchanged and must not attach selected data.
- `Ctrl+L` must be intercepted only when the library table has a selected cell range or selected rows.
- The visible UI attachment is compact; the selected data sent to the agent is complete and not truncated.
- The payload must include display values plus exact `assetId`, `fieldId`, and `fieldKey` identifiers.
- Selection context is one-time message context and clears after send, manual removal, new conversation, conversation load, or normal open.
- Do not commit changes in this work session.

---

## File Structure

- Create `src/lib/agent/selection-context.ts`: shared frontend/backend types, payload validation, LLM formatting helpers, and compact display helpers that do not depend on React.
- Create `src/components/libraries/utils/agentSelectionContext.ts`: converts table `selectedCells` / `selectedRowIds` plus visible rows/properties into an `AgentSelectionContext`.
- Modify `src/lib/agent/types.ts`: add optional `selectionContext` to `AgentTurnInput`.
- Modify `src/lib/agent/context-message.ts`: inject selected data into the current LLM user message when present.
- Modify `src/lib/agent/core.ts`: pass `selectionContext` into augmentation, keep DB persistence raw.
- Modify `src/app/api/agent-chat/route.ts`: accept, validate, and forward `selectionContext`.
- Modify `src/components/agent/types.ts`: add selection attachment types to chat UI models and send options.
- Modify `src/components/agent/userMessageDisplay.ts`: render selection attachment chips in live and history display when metadata exists.
- Modify `src/components/agent/useAgentChat.ts`: accept optional selection context, include it in POST body, and display it as a user attachment.
- Modify `src/components/agent/ChatInput.tsx`: render pending selection chip and allow removing it before send.
- Modify `src/components/agent/ChatPanel.tsx`: listen for `agent:open-with-selection`, open the panel, store pending context, and clear it on normal lifecycle transitions.
- Modify `src/components/libraries/LibraryAssetsTable.tsx`: handle `Ctrl+L` when selection exists and dispatch the selection event.
- Modify `src/components/agent/ChatPanel.module.css`: style the compact selection chip.
- Add tests under `tests/unit/agent/selection-context.test.ts`, `tests/unit/agent/selection-context-message.test.ts`, and `tests/unit/agent/table-selection-context.test.ts`.

---

### Task 1: Shared Selection Context Types And Formatting

**Files:**
- Create: `src/lib/agent/selection-context.ts`
- Test: `tests/unit/agent/selection-context.test.ts`

**Interfaces:**
- Produces:
  - `AgentSelectionContext`
  - `AgentSelectionRow`
  - `AgentSelectionCell`
  - `isAgentSelectionContext(value: unknown): value is AgentSelectionContext`
  - `formatSelectionContextForLlm(ctx: AgentSelectionContext): string`

- [ ] **Step 1: Write the failing test**

```ts
import {
  formatSelectionContextForLlm,
  isAgentSelectionContext,
  type AgentSelectionContext,
} from '../../../src/lib/agent/selection-context';

const selection: AgentSelectionContext = {
  source: 'library_table',
  libraryId: 'lib-1',
  libraryName: '角色表',
  sectionName: '基础信息',
  selectionLabel: '角色表 · 第 2-3 行 · 2 列',
  mode: 'cells',
  selectedCellCount: 4,
  selectedRowCount: 2,
  rows: [
    {
      assetId: 'asset-1',
      rowIndex: 2,
      name: 'Alice',
      cells: [
        {
          fieldId: 'field-name',
          fieldKey: 'name',
          fieldName: 'Name',
          dataType: 'string',
          value: 'Alice',
          displayValue: 'Alice',
        },
      ],
    },
  ],
};

describe('selection context helpers', () => {
  it('validates a library-table selection context', () => {
    expect(isAgentSelectionContext(selection)).toBe(true);
    expect(isAgentSelectionContext({ ...selection, source: 'other' })).toBe(false);
    expect(isAgentSelectionContext({ ...selection, rows: [{ assetId: 'x' }] })).toBe(false);
  });

  it('formats complete selected data for the LLM with exact identifiers', () => {
    const text = formatSelectionContextForLlm(selection);
    expect(text).toContain('角色表 · 第 2-3 行 · 2 列');
    expect(text).toContain('"assetId": "asset-1"');
    expect(text).toContain('"fieldId": "field-name"');
    expect(text).toContain('"displayValue": "Alice"');
    expect(text).toContain('Do not guess target rows from display text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/agent/selection-context.test.ts`

Expected: FAIL because `src/lib/agent/selection-context.ts` does not exist.

- [ ] **Step 3: Implement the helper**

```ts
export interface AgentSelectionCell {
  fieldId: string;
  fieldKey: string;
  fieldName: string;
  dataType?: string;
  value: unknown;
  displayValue: string;
}

export interface AgentSelectionRow {
  assetId: string;
  rowIndex?: number;
  name: string;
  cells: AgentSelectionCell[];
}

export interface AgentSelectionContext {
  source: 'library_table';
  libraryId: string;
  libraryName?: string;
  sectionName?: string;
  selectionLabel: string;
  mode: 'cells' | 'rows';
  selectedCellCount: number;
  selectedRowCount: number;
  rows: AgentSelectionRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSelectionCell(value: unknown): value is AgentSelectionCell {
  if (!isRecord(value)) return false;
  return (
    typeof value.fieldId === 'string' &&
    typeof value.fieldKey === 'string' &&
    typeof value.fieldName === 'string' &&
    (typeof value.dataType === 'undefined' || typeof value.dataType === 'string') &&
    typeof value.displayValue === 'string' &&
    'value' in value
  );
}

function isSelectionRow(value: unknown): value is AgentSelectionRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.assetId === 'string' &&
    (typeof value.rowIndex === 'undefined' || typeof value.rowIndex === 'number') &&
    typeof value.name === 'string' &&
    Array.isArray(value.cells) &&
    value.cells.every(isSelectionCell)
  );
}

export function isAgentSelectionContext(value: unknown): value is AgentSelectionContext {
  if (!isRecord(value)) return false;
  return (
    value.source === 'library_table' &&
    typeof value.libraryId === 'string' &&
    value.libraryId.length > 0 &&
    (typeof value.libraryName === 'undefined' || typeof value.libraryName === 'string') &&
    (typeof value.sectionName === 'undefined' || typeof value.sectionName === 'string') &&
    typeof value.selectionLabel === 'string' &&
    value.selectionLabel.length > 0 &&
    (value.mode === 'cells' || value.mode === 'rows') &&
    typeof value.selectedCellCount === 'number' &&
    typeof value.selectedRowCount === 'number' &&
    Array.isArray(value.rows) &&
    value.rows.every(isSelectionRow)
  );
}

export function formatSelectionContextForLlm(ctx: AgentSelectionContext): string {
  const payload = JSON.stringify(
    {
      source: ctx.source,
      libraryId: ctx.libraryId,
      libraryName: ctx.libraryName,
      sectionName: ctx.sectionName,
      mode: ctx.mode,
      selectedCellCount: ctx.selectedCellCount,
      selectedRowCount: ctx.selectedRowCount,
      rows: ctx.rows,
    },
    null,
    2
  );

  return [
    `[User attached selected table data for this message: ${ctx.selectionLabel}.`,
    'Use the assetId, fieldId, and fieldKey values below for exact tool calls.',
    'Do not guess target rows from display text.]',
    payload,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/agent/selection-context.test.ts`

Expected: PASS.

---

### Task 2: LLM Context Augmentation

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/context-message.ts`
- Modify: `src/lib/agent/core.ts`
- Test: `tests/unit/agent/selection-context-message.test.ts`

**Interfaces:**
- Consumes: `AgentSelectionContext`, `formatSelectionContextForLlm`
- Produces:
  - `AgentTurnInput.selectionContext?: AgentSelectionContext`
  - `augmentUserMessageForLlm(userMessage: string, ctx: ToolContext, selectionContext?: AgentSelectionContext): string`

- [ ] **Step 1: Write the failing test**

```ts
import { augmentUserMessageForLlm, stripContextAugmentation } from '../../../src/lib/agent/context-message';
import type { AgentSelectionContext } from '../../../src/lib/agent/selection-context';
import type { ToolContext } from '../../../src/lib/agent/types';

const toolContext = {
  userId: 'user-1',
  projectId: 'project-1',
  conversationId: 'conv-1',
  currentLibraryName: '角色表',
  currentSectionName: '基础信息',
  userRole: 'editor',
} as ToolContext;

const selection: AgentSelectionContext = {
  source: 'library_table',
  libraryId: 'lib-1',
  libraryName: '角色表',
  sectionName: '基础信息',
  selectionLabel: '角色表 · 第 2 行 · 1 列',
  mode: 'cells',
  selectedCellCount: 1,
  selectedRowCount: 1,
  rows: [
    {
      assetId: 'asset-1',
      rowIndex: 2,
      name: 'Alice',
      cells: [
        {
          fieldId: 'field-name',
          fieldKey: 'name',
          fieldName: 'Name',
          dataType: 'string',
          value: 'Alice',
          displayValue: 'Alice',
        },
      ],
    },
  ],
};

describe('augmentUserMessageForLlm with selected table data', () => {
  it('injects selection context before the raw message for this turn', () => {
    const augmented = augmentUserMessageForLlm('帮我改一下', toolContext, selection);
    expect(augmented).toContain('[User is viewing: active library "角色表"');
    expect(augmented).toContain('[User attached selected table data for this message: 角色表 · 第 2 行 · 1 列.');
    expect(augmented).toContain('"assetId": "asset-1"');
    expect(augmented.endsWith('帮我改一下')).toBe(true);
  });

  it('stripContextAugmentation removes page and selection prefixes', () => {
    const augmented = augmentUserMessageForLlm('raw message', toolContext, selection);
    expect(stripContextAugmentation(augmented)).toBe('raw message');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/agent/selection-context-message.test.ts`

Expected: FAIL because `augmentUserMessageForLlm` does not accept selection context yet.

- [ ] **Step 3: Update types and augmentation**

In `src/lib/agent/types.ts`, import and use the shared type:

```ts
import type { AgentSelectionContext } from './selection-context';

export interface AgentTurnInput {
  conversationId: string;
  userMessage: string;
  imageUrls?: string[];
  selectionContext?: AgentSelectionContext;
  toolContext: ToolContext;
  conversationMeta: ConversationMeta;
}
```

In `src/lib/agent/context-message.ts`, update the pattern and function:

```ts
import { formatSelectionContextForLlm, type AgentSelectionContext } from './selection-context';
import type { ToolContext } from './types';

const CONTEXT_PREFIX_PATTERN = /^(?:\[User is viewing:[\s\S]*?\]\n)?(?:\[User attached selected table data for this message:[\s\S]*?\n\}\n)?/;

export function augmentUserMessageForLlm(
  userMessage: string,
  ctx: ToolContext,
  selectionContext?: AgentSelectionContext
): string {
  const prefixes: string[] = [];
  const hasPageContext =
    ctx.currentLibraryName ||
    ctx.currentLibraryId ||
    ctx.currentSectionName ||
    ctx.currentFolderName;

  if (hasPageContext) {
    const hints: string[] = [];
    if (ctx.currentLibraryName) {
      hints.push(`active library "${ctx.currentLibraryName}"`);
    } else if (ctx.currentLibraryId) {
      hints.push(`active library (id: ${ctx.currentLibraryId})`);
    }
    if (ctx.currentSectionName) {
      hints.push(`active section tab "${ctx.currentSectionName}"`);
    }
    if (ctx.currentFolderName) {
      hints.push(`folder "${ctx.currentFolderName}"`);
    }
    prefixes.push(`[User is viewing: ${hints.join(', ')}. Use this library/section by default in tool calls — do not ask which library unless they name a different one.]`);
  }

  if (selectionContext) {
    prefixes.push(formatSelectionContextForLlm(selectionContext));
  }

  if (prefixes.length === 0) return userMessage;
  return `${prefixes.join('\n')}\n${userMessage}`;
}
```

In `src/lib/agent/core.ts`, pass the optional context:

```ts
const llmUserMessage = augmentUserMessageForLlm(
  input.userMessage,
  toolContext,
  input.selectionContext
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/agent/selection-context-message.test.ts`

Expected: PASS.

---

### Task 3: Table Selection Snapshot Builder

**Files:**
- Create: `src/components/libraries/utils/agentSelectionContext.ts`
- Test: `tests/unit/agent/table-selection-context.test.ts`

**Interfaces:**
- Consumes: `AgentSelectionContext`, `AssetRow`, `PropertyConfig`, `CellKey`
- Produces:
  - `buildAgentSelectionContext(input: BuildAgentSelectionContextInput): AgentSelectionContext | null`
  - `formatCellDisplayValue(value: unknown): string`

- [ ] **Step 1: Write the failing test**

```ts
import { buildAgentSelectionContext } from '../../../src/components/libraries/utils/agentSelectionContext';
import type { CellKey } from '../../../src/components/libraries/hooks/useCellSelection';
import type { AssetRow, PropertyConfig } from '../../../src/lib/types/libraryAssets';

const rows = [
  {
    id: 'asset-1',
    libraryId: 'lib-1',
    name: 'Alice',
    rowIndex: 2,
    propertyValues: { name: 'Alice', age: 18, ref: [{ assetId: 'asset-x', fieldId: 'field-x', displayValue: 'Bob' }] },
  },
  {
    id: 'asset-2',
    libraryId: 'lib-1',
    name: 'Bob',
    rowIndex: 3,
    propertyValues: { name: 'Bob', age: 19 },
  },
] as AssetRow[];

const properties = [
  { id: 'field-name', key: 'name', name: 'Name', dataType: 'string', sectionId: 'sec-1', valueType: 'string', orderIndex: 1 },
  { id: 'field-age', key: 'age', name: 'Age', dataType: 'int', sectionId: 'sec-1', valueType: 'number', orderIndex: 2 },
] as PropertyConfig[];

describe('buildAgentSelectionContext', () => {
  it('serializes selected cells with row and field identifiers', () => {
    const ctx = buildAgentSelectionContext({
      libraryId: 'lib-1',
      libraryName: '角色表',
      sectionName: '基础信息',
      rows,
      visibleProperties: properties,
      selectedCells: new Set<CellKey>(['asset-1-name', 'asset-2-age'] as CellKey[]),
      selectedRowIds: new Set<string>(),
    });

    expect(ctx?.selectionLabel).toBe('角色表 · 选中 2 个单元格');
    expect(ctx?.mode).toBe('cells');
    expect(ctx?.rows).toHaveLength(2);
    expect(ctx?.rows[0].cells[0]).toMatchObject({
      fieldId: 'field-name',
      fieldKey: 'name',
      fieldName: 'Name',
      displayValue: 'Alice',
    });
  });

  it('serializes selected rows using all visible active-section cells', () => {
    const ctx = buildAgentSelectionContext({
      libraryId: 'lib-1',
      libraryName: '角色表',
      sectionName: '基础信息',
      rows,
      visibleProperties: properties,
      selectedCells: new Set<CellKey>(['asset-1-name'] as CellKey[]),
      selectedRowIds: new Set(['asset-1', 'asset-2']),
    });

    expect(ctx?.selectionLabel).toBe('角色表 · 第 2-3 行');
    expect(ctx?.mode).toBe('rows');
    expect(ctx?.selectedCellCount).toBe(4);
    expect(ctx?.rows[0].cells.map((cell) => cell.fieldKey)).toEqual(['name', 'age']);
  });

  it('returns null when no cells or rows are selected', () => {
    expect(buildAgentSelectionContext({
      libraryId: 'lib-1',
      libraryName: '角色表',
      rows,
      visibleProperties: properties,
      selectedCells: new Set<CellKey>(),
      selectedRowIds: new Set<string>(),
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/agent/table-selection-context.test.ts`

Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement snapshot building**

```ts
import type { AgentSelectionCell, AgentSelectionContext } from '@/lib/agent/selection-context';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from '../hooks/useCellSelection';

export interface BuildAgentSelectionContextInput {
  libraryId: string;
  libraryName?: string;
  sectionName?: string;
  rows: AssetRow[];
  visibleProperties: PropertyConfig[];
  selectedCells: Set<CellKey>;
  selectedRowIds: Set<string>;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatCellDisplayValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const labels = value
      .map((item) => {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return record.displayValue ?? record.name ?? record.assetId ?? compactJson(record);
        }
        return item;
      })
      .filter((item) => item != null)
      .map(String);
    return labels.join(', ');
  }
  return compactJson(value);
}

function buildCell(row: AssetRow, property: PropertyConfig): AgentSelectionCell {
  const value = row.propertyValues?.[property.key];
  return {
    fieldId: property.id,
    fieldKey: property.key,
    fieldName: property.name,
    dataType: property.dataType,
    value,
    displayValue: formatCellDisplayValue(value),
  };
}

function rowLabelPart(rows: AssetRow[]): string | null {
  const indices = rows
    .map((row) => row.rowIndex)
    .filter((index): index is number => typeof index === 'number')
    .sort((a, b) => a - b);
  if (indices.length !== rows.length || indices.length === 0) return null;
  const contiguous = indices.every((index, i) => i === 0 || index === indices[i - 1] + 1);
  if (contiguous) return indices.length === 1 ? `第 ${indices[0]} 行` : `第 ${indices[0]}-${indices[indices.length - 1]} 行`;
  return `选中 ${indices.length} 行`;
}

export function buildAgentSelectionContext(input: BuildAgentSelectionContextInput): AgentSelectionContext | null {
  const tableName = input.libraryName || '当前表';
  const rowById = new Map(input.rows.map((row) => [row.id, row]));
  const propByKey = new Map(input.visibleProperties.map((property) => [property.key, property]));

  if (input.selectedRowIds.size > 0) {
    const selectedRows = input.rows.filter((row) => input.selectedRowIds.has(row.id));
    if (selectedRows.length === 0) return null;
    const rows = selectedRows.map((row) => ({
      assetId: row.id,
      rowIndex: row.rowIndex,
      name: row.name,
      cells: input.visibleProperties.map((property) => buildCell(row, property)),
    }));
    const rowLabel = rowLabelPart(selectedRows) ?? `选中 ${selectedRows.length} 行`;
    return {
      source: 'library_table',
      libraryId: input.libraryId,
      libraryName: input.libraryName,
      sectionName: input.sectionName,
      selectionLabel: `${tableName} · ${rowLabel}`,
      mode: 'rows',
      selectedCellCount: rows.reduce((sum, row) => sum + row.cells.length, 0),
      selectedRowCount: rows.length,
      rows,
    };
  }

  if (input.selectedCells.size === 0) return null;

  const grouped = new Map<string, AgentSelectionCell[]>();
  for (const key of input.selectedCells) {
    const matchedRow = input.rows.find((row) => key.startsWith(`${row.id}-`));
    if (!matchedRow) continue;
    const propertyKey = key.slice(matchedRow.id.length + 1);
    const property = propByKey.get(propertyKey);
    if (!property) continue;
    const cells = grouped.get(matchedRow.id) ?? [];
    cells.push(buildCell(matchedRow, property));
    grouped.set(matchedRow.id, cells);
  }

  const rows = input.rows
    .filter((row) => grouped.has(row.id))
    .map((row) => ({
      assetId: row.id,
      rowIndex: row.rowIndex,
      name: row.name,
      cells: input.visibleProperties.filter((property) => grouped.get(row.id)?.some((cell) => cell.fieldKey === property.key)).map((property) => buildCell(row, property)),
    }));

  if (rows.length === 0) return null;
  const selectedCellCount = rows.reduce((sum, row) => sum + row.cells.length, 0);
  return {
    source: 'library_table',
    libraryId: input.libraryId,
    libraryName: input.libraryName,
    sectionName: input.sectionName,
    selectionLabel: `${tableName} · 选中 ${selectedCellCount} 个单元格`,
    mode: 'cells',
    selectedCellCount,
    selectedRowCount: rows.length,
    rows,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/agent/table-selection-context.test.ts`

Expected: PASS.

---

### Task 4: API Route And Send Path

**Files:**
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `src/components/agent/types.ts`
- Modify: `src/components/agent/userMessageDisplay.ts`
- Modify: `src/components/agent/useAgentChat.ts`
- Test: `tests/unit/agent/user-message-display.test.ts`

**Interfaces:**
- Consumes: `AgentSelectionContext`, `isAgentSelectionContext`
- Produces:
  - `ChatAttachment.kind?: 'file' | 'image' | 'selection'`
  - `SendOptions.selectionContext?: AgentSelectionContext`

- [ ] **Step 1: Extend user display tests**

Append this test to `tests/unit/agent/user-message-display.test.ts`:

```ts
it('shows selected table context as a compact attachment', () => {
  const display = deriveUserDisplay('请分析', undefined, {
    source: 'library_table',
    libraryId: 'lib-1',
    libraryName: '角色表',
    selectionLabel: '角色表 · 第 2-3 行 · 2 列',
    mode: 'cells',
    selectedCellCount: 4,
    selectedRowCount: 2,
    rows: [],
  });

  expect(display).toEqual({
    text: '请分析',
    attachments: [
      {
        kind: 'selection',
        fileName: '角色表 · 第 2-3 行 · 2 列',
      },
    ],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/agent/user-message-display.test.ts`

Expected: FAIL because `deriveUserDisplay` accepts only two parameters and `ChatAttachment.kind` does not exist.

- [ ] **Step 3: Implement send/display plumbing**

In `src/components/agent/types.ts`:

```ts
import type { AgentSelectionContext } from '@/lib/agent/selection-context';

export interface ChatAttachment {
  kind?: 'file' | 'image' | 'selection';
  fileName: string;
  imageUrl?: string;
}

export interface SendOptions {
  imageUrls?: string[];
  selectionContext?: AgentSelectionContext;
}
```

Update `deriveUserDisplay`:

```ts
import type { AgentSelectionContext } from '@/lib/agent/selection-context';

export function deriveUserDisplay(
  message: string,
  imageUrls?: string[],
  selectionContext?: AgentSelectionContext
): UserDisplay {
  const selectionAttachment = selectionContext
    ? [{ kind: 'selection' as const, fileName: selectionContext.selectionLabel }]
    : [];

  const design = parseDesignMessage(message);
  if (design) {
    return {
      text: design.instructions ?? '',
      attachments: [{ kind: 'file', fileName: design.fileName }, ...selectionAttachment],
    };
  }

  if (imageUrls && imageUrls.length > 0) {
    return {
      text: message,
      attachments: [
        ...selectionAttachment,
        ...imageUrls.map((url) => ({ kind: 'image' as const, fileName: fileNameFromUrl(url), imageUrl: url })),
      ],
    };
  }

  return selectionAttachment.length > 0
    ? { text: message, attachments: selectionAttachment }
    : { text: message };
}
```

Update `useAgentChat.send` signature and body:

```ts
const send = useCallback(
  async (message: string, opts?: SendOptions) => {
    const display = deriveUserDisplay(message, opts?.imageUrls, opts?.selectionContext);
    appendItem({ id: nextId(), role: 'user', text: display.text, attachments: display.attachments });
    // ...
    body: JSON.stringify({
      conversationId: conversationIdRef.current,
      projectId: ctx.projectId,
      message,
      imageUrls: opts?.imageUrls,
      selectionContext: opts?.selectionContext,
      autoExecute: conversationIdRef.current ? undefined : autoExecute,
      currentFolderId: ctx.currentFolderId,
      currentFolderName: ctx.currentFolderName,
      currentLibraryId: ctx.currentLibraryId,
      currentLibraryName: ctx.currentLibraryName,
      currentSectionName: ctx.currentSectionName ?? getActiveSectionName(ctx.currentLibraryId),
    }),
  },
  [...]
);
```

Update `src/app/api/agent-chat/route.ts` body type and route:

```ts
import { isAgentSelectionContext } from '@/lib/agent/selection-context';

let body: {
  // existing fields
  selectionContext?: unknown;
};

const selectionContext = isAgentSelectionContext(body.selectionContext)
  ? body.selectionContext
  : undefined;

const generator = runAgentTurn({
  conversationId: conversation.id,
  userMessage: message,
  imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
  selectionContext,
  toolContext,
  conversationMeta: resolveConversationMeta(conversation.meta),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/agent/user-message-display.test.ts`

Expected: PASS.

---

### Task 5: Composer Attachment UI And Panel Event

**Files:**
- Modify: `src/components/agent/ChatInput.tsx`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/components/agent/ChatPanel.module.css`

**Interfaces:**
- Consumes: `AgentSelectionContext`, `SendOptions`
- Produces:
  - `ChatInput` props: `selectionContext?: AgentSelectionContext`, `onClearSelectionContext?: () => void`
  - window event: `agent:open-with-selection` with `{ selectionContext: AgentSelectionContext }`

- [ ] **Step 1: Add ChatInput props and send clearing**

Update `Props` in `ChatInput.tsx`:

```ts
import type { AgentSelectionContext } from '@/lib/agent/selection-context';
import type { SendOptions } from './types';

interface Props {
  userId?: string;
  isStreaming: boolean;
  selectionContext?: AgentSelectionContext;
  onClearSelectionContext?: () => void;
  onSend: (message: string, opts?: SendOptions) => void;
}
```

In every successful `onSend(...)` call, include `selectionContext` and clear it after send:

```ts
onSend(trimmed || DEFAULT_IMAGE_PROMPT, { imageUrls, selectionContext });
onClearSelectionContext?.();
```

For document and text sends:

```ts
onSend(message, { imageUrls, selectionContext });
onClearSelectionContext?.();
```

```ts
onSend(trimmed, selectionContext ? { selectionContext } : undefined);
onClearSelectionContext?.();
```

- [ ] **Step 2: Render compact selection attachment**

In `ChatInput.tsx`, render before the textarea:

```tsx
{selectionContext && (
  <div className={styles.selectionAttachment} title={selectionContext.selectionLabel}>
    <span className={styles.selectionAttachmentText}>{selectionContext.selectionLabel}</span>
    <button
      type="button"
      className={styles.selectionAttachmentRemove}
      aria-label="Remove selected table data"
      onClick={onClearSelectionContext}
      disabled={isStreaming || parsing}
    >
      <CloseOutlined />
    </button>
  </div>
)}
```

Allow sending with only selected data plus prompt; keep the no-empty-message rule unchanged:

```ts
if (!trimmed && !file && images.length === 0) return;
```

- [ ] **Step 3: Add panel state and event listener**

In `ChatPanel.tsx`:

```ts
import type { AgentSelectionContext } from '@/lib/agent/selection-context';

const [pendingSelectionContext, setPendingSelectionContext] = useState<AgentSelectionContext | undefined>(undefined);

useEffect(() => {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ selectionContext?: AgentSelectionContext }>).detail;
    if (!detail?.selectionContext) return;
    setOpen(true);
    setPendingSelectionContext(detail.selectionContext);
  };
  window.addEventListener('agent:open-with-selection', handler);
  return () => window.removeEventListener('agent:open-with-selection', handler);
}, []);
```

Clear context on new/load/normal close paths:

```tsx
<button
  className={styles.iconButton}
  onClick={() => {
    setPendingSelectionContext(undefined);
    startNewConversation();
  }}
>
  New
</button>
```

When loading history:

```ts
setPendingSelectionContext(undefined);
void loadConversation(id);
```

Pass props to `ChatInput`:

```tsx
<ChatInput
  userId={userProfile?.id}
  isStreaming={isStreaming}
  selectionContext={pendingSelectionContext}
  onClearSelectionContext={() => setPendingSelectionContext(undefined)}
  onSend={send}
/>
```

- [ ] **Step 4: Add CSS**

In `ChatPanel.module.css`:

```css
.selectionAttachment {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  margin-bottom: 8px;
  padding: 6px 8px;
  border: 1px solid #d9e2ef;
  border-radius: 6px;
  background: #f7f9fc;
  color: #24364b;
  font-size: 12px;
}

.selectionAttachmentText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selectionAttachmentRemove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  background: transparent;
  color: #607089;
  cursor: pointer;
}
```

- [ ] **Step 5: Run type check through focused build command**

Run: `npm run test:unit -- tests/unit/agent/user-message-display.test.ts`

Expected: PASS and no TypeScript compile errors from changed component types.

---

### Task 6: Table `Ctrl+L` Event Dispatch

**Files:**
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`

**Interfaces:**
- Consumes: `buildAgentSelectionContext`
- Produces: dispatches `agent:open-with-selection`

- [ ] **Step 1: Import builder**

Add:

```ts
import { buildAgentSelectionContext } from './utils/agentSelectionContext';
```

- [ ] **Step 2: Add keydown listener**

Inside `LibraryAssetsTable`, after `activeProperties`, `displayRows`, `selectedCells`, and `selectedRowIds` are available:

```ts
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    const isCtrlL = event.key.toLowerCase() === 'l' && (event.ctrlKey || event.metaKey);
    if (!isCtrlL) return;
    if (selectedCells.size === 0 && selectedRowIds.size === 0) return;

    const selectionContext = buildAgentSelectionContext({
      libraryId: library?.id ?? '',
      libraryName: library?.name,
      sectionName: activeGroup?.section.name,
      rows: getAllRowsForCellSelection(),
      visibleProperties: activeProperties,
      selectedCells,
      selectedRowIds,
    });
    if (!selectionContext) return;

    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('agent:open-with-selection', {
        detail: { selectionContext },
      })
    );
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [
  activeGroup?.section.name,
  activeProperties,
  getAllRowsForCellSelection,
  library?.id,
  library?.name,
  selectedCells,
  selectedRowIds,
]);
```

- [ ] **Step 3: Verify focused tests**

Run: `npm run test:unit -- tests/unit/agent/table-selection-context.test.ts tests/unit/cell-navigation.test.ts`

Expected: PASS. `cell-navigation` is included to catch regressions in nearby keyboard selection behavior.

---

### Task 7: Final Verification

**Files:**
- All changed files

**Interfaces:**
- Consumes all previous tasks
- Produces verified implementation without committing

- [ ] **Step 1: Run all focused unit tests**

Run:

```bash
npm run test:unit -- \
  tests/unit/agent/selection-context.test.ts \
  tests/unit/agent/selection-context-message.test.ts \
  tests/unit/agent/table-selection-context.test.ts \
  tests/unit/agent/user-message-display.test.ts \
  tests/unit/cell-navigation.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

Run: `npm run test:unit`

Expected: PASS.

- [ ] **Step 3: Check worktree without committing**

Run: `git status --short`

Expected: changed files include the selection-context implementation and the pre-existing unrelated `next-env.d.ts`; no commit is created.

---

## Self-Review

- Spec coverage: `Ctrl+L` event, compact label, complete payload, ID/display dual data, normal-open behavior, and one-time clearing are all mapped to tasks.
- Placeholder scan: no `TBD`, `TODO`, or unresolved implementation placeholders remain.
- Type consistency: `AgentSelectionContext`, `selectionContext`, `selectionLabel`, `assetId`, `fieldId`, and `fieldKey` are named consistently across frontend, route, and agent core tasks.
- Testing coverage: pure builders and LLM formatting have unit tests; UI event behavior is covered through the pure builder plus final type-focused verification.
