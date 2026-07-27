# Agent Chat Markdown and Reasoning Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Agent replies as safe GFM Markdown and present one non-empty, clickable reasoning-summary bubble per user turn.

**Architecture:** Add a focused Markdown renderer, keep reasoning-label derivation in pure utilities, and move stream-item mutation into testable pure helpers. The SSE consumer will retain one assistant id across tool calls, while history restoration will aggregate assistant messages by user turn and place the merged reply after tool cards.

**Tech Stack:** Next.js 16, React 19, TypeScript, `react-markdown`, `remark-gfm`, Jest 30, Playwright.

---

## File Structure

- Create `src/components/agent/AssistantMarkdown.tsx` for safe Markdown rendering.
- Create `src/components/agent/assistantStreamItems.ts` for pure streamed-item updates.
- Create `tests/unit/agent/assistant-message.test.tsx` for the collapsed reasoning control.
- Modify `ChatMessage.tsx` and `reasoning-utils.ts` for the clickable live summary.
- Modify `useAgentChat.ts` and `historyMessageMapper.ts` for one reply per turn.
- Modify `ChatPanel.module.css` for compact Markdown and scrollable tables.
- Add focused unit tests and one Agent chat Playwright regression.

### Task 1: Add Markdown Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install direct dependencies**

Run:

```bash
npm install react-markdown@^10.1.0 remark-gfm@^4.0.1
```

Expected: both packages appear in `dependencies` and npm exits successfully.

- [ ] **Step 2: Verify and commit dependency metadata**

Run:

```bash
npm ls react-markdown remark-gfm
git add package.json package-lock.json
git commit -m "build: add agent markdown renderer"
```

Expected: both dependencies resolve without `invalid` or `extraneous` markers.

### Task 2: Render Assistant Markdown Safely

**Files:**
- Create: `src/components/agent/AssistantMarkdown.tsx`
- Create: `tests/unit/agent/assistant-markdown.test.tsx`
- Modify: `src/components/agent/ChatMessage.tsx:95`
- Modify: `src/components/agent/ChatPanel.module.css:126`

- [ ] **Step 1: Write the failing renderer test**

Create `tests/unit/agent/assistant-markdown.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMarkdown } from '@/components/agent/AssistantMarkdown';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({
  markdown: 'markdown',
  markdownTableWrap: 'markdownTableWrap',
  markdownTable: 'markdownTable',
}));

describe('AssistantMarkdown', () => {
  it('renders strong text and a GFM table', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'**Done**\n\n| Feature | Status |\n| --- | --- |\n| Docs | OK |'} />
    );
    expect(html).toContain('<strong>Done</strong>');
    expect(html).toContain('class="markdownTableWrap"');
    expect(html).toContain('<table class="markdownTable">');
    expect(html).toContain('<th>Feature</th>');
    expect(html).toContain('<td>Docs</td>');
  });

  it('does not execute raw HTML', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'<script>alert(1)</script>\n\nSafe'} />
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/unit/agent/assistant-markdown.test.tsx --runInBand`

Expected: FAIL because `AssistantMarkdown` does not exist.

- [ ] **Step 3: Implement the renderer**

Create `AssistantMarkdown.tsx`:

```tsx
'use client';

import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatPanel.module.css';

export function AssistantMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }: ComponentPropsWithoutRef<'a'>) => (
            <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          table: ({ children, ...props }: ComponentPropsWithoutRef<'table'>) => (
            <div className={styles.markdownTableWrap}>
              <table {...props} className={styles.markdownTable}>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
```

Import it in `ChatMessage.tsx` and render:

```tsx
{item.text ? <AssistantMarkdown markdown={item.text} /> : reasoningStreaming ? '…' : null}
```

Add compact `.markdown` element spacing and these table rules to the CSS module:

```css
.markdown { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.markdown > :first-child { margin-top: 0; }
.markdown > :last-child { margin-bottom: 0; }
.markdown p,
.markdown ul,
.markdown ol,
.markdown blockquote,
.markdown pre { margin: 0 0 8px; }
.markdown ul,
.markdown ol { padding-left: 20px; }
.markdown hr { margin: 10px 0; border: 0; border-top: 1px solid #e5e7eb; }
.markdownTableWrap { width: 100%; overflow-x: auto; margin: 8px 0; }
.markdownTable { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 12px; }
.markdownTable th,
.markdownTable td { border: 1px solid #d1d5db; padding: 5px 7px; text-align: left; vertical-align: top; }
.markdownTable th { background: #f3f4f6; font-weight: 600; }
```

- [ ] **Step 4: Verify and commit Markdown rendering**

Run:

```bash
npx jest tests/unit/agent/assistant-markdown.test.tsx --runInBand
npm run typecheck
git add src/components/agent/AssistantMarkdown.tsx src/components/agent/ChatMessage.tsx src/components/agent/ChatPanel.module.css tests/unit/agent/assistant-markdown.test.tsx
git commit -m "feat: render agent replies as markdown"
```

Expected: the focused test passes and TypeScript exits with code 0.

### Task 3: Add Live Reasoning Summaries

**Files:**
- Modify: `src/components/agent/reasoning-utils.ts`
- Modify: `src/components/agent/ChatMessage.tsx:95`
- Modify: `src/components/agent/ChatPanel.module.css:706`
- Modify: `tests/unit/agent/reasoning-utils.test.ts`

- [ ] **Step 1: Write failing summary tests**

Add to `reasoning-utils.test.ts`:

```ts
expect(summarizeReasoning('先检查数据。\n\n**正在比较字段差异**'))
  .toBe('正在比较字段差异');
expect(summarizeReasoning('- **检查权限配置**')).toBe('检查权限配置');
expect(summarizeReasoning('  \n --- ')).toBe('');
expect(summarizeReasoning('这是一个非常长的思考内容，需要限制折叠标题的显示长度。', 12))
  .toBe('这是一个非常长的思考内容…');
expect(reasoningDurationLabel(1_000, undefined, 4_500)).toBe('4s');
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/unit/agent/reasoning-utils.test.ts --runInBand`

Expected: FAIL because `summarizeReasoning` and `reasoningDurationLabel` are missing.

- [ ] **Step 3: Implement summary helpers**

Add to `reasoning-utils.ts`:

```ts
export function summarizeReasoning(reasoning: string, maxLength = 64): string {
  const cleaned = reasoning
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-+*]|\d+[.)]|>)+\s*/gm, '')
    .replace(/[*_~#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned.replace(/[\s.。!！?？:：;；-]/g, '')) return '';
  const sentences = cleaned.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [cleaned];
  const summary = sentences.at(-1)?.trim().replace(/[。！？.!?]+$/, '') ?? '';
  return summary.length <= maxLength ? summary : `${summary.slice(0, maxLength)}…`;
}

export function reasoningDurationLabel(startedAt?: number, endedAt?: number, now = Date.now()): string {
  const ms = reasoningDurationMs(startedAt, endedAt, now);
  return ms === undefined ? '' : formatReasoningSeconds(ms);
}
```

Update the toggle body in `ChatMessage.tsx`:

```tsx
const summary = summarizeReasoning(item.reasoning ?? '');
const duration = reasoningDurationLabel(
  item.reasoningStartedAt,
  item.reasoningEndedAt,
  now
);

<span className={styles.reasoningLabel}>{summary || 'Deep thinking'}</span>
{isThinking && <span className={styles.reasoningStatus}>（思考中）</span>}
{duration && <span className={styles.reasoningDuration}>{duration}</span>}
{isThinking && <span className={styles.reasoningDot} />}
```

Add the styles:

```css
.reasoningStatus { color: #6b7280; }
.reasoningDuration { color: #9ca3af; font-variant-numeric: tabular-nums; }
```

Create `tests/unit/agent/assistant-message.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessage } from '@/components/agent/ChatMessage';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({}));

it('shows a live summary and thinking state for expandable reasoning', () => {
  const html = renderToStaticMarkup(
    <ChatMessage
      item={{
        id: 'a1',
        role: 'assistant',
        reasoning: '先检查项目。\n\n正在汇总结果。',
        reasoningStartedAt: Date.now() - 2000,
      }}
      streaming
      onDecision={jest.fn()}
    />
  );
  expect(html).toContain('正在汇总结果');
  expect(html).toContain('（思考中）');
  expect(html).toContain('aria-expanded="false"');
});
```

- [ ] **Step 4: Verify and commit reasoning summaries**

Run:

```bash
npx jest tests/unit/agent/reasoning-utils.test.ts tests/unit/agent/assistant-message.test.tsx tests/unit/agent/document-confirmation-ui.test.tsx --runInBand
git add src/components/agent/reasoning-utils.ts src/components/agent/ChatMessage.tsx src/components/agent/ChatPanel.module.css tests/unit/agent/reasoning-utils.test.ts tests/unit/agent/assistant-message.test.tsx
git commit -m "feat: summarize streamed agent reasoning"
```

Expected: both suites pass.

### Task 4: Keep One Streamed Assistant Bubble Per Turn

**Files:**
- Create: `src/components/agent/assistantStreamItems.ts`
- Create: `tests/unit/agent/assistant-stream-items.test.ts`
- Modify: `src/components/agent/useAgentChat.ts:235`

- [ ] **Step 1: Write failing helper tests**

Cover these exact behaviors in `assistant-stream-items.test.ts`:

```ts
expect(applyAssistantDelta([], null, {
  newId: 'a1', kind: 'reasoning', delta: ' \n ', now: 1000, segmentStart: true,
})).toEqual({ items: [], assistantId: null, consumedSegmentStart: false });

const items: ChatItem[] = [
  { id: 'a1', role: 'assistant', reasoning: '检查数据', reasoningStartedAt: 1000 },
  { id: 't1', role: 'tool', toolCall: { tool: 'query_assets', status: 'success' } },
];
const final = applyAssistantDelta(items, 'a1', {
  newId: 'unused', kind: 'text', delta: '**完成**', now: 2000,
  segmentStart: true, moveToEnd: true,
});
expect(final.items.map((item) => item.id)).toEqual(['t1', 'a1']);
expect(final.items[1]).toMatchObject({ text: '**完成**', reasoningEndedAt: 2000 });
```

Also assert that later whitespace chunks are preserved, separate model iterations insert `\n\n`, and finalizing whitespace-only content removes the item.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/unit/agent/assistant-stream-items.test.ts --runInBand`

Expected: FAIL because the helper module is missing.

- [ ] **Step 3: Implement the pure stream helper**

Create `assistantStreamItems.ts`:

```ts
import type { ChatItem } from './types';

export interface AssistantDeltaOptions {
  newId: string;
  kind: 'reasoning' | 'text';
  delta: string;
  now: number;
  segmentStart: boolean;
  moveToEnd?: boolean;
}

export function applyAssistantDelta(
  items: ChatItem[],
  assistantId: string | null,
  options: AssistantDeltaOptions
): { items: ChatItem[]; assistantId: string | null; consumedSegmentStart: boolean } {
  const meaningful = options.delta.trim().length > 0;
  if ((!assistantId || options.segmentStart) && !meaningful) {
    return { items, assistantId, consumedSegmentStart: false };
  }

  const id = assistantId ?? options.newId;
  const existing = items.find((item) => item.id === id);
  const next: ChatItem = existing ? { ...existing } : { id, role: 'assistant' };

  if (options.kind === 'reasoning') {
    const prior = next.reasoning ?? '';
    const separator = options.segmentStart && prior.trim() ? '\n\n' : '';
    next.reasoning = `${prior}${separator}${options.delta}`;
    next.reasoningStartedAt ??= options.now;
  } else {
    const prior = next.text ?? '';
    const separator = options.segmentStart && prior.trim() ? '\n\n' : '';
    next.text = `${prior}${separator}${options.delta}`;
    if (next.reasoning?.trim() && !next.reasoningEndedAt) {
      next.reasoningEndedAt = options.now;
    }
  }

  const withoutCurrent = items.filter((item) => item.id !== id);
  const updatedItems = options.moveToEnd || !existing
    ? [...withoutCurrent, next]
    : items.map((item) => item.id === id ? next : item);
  return {
    items: updatedItems,
    assistantId: id,
    consumedSegmentStart: meaningful,
  };
}

export function finalizeAssistantItem(
  items: ChatItem[],
  assistantId: string | null,
  now: number
): ChatItem[] {
  if (!assistantId) return items;
  return items.flatMap((item) => {
    if (item.id !== assistantId) return [item];
    if (!item.text?.trim() && !item.reasoning?.trim()) return [];
    if (!item.reasoning?.trim() || item.reasoningEndedAt) return [item];
    return [{ ...item, reasoningEndedAt: now }];
  });
}
```

- [ ] **Step 4: Integrate the helper into `consumeStream`**

Keep `assistantId` stable on tool, confirmation, and error events. Track `reasoningSegmentStart`, `textSegmentStart`, and `toolActivitySinceText`; reset segment starts on `tool_call_start`. On the first meaningful final text after a tool, call `applyAssistantDelta` with `moveToEnd: true`. Finalize from the local stable id and then clear `streamingAssistantId`.

Use one atomic runtime update per delta:

```ts
const candidateId = assistantId ?? nextId();
updateAgentChatRuntime(runtimeKey, (current) => {
  const result = applyAssistantDelta(current.items, assistantId, {
    newId: candidateId,
    kind: 'reasoning',
    delta,
    now,
    segmentStart: reasoningSegmentStart,
  });
  assistantId = result.assistantId;
  if (result.consumedSegmentStart) reasoningSegmentStart = false;
  return { items: result.items, streamingAssistantId: result.assistantId };
});
```

- [ ] **Step 5: Verify and commit stream aggregation**

Run:

```bash
npx jest tests/unit/agent/assistant-stream-items.test.ts tests/unit/agent/reasoning-utils.test.ts --runInBand
npm run typecheck
git add src/components/agent/assistantStreamItems.ts src/components/agent/useAgentChat.ts tests/unit/agent/assistant-stream-items.test.ts
git commit -m "fix: merge streamed agent reply bubbles"
```

Expected: focused tests and typecheck pass.

### Task 5: Merge Restored Assistant Messages Per Turn

**Files:**
- Modify: `src/components/agent/historyMessageMapper.ts`
- Modify: `tests/unit/agent/history-message-mapper.test.ts`

- [ ] **Step 1: Write the failing history-order test**

Build rows for one user, two assistant tool calls with matching tool rows, and one final assistant reply:

```ts
const rows: HistoryRow[] = [
  { id: 'user-1', role: 'user', content: { content: 'Check status' } },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: {
      content: 'Checking.',
      tool_calls: [{ id: 'call-1', function: { name: 'query_assets', arguments: '{}' } }],
    },
  },
  {
    id: 'tool-1',
    role: 'tool',
    content: { content: '{"ok":true}', tool_call_id: 'call-1', name: 'query_assets' },
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    content: {
      content: '',
      tool_calls: [{ id: 'call-2', function: { name: 'read_document', arguments: '{}' } }],
    },
  },
  {
    id: 'tool-2',
    role: 'tool',
    content: { content: '{"name":"Guide"}', tool_call_id: 'call-2', name: 'read_document' },
  },
  { id: 'final-assistant', role: 'assistant', content: { content: '**Done.**' } },
];
const items = mapHistoryMessagesToChatItems(rows);
expect(items.map((item) => item.role)).toEqual(['user', 'tool', 'tool', 'assistant']);
expect(items.at(-1)).toMatchObject({
  id: 'final-assistant',
  text: 'Checking.\n\n**Done.**',
});
```

Do not remove the existing multimodal user, orphaned tool-call, or standalone tool tests.

- [ ] **Step 2: Run the mapper test and confirm it fails**

Run: `npx jest tests/unit/agent/history-message-mapper.test.ts --runInBand`

Expected: FAIL because assistant fragments currently render separately and before tools.

- [ ] **Step 3: Implement a per-turn buffer**

Use these buffers in `mapHistoryMessagesToChatItems`:

```ts
let turnItems: ChatItem[] = [];
let assistantSegments: Array<{ id: string; text: string }> = [];

const flushTurn = () => {
  loaded.push(...turnItems);
  const text = assistantSegments.map((item) => item.text.trim()).filter(Boolean).join('\n\n');
  const last = assistantSegments.at(-1);
  if (text && last) loaded.push({ id: last.id, role: 'assistant', text });
  turnItems = [];
  assistantSegments = [];
};
```

Flush before every user item and after the loop. Put tool cards in `turnItems`; collect assistant text in `assistantSegments`; keep the existing matching of assistant tool-call ids to following tool rows.

- [ ] **Step 4: Verify and commit history aggregation**

Run:

```bash
npx jest tests/unit/agent/history-message-mapper.test.ts tests/unit/agent/user-message-display.test.ts --runInBand
git add src/components/agent/historyMessageMapper.ts tests/unit/agent/history-message-mapper.test.ts
git commit -m "fix: merge restored agent replies by turn"
```

Expected: both suites pass.

### Task 6: Verify the User-Visible Workflow

**Files:**
- Modify: `tests/e2e/specs/agent-chat.spec.ts`
- Modify: `docs/superpowers/specs/2026-07-27-agent-chat-markdown-reasoning-summary-design.md`

- [ ] **Step 1: Add an E2E regression**

Add this test to `agent-chat.spec.ts`:

```ts
test('renders markdown and one expandable reasoning summary', async ({ page }) => {
  await page.route('**/api/agent-chat', async (route) => {
    await fulfillAgentStream(route, crypto.randomUUID(), [
      { type: 'reasoning_delta', content: '   ' },
      { type: 'reasoning_delta', content: '先检查项目。' },
      { type: 'tool_call_start', tool: 'list_project_structure', args: '{}' },
      { type: 'tool_call_end' },
      { type: 'tool_result', tool: 'list_project_structure', success: true, data: { ok: true } },
      { type: 'reasoning_delta', content: '正在汇总结果。' },
      { type: 'text_delta', content: '**完成**\n\n| 功能 | 状态 |\n| --- | --- |\n| 文档 | OK |' },
    ]);
  });

  const agent = await openProject(page);
  await agent.send('Show Markdown status');

  const assistant = page.getByTestId('agent-message-assistant');
  await expect(assistant).toHaveCount(1);
  await expect(assistant.locator('strong')).toHaveText('完成');
  await expect(assistant.locator('table')).toContainText('文档');
  const reasoning = assistant.getByRole('button');
  await expect(reasoning).toContainText('正在汇总结果');
  await reasoning.click();
  await expect(assistant).toContainText('先检查项目。');
  await expect(assistant).toContainText('正在汇总结果。');
});
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
npx jest tests/unit/agent/assistant-markdown.test.tsx tests/unit/agent/assistant-stream-items.test.ts tests/unit/agent/reasoning-utils.test.ts tests/unit/agent/history-message-mapper.test.ts --runInBand
npx playwright test tests/e2e/specs/agent-chat.spec.ts --grep "renders markdown and one expandable reasoning summary"
npm run typecheck
npm run lint -- --quiet
```

Expected: all commands exit with code 0.

- [ ] **Step 3: Review scope and whitespace**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~5
```

Expected: only Agent chat files, focused tests, dependency metadata, the corrected design, and this plan changed. Existing user-owned simulation edits remain untouched.

- [ ] **Step 4: Commit final coverage and documentation**

```bash
git add tests/e2e/specs/agent-chat.spec.ts docs/superpowers/specs/2026-07-27-agent-chat-markdown-reasoning-summary-design.md docs/superpowers/plans/2026-07-27-agent-chat-markdown-reasoning-summary.md
git commit -m "test: cover agent markdown reasoning workflow"
```
